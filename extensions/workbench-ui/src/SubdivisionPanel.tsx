import { useEffect, useRef, useState, type ReactNode, type FormEvent } from "react";
import { GitBranch, Plus, RefreshCw, X } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

type Props = { project: string; slug: string; language: "zh" | "en"; onChanged: () => void; request?: WorkbenchRequest };
type Contract = { intent: string; shape: Record<string, unknown> | null; specify: Record<string, unknown> | null };
type Draft = { slug: string; intent: string; priority: string; complexity: string };
export type Scope = {
  sources: Array<{ id: string; slug: string; revision: string; contract: Contract }>;
  relations: Array<{ from: string; to: string; type: string }>;
  decisions: Array<{ Slug: string; Title: string; Status: string; Body: string; Rationale: string; Question: string; Version: number; RejectedAlternatives: unknown; SupersededBy: string; Confidence: string; Tags: string[]; Scope: string; OriginSpec: string; OriginStage: string }>;
};

// Keep every authored field readable without discarding less common shape/specify fields.
function Fields({ value }: { value: unknown }): ReactNode {
  if (value === null || value === undefined) return <span>-</span>;
  if (Array.isArray(value)) return <ul className="space-y-1">{value.map((entry, index) => <li key={index}><Fields value={entry} /></li>)}</ul>;
  if (typeof value === "object") return <dl className="space-y-2">{Object.entries(value).map(([name, entry]) => <div key={name}><dt className="font-medium">{name.replaceAll("_", " ")}</dt><dd><Fields value={entry} /></dd></div>)}</dl>;
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

export function ScopeDetails({ scope, language }: { scope: Scope; language: Props["language"] }) {
  return <div className="space-y-2 [overflow-wrap:anywhere]">
    {scope.sources.map((source) => <details key={source.id}>
      <summary>{source.slug} · {language === "zh" ? "范围修订" : "Scope revision"} {source.revision}</summary>
      <p className="whitespace-pre-wrap">{source.contract.intent}</p>
      <h4>Shape{language === "zh" ? "（范围设计）" : ""}</h4><Fields value={source.contract.shape} />
      <h4>Specify{language === "zh" ? "（规格约束）" : ""}</h4><Fields value={source.contract.specify} />
    </details>)}
    <details><summary>{language === "zh" ? "当前关联决策与关系" : "Current linked decisions and relations"}</summary>
      {scope.relations.map((relation, index) => <p key={index}>{relation.from} → {relation.to} · {relation.type}</p>)}
      {scope.decisions.map((decision) => <section key={decision.Slug} className="border-t py-2">
        <h4>{decision.Title} ({decision.Slug}) · {decision.Status} · v{decision.Version}</h4>
        <Fields value={{ question: decision.Question, body: decision.Body, rationale: decision.Rationale, rejected_alternatives: decision.RejectedAlternatives, superseded_by: decision.SupersededBy, confidence: decision.Confidence, tags: decision.Tags, scope: decision.Scope, origin_spec: decision.OriginSpec, origin_stage: decision.OriginStage }} />
      </section>)}
    </details>
  </div>;
}


export function SubdivisionPanel(props: Props) {
  const [open, setOpen] = useState(false);
  return open ? <SubdivisionForm {...props} onClose={() => setOpen(false)} /> :
    <button className="wb-button" onClick={() => setOpen(true)}><GitBranch size={14} />{props.language === "zh" ? "细分节点" : "Subdivide node"}</button>;
}

function SubdivisionForm({ project, slug, language, onChanged, onClose, request = fetch }: Props & { onClose: () => void }) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [version, setVersion] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([{ slug: "", intent: "", priority: "p2", complexity: "medium" }]);
  const [reason, setReason] = useState("");
  const [credential, setCredential] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const headers = { "X-Specgraph-Project": project, "Content-Type": "application/json" };
  async function load(signal: AbortSignal) {
    setBusy(true); setError("");
    try {
      const response = await request(`/workbench-api/wb/specs/${encodeURIComponent(slug)}`, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), cache: "no-store" });
      if (signal.aborted) return;
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json();
      if (body.spec?.slug !== slug || !Number.isSafeInteger(body.spec.version) || body.spec.version < 1) throw new Error("Invalid parent node response");
      if (!signal.aborted) setVersion(body.spec.version);
    } catch (cause) { if (!signal.aborted) setError(String(cause)); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void load(controller.signal);
    return () => controller.abort();
  }, [project, slug, request]);

  async function login() {
    if (inFlight.current || busy || !credential) return;
    const signal = lifetime.current!.signal;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: credential }), signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      signal.throwIfAborted(); setNeedsLogin(false); await load(signal);
    } catch (cause) { if (!signal.aborted) setError(String(cause)); }
    finally { inFlight.current = false; if (!signal.aborted) { setBusy(false); setCredential(""); } }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || busy || uncertain || needsLogin || version === null) return;
    if (!reason.trim() || new TextEncoder().encode(reason).length > 10000 ||
      drafts.some((draft) => !/^[a-z0-9]([a-z0-9_/-]*[a-z0-9])?$/.test(draft.slug) || draft.slug.length > 256 || draft.slug === slug || !draft.intent.trim() || new TextEncoder().encode(draft.intent).length > 10000) ||
      new Set(drafts.map((draft) => draft.slug)).size !== drafts.length) {
      setError(text("检查子节点标识、目标和拆分原因。", "Check child identifiers, goals and subdivision reason.")); return;
    }
    const lifetimeSignal = lifetime.current!.signal;
    const signal = AbortSignal.any([lifetimeSignal, AbortSignal.timeout(15000)]);
    inFlight.current = true; setBusy(true); setError("");
    let sent = false;
    try {
      sent = true;
      const response = await request(`/workbench-api/loop/specs/${encodeURIComponent(slug)}/subdivide`, {
        method: "POST", headers, signal, body: JSON.stringify({ expectedVersion: version, reason: reason.trim(), children: drafts }),
      });
      signal.throwIfAborted();
      if (response.status === 401) { sent = false; setNeedsLogin(true); return; }
      if (!response.ok) {
        if (response.status < 500) sent = false;
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      if (result.parent !== slug || typeof result.id !== "string" || !Array.isArray(result.childSlugs) || result.childSlugs.length !== drafts.length || !drafts.every((draft) => result.childSlugs.includes(draft.slug))) throw new Error("Invalid subdivision receipt");
      signal.throwIfAborted(); onChanged(); onClose();
    } catch (cause) {
      if (!lifetimeSignal.aborted) { setError(String(cause)); if (sent) setUncertain(true); }
    } finally { inFlight.current = false; if (!lifetimeSignal.aborted) { setBusy(false); setCredential(""); } }
  }

  return <form className="wb-panel space-y-3" aria-label={text("细分节点", "Subdivide node")} onSubmit={(event) => void submit(event)}>
    <header className="flex items-center justify-between"><strong>{slug} {version !== null && `· v${version}`}</strong>
      <button type="button" className="wb-button" disabled={busy} aria-label={text("关闭", "Close")} onClick={onClose}><X size={14} /></button>
    </header>
    {drafts.map((draft, index) => <fieldset key={index} className="space-y-2 border-t pt-2" disabled={busy || uncertain}>
      <legend>{text("子节点", "Child")} {index + 1}</legend>
      <label className="block">{text("标识", "Identifier")}<input className="block w-full" aria-label={`child-${index}-slug`} value={draft.slug} maxLength={256} required onChange={(event) => setDrafts(drafts.map((item, at) => at === index ? { ...item, slug: event.target.value } : item))} /></label>
      <label className="block">{text("目标", "Goal")}<textarea className="block w-full" aria-label={`child-${index}-intent`} value={draft.intent} required onChange={(event) => setDrafts(drafts.map((item, at) => at === index ? { ...item, intent: event.target.value } : item))} /></label>
      <label>{text("优先级", "Priority")} <select value={draft.priority} onChange={(event) => setDrafts(drafts.map((item, at) => at === index ? { ...item, priority: event.target.value } : item))}>{["p0", "p1", "p2", "p3"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>{text("复杂度", "Complexity")} <select value={draft.complexity} onChange={(event) => setDrafts(drafts.map((item, at) => at === index ? { ...item, complexity: event.target.value } : item))}>{["low", "medium", "high"].map((value) => <option key={value}>{value}</option>)}</select></label>
      <button type="button" className="wb-button" disabled={drafts.length === 1} aria-label={text("移除此草稿", "Remove this draft")} onClick={() => setDrafts(drafts.filter((_, at) => at !== index))}><X size={14} /></button>
    </fieldset>)}
    <button type="button" className="wb-button" disabled={busy || uncertain || drafts.length >= 32} onClick={() => setDrafts([...drafts, { slug: "", intent: "", priority: "p2", complexity: "medium" }])}><Plus size={14} />{text("添加子节点", "Add child")}</button>
    <label className="block">{text("拆分原因", "Subdivision reason")}<textarea className="block w-full" aria-label="subdivision-reason" required value={reason} disabled={busy || uncertain} onChange={(event) => setReason(event.target.value)} /></label>
    {needsLogin && <div><label className="block">{text("操作凭据", "Operator credential")}<input type="password" autoComplete="off" value={credential} disabled={busy} onChange={(event) => setCredential(event.target.value)} /></label>
      <button type="button" className="wb-button" disabled={busy || !credential} onClick={() => void login()}>{text("登录", "Sign in")}</button></div>}
    {error && <p role="alert">{error}</p>}
    {uncertain && <p role="alert">{text("结果未确认，请查看父节点和子节点后再操作。", "Outcome unconfirmed. Inspect the parent and children before another action.")}</p>}
    <button type="button" className="wb-button" disabled={busy} onClick={() => { onChanged(); void load(lifetime.current!.signal); }}><RefreshCw size={14} />{text("刷新", "Refresh")}</button>
    <button type="submit" className="wb-button" disabled={busy || uncertain || needsLogin || version === null}><GitBranch size={14} />{text("创建子节点", "Create children")}</button>
  </form>;
}
