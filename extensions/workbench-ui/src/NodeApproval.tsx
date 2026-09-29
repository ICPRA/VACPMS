import { useRef, useState, type FormEvent } from "react";
import { Check, RefreshCw } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

export function NodeApproval({ project, slug, version, language, request, onChanged }: {
  project: string; slug: string; version: number; language: "zh" | "en";
  request: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refreshRequired, setRefreshRequired] = useState(false);
  const inFlight = useRef(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || refreshRequired || !basis.trim()) return;
    inFlight.current = true; setBusy(true); setError("");
    let sent = false;
    try {
      if (needsLogin) {
        const login = await request("/workbench-api/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
        });
        if (!login.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + login.status);
        setNeedsLogin(false);
      }
      sent = true;
      const response = await request(`/workbench-api/loop/specs/${encodeURIComponent(slug)}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify({ expectedVersion: version, basis: basis.trim() }),
      });
      if (!response.ok) {
        if (response.status === 401) { setNeedsLogin(true); return; }
        if (response.status === 409) setRefreshRequired(true);
        const result = await response.json();
        setError(result.error || text("审核未通过：", "Approval rejected: ") + response.status);
        if (response.status >= 500) setRefreshRequired(true);
        return;
      }
      const result = await response.json();
      if (result.approved !== slug || result.version !== version + 1) throw new Error("Invalid approval receipt");
      setRefreshRequired(true);
      onChanged();
    } catch (cause) {
      setRefreshRequired(sent);
      setError((sent ? text("结果未确认，请刷新节点。", "Result unconfirmed; refresh the node. ") : "") + String(cause));
    } finally {
      setKey(""); setBusy(false); inFlight.current = false;
    }
  }

  if (!open) return <button type="button" className="wb-button" onClick={() => setOpen(true)}><Check size={14} />{text("审核并允许执行", "Approve for execution")}</button>;
  return <form className="wb-manual-completion" aria-label={text("节点执行审核", "Node execution approval")} onSubmit={(event) => void submit(event)}>
    <strong>{text("节点执行审核", "Node execution approval")} · v{version}</strong>
    <label>{text("审核依据", "Approval basis")}<textarea required maxLength={4000} value={basis} disabled={busy || refreshRequired} onChange={(event) => setBasis(event.target.value)} /></label>
    {needsLogin && <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>}
    {error && <p role="alert">{error}</p>}
    {refreshRequired ? <button type="button" className="wb-button" onClick={onChanged}><RefreshCw size={14} />{text("刷新节点", "Refresh node")}</button>
      : <button type="submit" className="wb-button" disabled={busy || !basis.trim()}><Check size={14} />{text("批准执行", "Approve execution")}</button>}
    <button type="button" className="wb-button" disabled={busy} onClick={() => setOpen(false)}>{text("关闭", "Close")}</button>
  </form>;
}
