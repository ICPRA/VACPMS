import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw, X } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

export function CreateNodeForm({ project, language, onCreated, onRefresh, onClose, request = fetch }: {
  project: string; language: "zh" | "en"; onCreated: (slug: string) => void;
  onRefresh: () => void; onClose: () => void;
  request?: WorkbenchRequest;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [slug, setSlug] = useState("");
  const [intent, setIntent] = useState("");
  const [priority, setPriority] = useState("p2");
  const [complexity, setComplexity] = useState("medium");
  const [key, setKey] = useState("");
  const [auth, setAuth] = useState<"checking" | "anonymous" | "authenticated" | "error">("checking");
  const [authAttempt, setAuthAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const scope = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    scope.current = controller;
    setAuth("checking"); setError("");
    void (async () => {
      try {
        const response = await request("/workbench-api/api/auth/whoami", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: "no-store" });
        if (controller.signal.aborted) return;
        if (response.status === 401) { setAuth("anonymous"); return; }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json();
        if (typeof body.identity?.subject !== "string") throw new Error("Invalid identity response");
        if (!controller.signal.aborted) setAuth("authenticated");
      } catch (cause) {
        if (!controller.signal.aborted) { setAuth("error"); setError(text("无法确认操作身份：", "Unable to verify identity: ") + String(cause)); }
      }
    })();
    return () => controller.abort();
  }, [authAttempt, request]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || uncertain || (auth !== "authenticated" && auth !== "anonymous")) return;
    const name = slug.trim();
    if (!/^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$/.test(name) || name.length > 256 || !intent.trim() || new TextEncoder().encode(intent).length > 10000) {
      setError(text("标识格式或目标长度不符合要求。", "Invalid identifier or intent length.")); return;
    }
    const controller = scope.current!;
    inFlight.current = true; setBusy(true); setError("");
    let sent = false;
    try {
      if (auth === "anonymous") {
        const login = await request("/workbench-api/api/auth/login", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!login.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + login.status);
        if (controller.signal.aborted) return;
        setAuth("authenticated"); setKey("");
      }
      sent = true;
      const response = await request("/workbench-api/specgraph.v1.SpecService/CreateSpec", {
        method: "POST", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        headers: { "Content-Type": "application/json", "Connect-Protocol-Version": "1", "X-Specgraph-Project": project },
        body: JSON.stringify({ slug: name, intent, priority, complexity }),
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        if (response.status === 401) setAuth("anonymous");
        setError(response.status === 409 ? text("节点标识已存在，未覆盖。", "Identifier already exists; nothing was overwritten.")
          : response.status === 403 ? text("当前账号没有创建权限。", "This account cannot create nodes.")
          : text("创建被拒绝：", "Creation rejected: ") + response.status);
        return;
      }
      const body = await response.json();
      if (body.spec?.slug !== name || body.spec?.stage !== "spark") throw new Error("Invalid creation receipt");
      if (!controller.signal.aborted) onCreated(name);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setUncertain(sent);
        setError(sent ? text("创建结果未确认。", "Creation result unconfirmed.") : String(cause));
      }
    } finally {
      inFlight.current = false;
      if (!controller.signal.aborted) { setBusy(false); setKey(""); }
    }
  }

  return <form className="wb-create-node" aria-label={text("新建需求节点", "New requirement node")} onSubmit={(event) => void submit(event)}>
    <header><h2>{text("新建需求节点", "New requirement node")} · {text("草稿", "Draft")}</h2>
      <button type="button" className="wb-button" aria-label={text("关闭新建节点", "Close node creation")} disabled={busy} onClick={onClose}><X size={16} /></button></header>
    <label>{text("节点标识", "Identifier")}<input value={slug} maxLength={256} required disabled={busy || uncertain} onChange={(event) => setSlug(event.target.value)} /></label>
    <label>{text("需求目标", "Intent")}<textarea value={intent} maxLength={10000} required disabled={busy || uncertain} onChange={(event) => setIntent(event.target.value)} /></label>
    <div className="wb-create-options">
      <label>{text("优先级", "Priority")}<select value={priority} disabled={busy || uncertain} onChange={(event) => setPriority(event.target.value)}>{["p0", "p1", "p2", "p3"].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
      <label>{text("复杂度", "Complexity")}<select value={complexity} disabled={busy || uncertain} onChange={(event) => setComplexity(event.target.value)}><option value="low">{text("低", "Low")}</option><option value="medium">{text("中", "Medium")}</option><option value="high">{text("高", "High")}</option></select></label>
    </div>
    {auth === "anonymous" && <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} disabled={busy} required /></label>}
    {error && <p role="alert">{error}</p>}
    {auth === "error" ? <button type="button" className="wb-button" onClick={() => setAuthAttempt((value) => value + 1)}><RefreshCw size={14} />{text("重试身份检查", "Retry identity check")}</button>
      : uncertain ? <button type="button" className="wb-button" onClick={onRefresh}><RefreshCw size={14} />{text("刷新节点列表", "Refresh node list")}</button>
      : <button type="submit" className="wb-button" disabled={busy || auth === "checking"}><Plus size={14} />{text("创建草稿", "Create draft")}</button>}
  </form>;
}
