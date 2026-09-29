import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { CurrentView, NodeEvent, WorkbenchRequest } from "./workbenchModel";

type Command = { eventId: string; kind: NodeEvent["kind"]; reason: string; previousRunId?: string; runId?: string; deliveryId?: string; gitUndo?: NodeEvent["gitUndo"] };
const commitId = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

function isNodeEvent(value: unknown): value is NodeEvent {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return [entry.id, entry.taskSlug, entry.reason, entry.actor, entry.recordedAt].every((field) => typeof field === "string" && field.length > 0) &&
    [entry.previousRunId, entry.runId, entry.deliveryId].every((field) => field === null || typeof field === "string" && field.length > 0) &&
    (entry.kind === "retry" ? typeof entry.previousRunId === "string" && entry.deliveryId === null && entry.gitUndo == null
      : entry.kind === "rework" ? typeof entry.deliveryId === "string" && entry.previousRunId === null && entry.runId === null && entry.gitUndo == null
      : entry.kind === "git_undo" && typeof entry.runId === "string" && entry.previousRunId === null && entry.deliveryId === null &&
        !!entry.gitUndo && typeof entry.gitUndo === "object" &&
        ((entry.gitUndo as NodeEvent["gitUndo"])?.operation === "revert" || (entry.gitUndo as NodeEvent["gitUndo"])?.operation === "reset") &&
        commitId.test((entry.gitUndo as NodeEvent["gitUndo"])!.sourceCommit) && commitId.test((entry.gitUndo as NodeEvent["gitUndo"])!.resultCommit) &&
        ((entry.gitUndo as NodeEvent["gitUndo"])!.operation === "reset" ||
          (entry.gitUndo as NodeEvent["gitUndo"])!.sourceCommit.toLowerCase() !== (entry.gitUndo as NodeEvent["gitUndo"])!.resultCommit.toLowerCase()));
}

function matches(entry: NodeEvent, command: Command) {
  return entry.id === command.eventId && entry.kind === command.kind && entry.reason === command.reason &&
    entry.previousRunId === (command.previousRunId ?? null) && entry.runId === (command.runId ?? null) && entry.deliveryId === (command.deliveryId ?? null) &&
    (command.gitUndo ? entry.gitUndo?.operation === command.gitUndo.operation && entry.gitUndo.sourceCommit === command.gitUndo.sourceCommit && entry.gitUndo.resultCommit === command.gitUndo.resultCommit : entry.gitUndo == null);
}

export function NodeEventsPanel({ project, slug, language, runs, deliveries, counts, request = fetch, onChanged }: {
  project: string; slug: string; language: "zh" | "en"; runs: CurrentView["runs"]; deliveries: CurrentView["deliveries"];
  counts: CurrentView["nodeEventCounts"]; request?: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [history, setHistory] = useState<NodeEvent[]>([]);
  const [cursor, setCursor] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [kind, setKind] = useState<NodeEvent["kind"]>("retry");
  const [reason, setReason] = useState("");
  const [previousRunId, setPreviousRunId] = useState("");
  const [runId, setRunId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [gitOperation, setGitOperation] = useState<"revert" | "reset">("revert");
  const [sourceCommit, setSourceCommit] = useState("");
  const [resultCommit, setResultCommit] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Command | null>(null);
  const pendingRef = useRef<Command | null>(null);
  const [inspected, setInspected] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState("");
  const [saved, setSaved] = useState(false);
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/node-events/${encodeURIComponent(slug)}`;
  const nodeRuns = runs.filter((run) => run.taskSlug === slug);
  const nodeDeliveries = deliveries.filter((delivery) => nodeRuns.some((run) => run.id === delivery.runBindingId));
  const count = counts?.find((entry) => entry.taskSlug === slug);
  const gitUndoReady = nodeRuns.some((run) => run.id === runId) && commitId.test(sourceCommit) && commitId.test(resultCommit) &&
    (gitOperation === "reset" || sourceCommit.toLowerCase() !== resultCommit.toLowerCase());

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
      if (page.taskSlug !== slug || !Array.isArray(page.events) ||
          !page.events.every((entry: unknown) => isNodeEvent(entry) && entry.taskSlug === slug) ||
          typeof page.hasMore !== "boolean" || !(page.nextCursor === null || typeof page.nextCursor === "string" && page.nextCursor.length > 0) ||
          page.hasMore !== (page.nextCursor !== null)) throw new Error("Invalid node event history response");
      setHistory((previous) => cursor ? [...previous, ...page.events] : page.events);
      setNextCursor(page.nextCursor); setNeedsLogin(false);
      const command = pendingRef.current;
      if (command) {
        setInspected(true);
        const recorded = (page.events as NodeEvent[]).find((entry) => entry.id === command.eventId);
        if (recorded && matches(recorded, command)) {
          pendingRef.current = null; setPending(null); setReason(""); setSaved(true); setError(""); setConflict(false);
          onChanged();
        } else if (recorded) {
          setConflict(true); setError(`409: ${command.eventId}`);
        }
      }
    }).catch((cause) => { if (!controller.signal.aborted) setReadError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [project, slug, endpoint, request, cursor, refresh]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCursor(""); setRefresh((value) => value + 1);
    } catch (cause) { setError(text("登录失败：", "Sign-in failed: ") + String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || loading || needsLogin || pending && (!inspected || conflict)) return;
    if (!pending && (!reason.trim() || reason.trim().length > 4000 ||
      (kind === "retry" ? !nodeRuns.some((run) => run.id === previousRunId) || !!runId && !nodeRuns.some((run) => run.id === runId)
        : kind === "rework" ? !nodeDeliveries.some((delivery) => delivery.id === deliveryId) : !gitUndoReady))) return;
    inFlight.current = true; setBusy(true); setError(""); setSaved(false); setInspected(false);
    let command = pending;
    try {
      command ??= { eventId: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""), kind, reason: reason.trim(),
        ...(kind === "retry" ? { previousRunId, ...(runId ? { runId } : {}) } : kind === "rework" ? { deliveryId } :
          { runId, gitUndo: { operation: gitOperation, sourceCommit, resultCommit } }) };
      pendingRef.current = command; setPending(command);
      const response = await request(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(command) });
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        if (response.status === 409) setConflict(true);
        else if (!pending) { pendingRef.current = null; setPending(null); }
        setError(text("事件未保存：", "Event not saved: ") + response.status + ` (${command.eventId})`);
        return;
      }
      const entry: unknown = await response.json();
      if (!isNodeEvent(entry) || entry.taskSlug !== slug || !matches(entry, command)) throw new Error("Invalid node event receipt");
      pendingRef.current = null; setPending(null); setReason(""); setSaved(true); setConflict(false);
      setCursor(""); setRefresh((value) => value + 1); onChanged();
    } catch (cause) {
      setError(text("结果未确认，请刷新历史：", "Result unconfirmed; refresh history: ") + String(cause));
    } finally { setBusy(false); inFlight.current = false; }
  }

  const locked = busy || loading || pending !== null;
  return <section className="wb-panel wb-node-events" aria-label={text("重试、退回与Git撤销引用", "Retry, rework and Git undo references")}>
    <h3>{text("重试、退回与Git撤销引用", "Retry, rework and Git undo references")}</h3>
    <p className="text-xs">{counts === undefined ? text("历史计数不可用", "Historical counts unavailable") : `${text("历史重试", "Historical retries")} ${count?.retries ?? 0} / ${text("退回", "Reworks")} ${count?.reworks ?? 0} / ${count?.gitUndos === undefined ? text("Git撤销引用计数不可用", "Git undo history count unavailable") : `${text("Git撤销引用", "Git undo references")} ${count.gitUndos}`}`}</p>
    <p className="text-xs">{text("具名Git撤销引用声明；未核验提交内容或逆向语义，也不执行Git。", "Named Git undo reference declaration; commit contents and reversal semantics are not verified, and no Git command is run.")}</p>
    {needsLogin ? <form onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy || !key}>{text("登录", "Sign in")}</button>
    </form> : <form className="space-y-2" aria-label={text("记录节点事件", "Record node event")} onSubmit={(event) => void submit(event)}>
      <label>{text("事件类别", "Event kind")}<select aria-label="Node event kind" disabled={locked} value={kind} onChange={(event) => setKind(event.target.value as NodeEvent["kind"])}>
        <option value="retry">{text("失败重试", "Retry after failure")}</option><option value="rework">{text("退回重做", "Returned for rework")}</option><option value="git_undo">{text("Git撤销引用", "Git undo reference")}</option>
      </select></label>
      {kind === "retry" ? <>
        <label>{text("失败尝试", "Previous failed run")}<select required disabled={locked} value={previousRunId} onChange={(event) => setPreviousRunId(event.target.value)}>
          <option value="">{text("选择尝试", "Select run")}</option>{nodeRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.state} · {run.threadRef}</option>)}
        </select></label>
        <label>{text("重试尝试（可选）", "Retry run (optional)")}<select disabled={locked} value={runId} onChange={(event) => setRunId(event.target.value)}>
          <option value="">{text("未关联", "Not linked")}</option>{nodeRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.state} · {run.threadRef}</option>)}
        </select></label>
      </> : kind === "rework" ? <label>{text("退回交付", "Returned delivery")}<select required disabled={locked} value={deliveryId} onChange={(event) => setDeliveryId(event.target.value)}>
        <option value="">{text("选择交付", "Select delivery")}</option>{nodeDeliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.id} · {delivery.submittedAt} · {delivery.runBindingId}</option>)}
      </select></label> : <>
        <label>{text("原节点执行", "Original run")}<select aria-label="Git undo run" required disabled={locked} value={runId} onChange={(event) => setRunId(event.target.value)}>
          <option value="">{text("选择原执行", "Select original run")}</option>{nodeRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.state} · {run.threadRef}</option>)}
        </select></label>
        <label>{text("Git操作", "Git operation")}<select aria-label="Git undo operation" disabled={locked} value={gitOperation} onChange={(event) => setGitOperation(event.target.value as typeof gitOperation)}><option value="revert">revert</option><option value="reset">reset</option></select></label>
        <label>{gitOperation === "revert" ? text("被撤销提交", "Undone commit") : text("reset前HEAD", "HEAD before reset")}<input aria-label="Git undo source commit" disabled={locked} value={sourceCommit} onChange={(event) => setSourceCommit(event.target.value)} /></label>
        <label>{gitOperation === "revert" ? text("撤销提交", "Revert commit") : text("reset后HEAD", "HEAD after reset")}<input aria-label="Git undo result commit" disabled={locked} value={resultCommit} onChange={(event) => setResultCommit(event.target.value)} /></label>
      </>}
      <label>{text("原因", "Reason")}<textarea aria-label="Node event reason" required maxLength={4000} disabled={locked} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button type="submit" className="wb-button" disabled={busy || loading || (pending ? !inspected || conflict : !reason.trim() || (kind === "retry" ? !previousRunId : kind === "rework" ? !deliveryId : !gitUndoReady))}><Check size={14} />{pending ? text("重发同一声明", "Resend same declaration") : text("记录事件", "Record event")}</button>
    </form>}
    {pending && <p className="text-xs">{text("待确认事件 ID", "Pending event ID")}: <code>{pending.eventId}</code></p>}
    {conflict && <p role="alert">{text("事件 ID 冲突；请查看历史原记录，不视为本次声明成功。", "Event ID conflict; inspect the original history record. This declaration is not confirmed.")}</p>}
    {conflict && pending && history.some((entry) => entry.id === pending.eventId) && <button className="wb-button" type="button" onClick={() => { pendingRef.current = null; setPending(null); setConflict(false); setReason(""); setError(""); }}>{text("放弃冲突声明", "Discard conflicting declaration")}</button>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{text("事件已记录。", "Event recorded.")}</p>}
    <details open><summary>{text("事件历史", "Event history")}</summary>
      <button type="button" className="wb-button" disabled={busy || loading} onClick={() => { setCursor(""); setRefresh((value) => value + 1); onChanged(); }}><RefreshCw size={14} />{text("刷新历史", "Refresh history")}</button>
      {loading && <p role="status">{text("读取中", "Loading")}</p>}
      {readError && <p role="alert">{text("历史读取失败；已显示记录可能陈旧：", "History read failed; displayed records may be stale: ")}{readError}</p>}
      <ul className="max-h-64 space-y-2 overflow-auto text-xs">{history.map((entry) => <li key={entry.id}>
        <p>{entry.kind === "retry" ? text("失败重试", "Retry after failure") : entry.kind === "rework" ? text("退回重做", "Returned for rework") : text("具名Git撤销引用声明", "Named Git undo reference declaration")} · {entry.actor}</p>
        <code>{entry.id}</code> · <time>{entry.recordedAt}</time><p className="whitespace-pre-wrap">{entry.reason}</p>
        {entry.previousRunId && <p>{text("失败尝试", "Previous failed run")}: {entry.previousRunId}</p>}
        {entry.runId && <p>{entry.kind === "git_undo" ? text("原节点执行", "Original run") : text("重试尝试", "Retry run")}: {entry.runId}</p>}
        {entry.deliveryId && <p>{text("退回交付", "Returned delivery")}: {entry.deliveryId}</p>}
        {entry.gitUndo && <><p>{text("Git操作", "Git operation")}: {entry.gitUndo.operation}</p>
          <p>{entry.gitUndo.operation === "revert" ? text("被撤销提交", "Undone commit") : text("reset前HEAD", "HEAD before reset")}: {entry.gitUndo.sourceCommit}</p>
          <p>{entry.gitUndo.operation === "revert" ? text("撤销提交", "Revert commit") : text("reset后HEAD", "HEAD after reset")}: {entry.gitUndo.resultCommit}</p></>}
      </li>)}</ul>
      {!loading && !readError && !needsLogin && history.length === 0 && <p>{text("没有已记录事件。", "No recorded events.")}</p>}
      {nextCursor && <button type="button" className="wb-button" disabled={busy || loading} onClick={() => setCursor(nextCursor)}>{text("加载更多", "Load more")}</button>}
    </details>
  </section>;
}
