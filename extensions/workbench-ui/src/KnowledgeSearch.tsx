import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

type Result = { query: string; scope: string; hasMore: boolean; items: Array<{
  kind: string; id: string; slug: string; title: string; status: string; version: number; excerpt: string; updatedAt: string;
}> };

export function KnowledgeSearch({ project, language, request, onOpenNode, renderRepositorySearch }: {
  project: string; language: "zh" | "en"; request?: WorkbenchRequest; onOpenNode: (slug: string) => void;
  renderRepositorySearch?: (query: string, specgraphProject: string, question: string) => ReactNode;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [source, setSource] = useState<{ kind: string; id: string; version: number; record: unknown; searchedVersion: number } | null>(null);
  const [key, setKey] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  async function search(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (inFlight.current || term.length < 2 || term.length > 200) return;
    setSubmittedQuery(term);
    inFlight.current = true; setBusy(true); setError(""); setResult(null); setSource(null);
    try {
      if (!request) return;
      if (needsLogin) {
        if (!key) return;
        const login = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        if (!login.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + login.status);
        setNeedsLogin(false);
      }
      const response = await request(`/workbench-api/knowledge-search?q=${encodeURIComponent(term)}`, { headers: { "X-Specgraph-Project": project } });
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (!response.ok) throw new Error(text("检索失败：", "Search failed: ") + response.status);
      const body = await response.json();
      if (body.scope !== "specgraph-records" || !Array.isArray(body.items) || typeof body.hasMore !== "boolean") throw new Error("Invalid search response");
      setResult(body);
    } catch (cause) { setError(String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }
  async function readSource(item: Result["items"][number]) {
    if (inFlight.current || !request) return;
    inFlight.current = true; setBusy(true); setError(""); setSource(null);
    try {
      const reference = item.kind === "change" ? item.id : item.slug;
      const response = await request(`/workbench-api/knowledge/${item.kind}/${encodeURIComponent(reference)}`, { headers: { "X-Specgraph-Project": project } });
      if (!response.ok) throw new Error(text("原文读取失败：", "Source read failed: ") + response.status);
      const body = await response.json();
      if (body.id !== item.id || body.kind !== item.kind || !Number.isInteger(body.version) || !("record" in body)) throw new Error("Invalid source response");
      setSource({ ...body, searchedVersion: item.version });
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }
  return <section>
    <h2>{text("资料检索", "Knowledge search")}</h2>
    <form onSubmit={(event) => void search(event)}>
      <label>{text("关键词（2–200个字符）", "Query (2–200 characters)")}<input required minLength={2} maxLength={200} value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} /></label>
      {needsLogin && <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>}
      <button type="submit" className="wb-button" disabled={busy || query.trim().length < 2 || query.trim().length > 200}><Search size={14} />{text("搜索", "Search")}</button>
    </form>
    <h3>{text("SpecGraph 项目记录", "SpecGraph project records")} · {project}</h3>
    <p>{text("范围：规格、决定、变更记录。", "Scope: specs, decisions and change records.")}</p>
    {!request && <p role="status">{text("此连接未提供 SpecGraph 记录检索。", "SpecGraph record search is unavailable on this connection.")}</p>}
    {needsLogin && <p role="status">{text("SpecGraph 需要登录；其他来源的检索不受影响。", "SpecGraph requires sign-in; other sources remain available.")}</p>}
    {error && <p role="alert">{error}</p>}
    {result && <>
      <p role="status">{result.query} · {result.items.length}{result.hasMore ? "+" : ""} {text("条记录", "records")}</p>
      {!result.items.length && <p>{text("此范围未匹配；不代表项目没有相关实现。", "No matches in this scope; this does not establish that no implementation exists.")}</p>}
      {result.items.map((item) => <article key={`${item.kind}:${item.id}`} className="border-b py-3">
        <h3>{item.title}</h3><p>{item.kind} · {item.status} · v{item.version} · {item.updatedAt}</p>
        <p className="whitespace-pre-wrap break-words">{item.excerpt}</p>
        <p className="break-all text-xs">{item.id} · {item.slug}</p>
        <button type="button" className="wb-button" disabled={busy} onClick={() => void readSource(item)}>{text("读取原文", "Read source")}</button>
        {item.kind !== "decision" && <button type="button" className="wb-button" onClick={() => onOpenNode(item.slug)}>{text("查看节点", "Open node")}</button>}
      </article>)}
      {result.hasMore && <p>{text("仍有更多匹配，请缩小关键词范围。", "More matches exist; narrow the query.")}</p>}
    </>}
    {source && <section aria-label={text("记录原文", "Source record")}>
      <h3>{source.kind} · {source.id} · v{source.version}</h3>
      {source.version !== source.searchedVersion && <p role="status">{text("来源已变化，当前显示最新版本；搜索结果版本为", "Source changed; showing current version. Search result version:")} {source.searchedVersion}</p>}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(source.record, null, 2)}</pre>
    </section>}
    {renderRepositorySearch?.(submittedQuery, project, query)}
  </section>;
}
