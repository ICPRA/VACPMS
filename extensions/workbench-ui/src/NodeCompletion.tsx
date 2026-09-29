import { useRef, useState, type FormEvent } from "react";
import { Check, LogOut } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

type Identity = { subject: string; display_name: string; role: string };

export function NodeCompletion({ project, slug, version, language, onCompleted, request = fetch }: {
  project: string;
  slug: string;
  version: number;
  language: "zh" | "en";
  onCompleted: () => void;
  request?: WorkbenchRequest;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [completed, setCompleted] = useState(false);
  const inFlight = useRef(false);
  // Retain the exact command after an uncertain response; retry must not create a second assertion.
  const attempt = useRef<{ expected_version: number; idempotency_key: string; note: string } | null>(null);

  async function authenticate(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setOpen(true);
    setBusy(true);
    setError("");
    try {
      const response = await request(`/workbench-api/api/auth/${event ? "login" : "whoami"}`, event ? {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
      } : undefined);
      if (response.status === 401) {
        setIdentity(null);
        if (event) setError(text("凭据无效或已过期。", "Credential invalid or expired."));
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { identity: Identity };
      if (!body.identity || typeof body.identity.subject !== "string") throw new Error("Invalid identity response");
      setIdentity(body.identity);
    } catch (cause) {
      setError(text("认证服务不可用：", "Authentication unavailable: ") + String(cause));
    } finally {
      setKey("");
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function logout() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await request("/workbench-api/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setIdentity(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function complete(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    attempt.current ??= { expected_version: version, idempotency_key: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""), note: note.trim() };
    try {
      const response = await request(`/workbench-api/loop/specs/${encodeURIComponent(slug)}/manual-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify(attempt.current),
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        setUncertain(false);
        attempt.current = null;
        if (response.status === 401) setIdentity(null);
        setError(response.status === 409
          ? text("节点版本已变化或仍被领取，请刷新节点后处理。", "Node changed or is still claimed. Refresh the node before continuing.")
          : response.status === 403
            ? text("当前账号无人工完成权限。", "This account cannot manually complete nodes.")
            : response.status === 428
              ? text("节点当前不允许人工完成，请刷新并查看其撤销、审核或执行状态。", "Manual completion is currently unavailable. Refresh and review retirement, review, or execution status.")
            : text("未完成，服务返回：", "Not completed; server returned: ") + response.status);
        return;
      }
      const result = await response.json() as { completed?: string; version?: number };
      if (result.completed !== slug || result.version !== version + 1) throw new Error("Invalid completion receipt");
      setUncertain(false);
      setCompleted(true);
      onCompleted();
    } catch (cause) {
      setUncertain(true);
      setError(text("结果尚未确认。重试会使用同一请求，不会重复记账：", "Result unconfirmed. Retry uses the same request: ") + String(cause));
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (completed) return <p role="status">{text("已记录人工完成。", "Manual completion recorded.")}</p>;
  if (!open) return <button type="button" className="wb-button" onClick={() => void authenticate()}>
    <Check size={14} aria-hidden="true" />{text("人工完成", "Complete manually")}
  </button>;
  return <section className="wb-manual-completion" aria-label={text("人工完成", "Manual completion")}>
    <strong>{text("人工完成", "Manual completion")} · v{version}</strong>
    {identity ? <>
      <div className="wb-manual-identity">
        <span>{identity.display_name || identity.subject}</span>
        <button type="button" className="wb-button" disabled={busy} onClick={() => void logout()}>
          <LogOut size={14} aria-hidden="true" />{text("退出", "Sign out")}
        </button>
      </div>
      <form onSubmit={(event) => void complete(event)}>
        <label>{text("完成说明", "Completion note")}<textarea value={note} maxLength={4000}
          disabled={busy || uncertain} onChange={(event) => setNote(event.target.value)} /></label>
        <p>{text("这是人工完成记录，不代表技术验证通过，也不会停止仍在运行的 Agent。", "This records human completion, not technical verification, and does not stop running agents.")}</p>
        <button className="wb-button" type="submit" disabled={busy}>
          <Check size={14} aria-hidden="true" />{uncertain ? text("重试同一请求", "Retry same request") : text("确认人工完成", "Confirm manual completion")}
        </button>
      </form>
    </> : <form onSubmit={(event) => void authenticate(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password"
        autoComplete="off" value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} required /></label>
      <button className="wb-button" type="submit" disabled={busy || !key}>{text("登录", "Sign in")}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {!uncertain && <button className="wb-button" type="button" disabled={busy} onClick={() => { setOpen(false); setKey(""); }}>
      {text("取消", "Cancel")}
    </button>}
  </section>;
}
