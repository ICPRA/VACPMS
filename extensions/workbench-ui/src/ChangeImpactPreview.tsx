import { useEffect, useRef, useState } from "react";
import { GitCompareArrows, LogIn, RefreshCw } from "lucide-react";
import { ScopeDetails, type Scope } from "./SubdivisionPanel";
import type { WorkbenchRequest } from "./workbenchModel";

type Preview = {
  specSlug: string;
  scope: Scope;
  nodes: Array<{ id: string; slug: string; intent: string; stage: string; role: string; version: number; scopeRevision: string; parentSlugs: string[] }>;
  relations: Array<{ from: string; to: string; type: string }>;
};

export function ChangeImpactPreview({ project, slug, language, onSelect, request = fetch }: {
  project: string; slug: string; language: "zh" | "en"; onSelect: (slug: string) => void; request?: WorkbenchRequest;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  async function load(login = false) {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    setBusy(true); setError(""); setPreview(null);
    try {
      if (login) {
        const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }), signal });
        if (!response.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + response.status);
      }
      const response = await request(`/workbench-api/loop/specs/${encodeURIComponent(slug)}/change-preview`, { headers: { "X-Specgraph-Project": project }, cache: "no-store", signal });
      controller.signal.throwIfAborted();
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (response.status === 403) throw new Error(text("当前账号无法读取这些来源。", "This account cannot read these sources."));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as Preview;
      if (body.specSlug !== slug || !Array.isArray(body.nodes) || !body.nodes.some((node) => node.slug === slug) || !body.nodes.every((node) => typeof node.slug === "string" && typeof node.intent === "string" && typeof node.scopeRevision === "string" && /^(0|[1-9]\d*)$/.test(node.scopeRevision) && Array.isArray(node.parentSlugs)) || !Array.isArray(body.relations) || !Array.isArray(body.scope?.sources) || !Array.isArray(body.scope.relations) || !Array.isArray(body.scope.decisions)) throw new Error("Invalid change preview response");
      if (controller.signal.aborted) return;
      setPreview(body); setNeedsLogin(false);
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause));
    } finally {
      if (!controller.signal.aborted) { setBusy(false); setKey(""); }
    }
  }

  return <section className="wb-panel space-y-2" aria-label={text("需求变更影响", "Requirement change impact")}>
    <button type="button" className="wb-button" disabled={busy} onClick={() => void load()}>
      {preview ? <RefreshCw size={14} /> : <GitCompareArrows size={14} />}{text("变更影响预览", "Preview change impact")}
    </button>
    {busy && <p role="status">{text("读取中…", "Loading…")}</p>}
    {needsLogin && <form onSubmit={(event) => { event.preventDefault(); void load(true); }}>
      <label>{text("操作凭据", "Operator credential")}<input type="password" autoComplete="off" value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button type="submit" className="wb-button" disabled={busy || !key}><LogIn size={14} />{text("登录", "Sign in")}</button>
    </form>}
    {error && <p role="alert">{error}</p>}
    {preview && <>
      <h4>{text("结构影响候选（非撤销决定）", "Structural candidates (not withdrawal decisions)")} · {preview.nodes.length}</h4>
      <ScopeDetails scope={preview.scope} language={language} />
      <ul className="space-y-2">{preview.nodes.map((node) => <li key={node.id} className="border-t py-2">
        <button type="button" className="text-left underline" onClick={() => onSelect(node.slug)}>{node.intent} · {node.slug}</button>
        <p>{node.stage} · {node.role} · v{node.version} · {text("范围修订", "Scope revision")} {node.scopeRevision}</p>
        {!!node.parentSlugs.length && <p>{text("关联父目标", "Parent goals")}: {node.parentSlugs.join(", ")}</p>}
      </li>)}</ul>
      <details><summary>{text("影响关系", "Impact relations")} · {preview.relations.length}</summary>
        {preview.relations.map((edge, index) => <p key={index}>{edge.from} → {edge.to} · {edge.type}</p>)}
      </details>
    </>}
  </section>;
}
