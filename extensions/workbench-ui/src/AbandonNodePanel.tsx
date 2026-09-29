import { useRef, useState, type FormEvent } from "react";
import { Ban, ArrowUpRight } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

export function AbandonNodePanel({ project, slug, language, request = fetch, onChanged, onOpenSessions }: {
  project: string; slug: string; language: "zh" | "en"; request?: WorkbenchRequest;
  onChanged: () => void; onOpenSessions: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [abandoned, setAbandoned] = useState(false);
  const inFlight = useRef(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNeedsLogin(false);
    } catch (cause) { setError(text("登录失败：", "Sign-in failed: ") + String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function abandon(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || needsLogin || abandoned || !reason.trim() || reason.trim().length > 4000) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request(`/workbench-api/loop/specs/${encodeURIComponent(slug)}/abandon`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        setError(text("节点未失效：HTTP ", "Node not abandoned: HTTP ") + response.status);
        return;
      }
      const result = await response.json();
      if (result.slug !== slug || result.stage !== "abandoned" || !Number.isInteger(result.version) || result.version < 1) throw new Error("Invalid abandonment receipt");
      setAbandoned(true); onChanged();
    } catch (cause) { setError(text("失效结果未确认；请刷新节点核对：", "Abandonment outcome unconfirmed; refresh the node to check: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  if (abandoned) return <p role="status">{text("节点已失效。", "Node abandoned.")}</p>;
  if (!open) return <button type="button" className="wb-button" onClick={() => setOpen(true)}><Ban size={14} />{text("使节点失效", "Abandon node")}</button>;
  return <section className="wb-panel space-y-2" data-tone="danger" aria-label={text("使节点失效", "Abandon node")}>
    <h3>{text("使节点失效", "Abandon node")}</h3>
    <p>{text("先停止原执行，再明确提交节点失效；此操作不会自动停止会话。", "Stop original execution first, then explicitly abandon the node. This action does not stop sessions.")}</p>
    {needsLogin ? <form onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required disabled={busy} value={key} onChange={(event) => setKey(event.target.value)} /></label>
      <button type="submit" className="wb-button" disabled={busy || !key}>{text("登录", "Sign in")}</button>
    </form> : <form onSubmit={(event) => void abandon(event)}>
      <label>{text("失效原因", "Abandonment reason")}<textarea className="block w-full rounded border bg-background p-2" required maxLength={4000} disabled={busy} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <button type="submit" className="wb-button" disabled={busy || !reason.trim()}><Ban size={14} />{text("确认使节点失效", "Confirm node abandonment")}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="wb-button" onClick={onOpenSessions}><ArrowUpRight size={14} />{text("查看原执行会话", "View original sessions")}</button>
    {error && <button type="button" className="wb-button" disabled={busy} onClick={onChanged}>{text("刷新节点", "Refresh node")}</button>}
  </section>;
}
