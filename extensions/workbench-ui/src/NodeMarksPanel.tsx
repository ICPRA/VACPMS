import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { NodeMark, WorkbenchRequest } from "./workbenchModel";

function isNodeMark(value: unknown): value is NodeMark {
  if (!value || typeof value !== "object") return false;
  const mark = value as Record<string, unknown>;
  return [mark.id, mark.taskSlug, mark.reason, mark.actor, mark.createdAt]
    .every((field) => typeof field === "string" && field.length > 0) && typeof mark.value === "string" &&
    (mark.kind === "risk" ? ["watch", "high", "cleared"].includes(mark.value)
      : mark.kind === "critical" && ["marked", "cleared"].includes(mark.value));
}

export function NodeMarksPanel({ project, slug, language, currentMarks, request = fetch, onChanged }: {
  project: string; slug: string; language: "zh" | "en"; currentMarks: NodeMark[] | undefined;
  request?: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [history, setHistory] = useState<NodeMark[]>([]);
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [drafts, setDrafts] = useState({ risk: { value: "", reason: "" }, critical: { value: "", reason: "" } });
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/node-marks/${encodeURIComponent(slug)}`;
  const valueLabel = (value: NodeMark["value"]) => ({
    watch: text("关注", "Watch"), high: text("高风险", "High"),
    marked: text("已标记关键", "Marked critical"), cleared: text("已清除标记", "Cleared"),
  })[value];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setReadError("");
    void request(`${endpoint}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, {
      headers: { "X-Specgraph-Project": project }, signal: controller.signal,
    }).then(async (response) => {
      if (controller.signal.aborted) return;
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const page = await response.json();
      if (controller.signal.aborted) return;
      if (!Array.isArray(page.items) || !page.items.every((mark: unknown) => isNodeMark(mark) && mark.taskSlug === slug) ||
          typeof page.hasMore !== "boolean" || typeof page.nextCursor !== "string" || page.hasMore !== (page.nextCursor.length > 0)) {
        throw new Error("Invalid node mark history response");
      }
      setHistory((previous) => cursor ? [...previous, ...page.items] : page.items);
      setNextCursor(page.nextCursor); setNeedsLogin(false);
      if (!cursor) setUncertain(false);
    }).catch((cause) => { if (!controller.signal.aborted) setReadError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, slug, endpoint, request, cursor, refresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCursor(""); setRefresh((value) => value + 1);
    } catch (cause) { setError(text("登录失败：", "Sign-in failed: ") + String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function submit(event: FormEvent, kind: NodeMark["kind"]) {
    event.preventDefault();
    const { value } = drafts[kind];
    const reason = drafts[kind].reason.trim();
    if (inFlight.current || loading || needsLogin || uncertain || !reason || reason.length > 4000 ||
        !(kind === "risk" ? ["watch", "high", "cleared"] : ["marked", "cleared"]).includes(value)) return;
    inFlight.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const response = await request(endpoint, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify({ kind, value, reason }),
      });
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        setError(text("标记未保存：", "Mark not saved: ") + response.status);
        return;
      }
      const mark: unknown = await response.json();
      if (!isNodeMark(mark) || mark.taskSlug !== slug || mark.kind !== kind || mark.value !== value || mark.reason !== reason) {
        throw new Error("Invalid node mark receipt");
      }
      setDrafts((previous) => ({ ...previous, [kind]: { value: "", reason: "" } }));
      setSaved(true); setCursor(""); setRefresh((value) => value + 1); onChanged();
    } catch (cause) {
      setUncertain(true);
      setError(text("结果未确认，请刷新历史后再操作：", "Result unconfirmed; refresh history before another change: ") + String(cause));
    } finally { setBusy(false); inFlight.current = false; }
  }

  return <section className="wb-panel space-y-3" aria-label={text("人工节点标记", "Human node marks")}>
    <h3>{text("人工节点标记", "Human node marks")}</h3>
    <dl className="text-xs">
      {(["risk", "critical"] as const).map((kind) => {
        const mark = currentMarks?.find((entry) => entry.taskSlug === slug && entry.kind === kind);
        return <div key={kind}><dt>{kind === "risk" ? text("风险标记（当前快照）", "Risk mark (current snapshot)") : text("关键标记（当前快照）", "Critical mark (current snapshot)")}</dt>
          <dd>{currentMarks === undefined ? text("标记数据不可用", "Mark data unavailable") : mark ? valueLabel(mark.value) : text("没有已记录标记", "No recorded mark")}</dd></div>;
      })}
    </dl>
    {needsLogin ? <form className="space-y-2" onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy || !key}>{text("登录", "Sign in")}</button>
    </form> : (["risk", "critical"] as const).map((kind) => <form key={kind} className="space-y-2" aria-label={kind === "risk" ? text("风险标记", "Risk mark") : text("关键标记", "Critical mark")} onSubmit={(event) => void submit(event, kind)}>
      <label>{kind === "risk" ? text("风险标记", "Risk mark") : text("关键标记", "Critical mark")}<select className="block w-full rounded border bg-background p-2" required disabled={busy || loading || uncertain} value={drafts[kind].value} onChange={(event) => setDrafts({ ...drafts, [kind]: { ...drafts[kind], value: event.target.value } })}>
        <option value="">{text("选择标记", "Select mark")}</option>
        {(kind === "risk" ? ["watch", "high", "cleared"] as const : ["marked", "cleared"] as const).map((value) => <option key={value} value={value}>{valueLabel(value)}</option>)}
      </select></label>
      <label>{text("依据", "Reason")}<textarea className="block w-full rounded border bg-background p-2" required maxLength={4000} value={drafts[kind].reason} disabled={busy || loading || uncertain} onChange={(event) => setDrafts({ ...drafts, [kind]: { ...drafts[kind], reason: event.target.value } })} /></label>
      <button type="submit" className="wb-button" disabled={busy || loading || uncertain || !drafts[kind].value || !drafts[kind].reason.trim()}><Check size={14} />{kind === "risk" ? text("保存风险标记", "Save risk mark") : text("保存关键标记", "Save critical mark")}</button>
    </form>)}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{text("标记已记录。", "Mark recorded.")}</p>}
    <details open>
      <summary>{text("标记历史", "Mark history")}</summary>
      <button type="button" className="wb-button" disabled={busy || loading} onClick={() => { setCursor(""); setRefresh((value) => value + 1); onChanged(); }}><RefreshCw size={14} />{text("刷新历史", "Refresh history")}</button>
      {loading && <p role="status">{text("读取中", "Loading")}</p>}
      {readError && <p role="alert">{text("历史读取失败；已显示记录可能陈旧：", "History read failed; displayed records may be stale: ")}{readError}</p>}
      <ul className="max-h-64 space-y-2 overflow-auto text-xs">{history.map((mark) => <li key={mark.id}>
        <p>{mark.kind === "risk" ? text("风险", "Risk") : text("关键", "Critical")} · {valueLabel(mark.value)} · {mark.actor}</p>
        <time>{mark.createdAt}</time><p className="whitespace-pre-wrap">{mark.reason}</p>
      </li>)}</ul>
      {!loading && !readError && !needsLogin && history.length === 0 && <p>{text("没有已记录标记；不代表没有风险。", "No recorded marks; this does not establish absence of risk.")}</p>}
      {nextCursor && <button type="button" className="wb-button" disabled={busy || loading} onClick={() => setCursor(nextCursor)}>{text("加载更多", "Load more")}</button>}
    </details>
  </section>;
}
