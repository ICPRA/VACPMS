import { useRef, useState, type FormEvent } from "react";
import { GitMerge, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ReviewSourceFields } from "./ReviewSourceFields";
import type { ReviewSource, WorkbenchRequest } from "./workbenchModel";

type WorkbenchMergeRelation = { fromSlug: string; toSlug: string; type: string; changeId: string };
type WorkbenchMergePreview = { sources: Array<{ id: string; slug: string; version: number; stage: string; role: "work" | "summary" }>;
  contexts: Array<{ id: string; slug: string; version: number; stage: string; role: "work" | "summary" }>;
  relations: WorkbenchMergeRelation[]; lineage: WorkbenchMergeRelation[]; ancestors: Array<{ goalSlug: string; references: unknown }> };
type WorkbenchMergeRequest = { expected: WorkbenchMergePreview; target: { slug: string; intent: string; role: "work" | "summary";
  priority: "p0" | "p1" | "p2" | "p3"; complexity: "low" | "medium" | "high"; notes?: string;
  sparkOutput?: unknown; shapeOutput?: unknown; specifyOutput?: unknown };
  relations: Array<{ before: WorkbenchMergeRelation; action: "retain" | "remove" | "rewire"; replacements?: WorkbenchMergeRelation[] }>;
  addedRelations: WorkbenchMergeRelation[]; dispositions: Array<{ goalSlug: string; affectedSlug: string; disposition: "withdraw" | "replace";
    replacementSlug?: string; reviewDecisionId: string; beforeSources: ReviewSource[]; afterSources: ReviewSource[]; reason: string; idempotencyKey: string }>;
  reason: string; idempotencyKey: string };
type WorkbenchMergeReceipt = { id: string; idempotencyKey: string; request: WorkbenchMergeRequest; actorUserId: string;
  sources: Array<{ slug: string }>; target: { slug: string }; createdAt: string };
type WorkbenchMergeHistory = { items: WorkbenchMergeReceipt[]; hasMore: boolean; nextCursor: string };

type RelationChoice = { before: WorkbenchMergeRelation; action: "" | "retain" | "remove" | "rewire"; replacements: WorkbenchMergeRelation[] };
type Disposition = { goalSlug: string; affectedSlug: string; disposition: "" | "withdraw" | "replace"; replacementSlug: string;
  reviewDecisionId: string; beforeSources: ReviewSource[]; afterSources: ReviewSource[]; reason: string; idempotencyKey: string };
type TargetDraft = { slug: string; intent: string; role: "work" | "summary"; priority: "p0" | "p1" | "p2" | "p3";
  complexity: "low" | "medium" | "high"; notes: string; sparkOutput: string; shapeOutput: string; specifyOutput: string };
type Proposal = { id: string; project: string; anchor: string; sourceSlugs: string[]; baseline: WorkbenchMergePreview | null;
  target: TargetDraft; relations: RelationChoice[]; addedRelations: WorkbenchMergeRelation[]; dispositions: Disposition[]; reason: string };
type Pending = { project: string; body: WorkbenchMergeRequest };
const DRAFT_KEY = "workbench.node-merge-proposal.v1";
const PENDING_KEY = "workbench.pending-node-merge.v1";
const blankRelation = (): WorkbenchMergeRelation => ({ fromSlug: "", toSlug: "", type: "BLOCKS", changeId: "" });
const blankSource = (slug: string): ReviewSource => ({ kind: "specgraph", specSlug: slug, field: "", changeId: "" });
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const same = (left: unknown, right: unknown): boolean => Array.isArray(left) && Array.isArray(right)
  ? left.length === right.length && left.every((item, index) => same(item, right[index]))
  : left !== null && right !== null && typeof left === "object" && typeof right === "object"
    ? Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => same((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
    : left === right;
const initial = (project: string, anchor: string): Proposal => ({ id: newKey(), project, anchor, sourceSlugs: [anchor], baseline: null,
  target: { slug: "", intent: "", role: "work", priority: "p2", complexity: "medium", notes: "", sparkOutput: "", shapeOutput: "", specifyOutput: "" },
  relations: [], addedRelations: [], dispositions: [], reason: "" });
const contextsFor = (proposal: Proposal, specs: Array<{ slug: string }>) => [...new Set([...proposal.relations.flatMap((choice) => choice.replacements), ...proposal.addedRelations]
  .flatMap((relation) => [relation.fromSlug, relation.toSlug])
  .filter((slug) => slug && slug !== proposal.target.slug && !proposal.sourceSlugs.includes(slug) && specs.some((spec) => spec.slug === slug)))];

function readSlot<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > 512 * 1024) throw new Error("Saved merge record exceeds its limit");
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || (key === DRAFT_KEY
    ? typeof (value as Proposal).id !== "string" || typeof (value as Proposal).project !== "string" ||
      typeof (value as Proposal).anchor !== "string" || !Array.isArray((value as Proposal).sourceSlugs) ||
      !Array.isArray((value as Proposal).relations) || !Array.isArray((value as Proposal).addedRelations) ||
      !Array.isArray((value as Proposal).dispositions) || typeof (value as Proposal).target !== "object" ||
      typeof (value as Proposal).target?.slug !== "string" || typeof (value as Proposal).target?.intent !== "string"
    : typeof (value as Pending).project !== "string" || typeof (value as Pending).body?.idempotencyKey !== "string" ||
      !Array.isArray((value as Pending).body?.expected?.sources) || !(value as Pending).body.expected.sources.length ||
      typeof (value as Pending).body.expected.sources[0]?.slug !== "string")) throw new Error("Invalid saved merge record");
  return value as T;
}
function writeSlot(key: string, value: unknown) {
  const raw = JSON.stringify(value);
  if (new TextEncoder().encode(raw).length > 512 * 1024) throw new Error("Merge record exceeds its storage limit");
  localStorage.setItem(key, raw);
}
function completedSource(source: ReviewSource) {
  return source.kind === "specgraph" ? !!source.specSlug.trim() && !!source.field.trim() && !!source.changeId.trim()
    : !!source.environmentId.trim() && !!source.repositoryRoot.trim() && !!source.commitSha.trim() && !!source.path.trim();
}

export function MergePanel({ project, anchor, specs, owners, language, request, onChanged }: {
  project: string; anchor: string; specs: Array<{ slug: string; title: string; stage: string; role?: "work" | "summary" }>;
  owners?: Array<{ taskSlug: string; humanOwnerUserId: string | null; pendingOperationId: string | null }>;
  language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [open, setOpen] = useState(false);
  const [proposal, setProposal] = useState(() => initial(project, anchor));
  const [saved, setSaved] = useState<{ proposal: Proposal | null; pending: Pending | null; error: string }>(() => {
    try { return { proposal: readSlot<Proposal>(DRAFT_KEY), pending: readSlot<Pending>(PENDING_KEY), error: "" }; }
    catch (cause) { return { proposal: null, pending: null, error: String(cause) }; }
  });
  const [preview, setPreview] = useState<WorkbenchMergePreview | null>(null);
  const [sourceDetails, setSourceDetails] = useState<Array<{ slug: string; spec: unknown }>>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<WorkbenchMergeHistory | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [identityConflict, setIdentityConflict] = useState(false);
  const [credential, setCredential] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const inFlight = useRef(false);
  const headers = { "X-Specgraph-Project": project, "Content-Type": "application/json" };
  const locked = busy || !!saved.pending || !!saved.error;
  const ownDraft = saved.proposal?.project === project && saved.proposal.anchor === anchor ? saved.proposal : null;

  function edit(change: (current: Proposal) => Proposal) { setProposal(change); setConfirmed(false); setNotice(""); }
  async function post<T>(path: string, body: unknown, forProject = project): Promise<T> {
    const response = await request(`/workbench-api/loop/node-merges${path}`, { method: "POST", headers: { ...headers, "X-Specgraph-Project": forProject }, body: JSON.stringify(body) });
    if (response.status === 401) setNeedsLogin(true);
    if (!response.ok) {
      const result = await response.json() as { error?: string };
      throw Object.assign(new Error(result.error || `HTTP ${response.status}`), { status: response.status });
    }
    return response.json() as Promise<T>;
  }
  async function loadPreview() {
    if (inFlight.current || proposal.sourceSlugs.length < 2 || saved.pending) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice(""); setConfirmed(false); setPreview(null); setSourceDetails([]);
    try {
      const contextSlugs = contextsFor(proposal, specs);
      const next = await post<WorkbenchMergePreview>("/preview", { sourceSlugs: proposal.sourceSlugs, ...(contextSlugs.length ? { contextSlugs } : {}) });
      if (!same(next.sources.map((source) => source.slug).sort(), [...proposal.sourceSlugs].sort())) throw new Error("Merge preview source mismatch");
      if (!same(next.contexts.map((source) => source.slug).sort(), [...contextSlugs].sort())) throw new Error("Merge preview context mismatch");
      const details = await Promise.all([...next.sources, ...next.contexts].map(async (source) => {
        const response = await request(`/workbench-api/wb/specs/${encodeURIComponent(source.slug)}`, { headers, cache: "no-store" });
        if (response.status === 401) setNeedsLogin(true);
        if (!response.ok) throw new Error(`Source ${source.slug}: HTTP ${response.status}`);
        const result = await response.json() as { spec?: { slug: string; version: number } };
        if (!result.spec || result.spec.slug !== source.slug || result.spec.version !== source.version) throw new Error(`Source ${source.slug} changed; read again`);
        return { slug: source.slug, spec: result.spec };
      }));
      setPreview(next); setSourceDetails(details);
      setProposal((current) => ({ ...current, relations: next.relations.map((before) => current.relations.find((choice) => same(choice.before, before)) ?? { before, action: "", replacements: [] }) }));
      setNeedsLogin(false);
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function readHistory(more = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const page = await post<WorkbenchMergeHistory>("/history", { taskSlug: anchor, ...(more && history?.hasMore ? { beforeId: history.nextCursor } : {}) });
      setHistory(more && history ? { ...page, items: [...history.items, ...page.items] } : page);
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function reconcile() {
    const pending = saved.pending;
    if (inFlight.current || !pending) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false); setIdentityConflict(false);
    try {
      let beforeId: string | undefined;
      for (;;) {
        const page = await post<WorkbenchMergeHistory>("/history", { taskSlug: pending.body.expected.sources[0]!.slug, ...(beforeId ? { beforeId } : {}) }, pending.project);
        const match = page.items.find((item) => item.idempotencyKey === pending.body.idempotencyKey);
        if (match) {
          const receipt = await post<WorkbenchMergeReceipt>("/receipt", { id: match.id }, pending.project);
          if (!same(receipt.request, pending.body) || receipt.idempotencyKey !== pending.body.idempotencyKey) {
            setIdentityConflict(true); setError(text("原身份对应不同合并，保持冻结。", "Original identity belongs to a different merge; controls remain frozen."));
          } else {
            localStorage.removeItem(PENDING_KEY); setSaved((state) => ({ ...state, pending: null }));
            setNotice(`${text("已观察到原合并", "Original merge observed")}: ${receipt.id} · ${receipt.actorUserId}`); onChanged();
          }
          break;
        }
        if (!page.hasMore) { setRetryReady(true); setError(text("原历史无此请求；仅可明确重试原请求。", "Original history has no matching request; only an explicit retry of the original request is allowed.")); break; }
        if (!page.nextCursor || page.nextCursor === beforeId) throw new Error("Invalid merge history cursor");
        beforeId = page.nextCursor;
      }
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function send(body: WorkbenchMergeRequest, retry = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice(""); setRetryReady(false);
    if (!retry) {
      try {
        const existing = readSlot<Pending>(PENDING_KEY);
        if (existing) throw new Error("Resolve the original merge request first");
        writeSlot(PENDING_KEY, { project, body });
        setSaved((state) => ({ ...state, pending: { project, body } }));
      } catch (cause) { setError(`${text("原请求未能保存，未发送：", "Original request could not be saved; nothing was sent: ")}${String(cause)}`); inFlight.current = false; setBusy(false); return; }
    }
    try {
      const receipt = await post<WorkbenchMergeReceipt>("", body, retry ? saved.pending!.project : project);
      if (receipt.idempotencyKey !== body.idempotencyKey || !same(receipt.request, body) || receipt.target.slug !== body.target.slug) throw new Error("Merge receipt mismatch");
      localStorage.removeItem(PENDING_KEY); setSaved((state) => ({ ...state, pending: null }));
      setPreview(null); setConfirmed(false); setNotice(`${text("合并已记录", "Merge recorded")}: ${receipt.id} · ${receipt.actorUserId}`); onChanged();
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status && status < 500 && status !== 401) {
        localStorage.removeItem(PENDING_KEY); setSaved((state) => ({ ...state, pending: null }));
        setPreview(null); setConfirmed(false);
        setError(`${text("合并被明确拒绝；请重读并重新确认：", "Merge explicitly rejected; reread and reconfirm: ")}${String(cause)}`);
      } else setError(`${text("原请求结果未确认；先读原历史：", "Original request outcome unconfirmed; read original history first: ")}${String(cause)}`);
    } finally { inFlight.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || !preview || !contextsMatch || !confirmed || sourceDetails.length !== preview.sources.length + preview.contexts.length) return;
    try {
      if (!proposal.target.slug.trim() || !proposal.target.intent.trim() || !proposal.reason.trim() || proposal.relations.length !== preview.relations.length ||
        proposal.relations.some((choice, index) => !same(choice.before, preview.relations[index]) || !choice.action || choice.action === "rewire" && !choice.replacements.length) ||
        [...proposal.relations.flatMap((choice) => choice.replacements), ...proposal.addedRelations].some((relation) => !relation.fromSlug.trim() || !relation.toSlug.trim() || !relation.type.trim()))
        throw new Error(text("请完成目标与每条原关系的处置。", "Complete the target and every original relation decision."));
      const output = (raw: string) => raw.trim() ? JSON.parse(raw) : undefined;
      const target = { slug: proposal.target.slug.trim(), intent: proposal.target.intent.trim(), role: proposal.target.role,
        priority: proposal.target.priority, complexity: proposal.target.complexity,
        ...(proposal.target.notes.trim() ? { notes: proposal.target.notes.trim() } : {}),
        ...(proposal.target.sparkOutput.trim() ? { sparkOutput: output(proposal.target.sparkOutput) } : {}),
        ...(proposal.target.shapeOutput.trim() ? { shapeOutput: output(proposal.target.shapeOutput) } : {}),
        ...(proposal.target.specifyOutput.trim() ? { specifyOutput: output(proposal.target.specifyOutput) } : {}) };
      if (proposal.dispositions.some((item) => !item.goalSlug || !item.affectedSlug || !item.disposition || !item.reason.trim() ||
        !item.reviewDecisionId.trim() || !item.beforeSources.length || !item.afterSources.length ||
        !item.beforeSources.every(completedSource) || !item.afterSources.every(completedSource) || item.disposition === "replace" && !item.replacementSlug.trim()))
        throw new Error(text("请完成每条新增祖先义务处置及原审批来源。", "Complete every new ancestor obligation disposition and original approval sources."));
      const body: WorkbenchMergeRequest = { expected: preview, target, relations: proposal.relations.map(({ before, action, replacements }) => ({ before,
        action: action as "retain" | "remove" | "rewire", ...(action === "rewire" ? { replacements } : {}) })),
        addedRelations: proposal.addedRelations, dispositions: proposal.dispositions.map((item) => ({ goalSlug: item.goalSlug,
          affectedSlug: item.affectedSlug, disposition: item.disposition as "withdraw" | "replace", ...(item.disposition === "replace" ? { replacementSlug: item.replacementSlug } : {}),
          reviewDecisionId: item.reviewDecisionId, beforeSources: item.beforeSources, afterSources: item.afterSources,
          reason: item.reason, idempotencyKey: item.idempotencyKey })), reason: proposal.reason.trim(), idempotencyKey: newKey() };
      void send(body);
    } catch (cause) { setError(String(cause)); }
  }
  function saveDraft() {
    try {
      const current = readSlot<Proposal>(DRAFT_KEY);
      if (current && current.id !== proposal.id) throw new Error(`Another proposal is saved for ${current.project} / ${current.anchor}; restore or discard it first`);
      const next = { ...proposal, baseline: preview ?? proposal.baseline };
      writeSlot(DRAFT_KEY, next); setSaved((state) => ({ ...state, proposal: next }));
      setNotice(text("提案已保存在本机。", "Proposal saved locally.")); setError("");
    } catch (cause) { setError(`${text("提案未保存：", "Proposal not saved: ")}${String(cause)}`); }
  }
  function restoreDraft() {
    if (!ownDraft || locked) return;
    setProposal(ownDraft); setPreview(null); setSourceDetails([]); setConfirmed(false); setNotice("");
    setError(text("已恢复提案；重新读取来源与关系并确认后才能提交。", "Proposal restored; reread sources and relations, then reconfirm before submission."));
  }
  function discardDraft() {
    if (!saved.proposal || locked) return;
    try {
      const current = readSlot<Proposal>(DRAFT_KEY);
      if (!current || current.id !== saved.proposal.id) throw new Error("Saved proposal identity changed");
      localStorage.removeItem(DRAFT_KEY); setSaved((state) => ({ ...state, proposal: null }));
      if (proposal.id === current.id) { setProposal(initial(project, anchor)); setPreview(null); setSourceDetails([]); setConfirmed(false); }
      setError(""); setNotice(text("本机提案已丢弃。", "Local proposal discarded."));
    } catch (cause) { setError(String(cause)); }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    if (!credential || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: credential }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setCredential(""); setNeedsLogin(false);
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const relationInput = (value: WorkbenchMergeRelation, change: (value: WorkbenchMergeRelation) => void, label: string) =>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">{(["fromSlug", "toSlug", "type"] as const).map((field) =>
      <label key={field}>{field}{field === "type" ? <select className="w-full min-w-0" aria-label={`${label} ${field}`} value={value.type} disabled={locked}
        onChange={(event) => change({ ...value, type: event.target.value, changeId: "" })}>{["BLOCKS", "DEPENDS_ON", "COMPOSES", "RELATES_TO", "INFORMS", "DECIDED_IN"].map((type) => <option key={type}>{type}</option>)}</select>
        : <input className="w-full min-w-0" aria-label={`${label} ${field}`} value={value[field]} disabled={locked}
          onChange={(event) => change({ ...value, [field]: event.target.value, changeId: "" })} />}</label>)}</div>;
  const sourceInputs = (sources: ReviewSource[], change: (value: ReviewSource[]) => void, label: string) => <div className="space-y-2">
    {sources.map((source, index) => <div key={index} className="border-t pt-2"><ReviewSourceFields source={source} slug={anchor} labelPrefix={`${label} ${index + 1}`} language={language} disabled={locked}
      onChange={(value) => change(sources.map((item, at) => at === index ? value : item))} />
      <button type="button" className="wb-button" disabled={locked} onClick={() => change(sources.filter((_, at) => at !== index))}><Trash2 size={14} />{text("移除", "Remove")}</button></div>)}
    <button type="button" className="wb-button" disabled={locked} onClick={() => change([...sources, blankSource(anchor)])}><Plus size={14} />{text("添加来源", "Add source")}</button>
  </div>;
  const contextsMatch = !!preview && same(preview.contexts.map((source) => source.slug).sort(), contextsFor(proposal, specs).sort());

  return <section className="wb-panel space-y-3" aria-label={text("节点合并与沿革", "Node merge and lineage")}>
    <button type="button" className="wb-button" aria-expanded={open} onClick={() => setOpen(!open)}><GitMerge size={14} />{text("节点合并与沿革", "Node merge and lineage")}</button>
    {open && <>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="wb-button" disabled={busy} onClick={() => void readHistory()}><RefreshCw size={14} />{text("读取此节点合并历史", "Read this node's merge history")}</button>
        {history?.hasMore && <button type="button" className="wb-button" disabled={busy} onClick={() => void readHistory(true)}>{text("更多历史", "More history")}</button>}
      </div>
      {history && <div className="divide-y">{history.items.map((item) => <p key={item.id} className="py-1 break-words">{item.id} · {item.sources.map((source) => source.slug).join(" + ")} → {item.target.slug} · {item.actorUserId} · {item.createdAt}</p>)}</div>}
      {saved.error && <p role="alert">{saved.error}</p>}
      {saved.proposal && <div className="flex flex-wrap items-center gap-2">
        <span>{text("本机提案", "Local proposal")}: {saved.proposal.project} / {saved.proposal.anchor}</span>
        {ownDraft && <button type="button" className="wb-button" disabled={locked} onClick={restoreDraft}><RefreshCw size={14} />{text("恢复", "Restore")}</button>}
        <button type="button" className="wb-button" disabled={locked} onClick={discardDraft}><Trash2 size={14} />{text("丢弃", "Discard")}</button>
      </div>}
      {saved.pending && <div role="status" className="space-y-2 border-y py-2">
        <p>{text("原合并请求冻结", "Original merge request frozen")}: {saved.pending.project} / {saved.pending.body.target.slug} · {saved.pending.body.idempotencyKey}</p>
        <button type="button" className="wb-button" disabled={busy} onClick={() => void reconcile()}><RefreshCw size={14} />{text("读取原receipt/历史核对", "Read original receipt/history")}</button>
        {retryReady && !identityConflict && <button type="button" className="wb-button" disabled={busy} onClick={() => void send(saved.pending!.body, true)}>{text("明确重试原请求", "Explicitly retry original request")}</button>}
      </div>}
      <fieldset disabled={locked} className="space-y-3">
        <legend className="font-medium">{text("合并提案", "Merge proposal")}</legend>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{specs.filter((spec) => spec.stage !== "superseded" || proposal.sourceSlugs.includes(spec.slug)).map((spec) =>
          <label key={spec.slug} className="flex items-start gap-2 break-words"><input type="checkbox" checked={proposal.sourceSlugs.includes(spec.slug)} disabled={spec.slug === anchor || locked}
            onChange={(event) => { edit((current) => ({ ...current, sourceSlugs: event.target.checked ? [...current.sourceSlugs, spec.slug] : current.sourceSlugs.filter((slug) => slug !== spec.slug) })); setPreview(null); setSourceDetails([]); }} />{spec.slug} · {spec.title} · {spec.stage}{owners?.find((owner) => owner.taskSlug === spec.slug)?.humanOwnerUserId ? ` · ${text("人工负责人", "Human owner")}: ${owners.find((owner) => owner.taskSlug === spec.slug)!.humanOwnerUserId}` : ""}{owners?.find((owner) => owner.taskSlug === spec.slug)?.pendingOperationId ? ` · ${text("待接手", "Pending takeover")}: ${owners.find((owner) => owner.taskSlug === spec.slug)!.pendingOperationId}` : ""}</label>)}</div>
        <div className="flex flex-wrap gap-2"><button type="button" className="wb-button" disabled={locked || proposal.sourceSlugs.length < 2} onClick={() => void loadPreview()}><RefreshCw size={14} />{text("读取来源与关系基线", "Read source and relation baseline")}</button>
          <button type="button" className="wb-button" disabled={locked} onClick={saveDraft}>{text("保存本机提案", "Save local proposal")}</button></div>
        {preview && <>
          {proposal.baseline && !same(proposal.baseline, preview) && <p role="alert">{text("保存时基线已变化；下方为新基线，请重新审查全部决定。", "Saved baseline changed; review all decisions against the new baseline below.")}</p>}
          {!contextsMatch && <p role="alert">{text("外部端点已变化；重新读取来源与关系基线。", "External endpoints changed; read the source and relation baseline again.")}</p>}
          <div className="space-y-2">{sourceDetails.map(({ slug, spec }) => <details key={slug}><summary>{slug} · v{[...preview.sources, ...preview.contexts].find((source) => source.slug === slug)?.version}</summary>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(spec, null, 2)}</pre></details>)}</div>
          <details><summary>{text("完整原关系、沿革与外部端点", "Complete original relations, lineage and external endpoints")}</summary>
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ relations: preview.relations, lineage: preview.lineage, contexts: preview.contexts }, null, 2)}</pre></details>
          <details><summary>{text("各祖先目标原引用", "Original ancestor goal references")}</summary>
            {preview.ancestors.map((ancestor) => <div key={ancestor.goalSlug} className="border-t py-2"><strong>{ancestor.goalSlug}</strong><pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(ancestor.references, null, 2)}</pre></div>)}</details>
        </>}
        <form className="space-y-3" onSubmit={submit}>
          <fieldset className="grid grid-cols-1 gap-2 sm:grid-cols-2"><legend className="font-medium">{text("新目标 C", "New target C")}</legend>
            <label>{text("标识", "Identifier")}<input className="w-full" value={proposal.target.slug} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, slug: event.target.value } }))} /></label>
            <label>{text("角色", "Role")}<select value={proposal.target.role} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, role: event.target.value as TargetDraft["role"] } }))}><option value="work">work</option><option value="summary">summary</option></select></label>
            <label className="sm:col-span-2">{text("目标", "Goal")}<textarea className="w-full" value={proposal.target.intent} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, intent: event.target.value } }))} /></label>
            <label>{text("优先级", "Priority")}<select value={proposal.target.priority} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, priority: event.target.value as TargetDraft["priority"] } }))}>{["p0", "p1", "p2", "p3"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>{text("复杂度", "Complexity")}<select value={proposal.target.complexity} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, complexity: event.target.value as TargetDraft["complexity"] } }))}>{["low", "medium", "high"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="sm:col-span-2">{text("备注", "Notes")}<textarea className="w-full" value={proposal.target.notes} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, notes: event.target.value } }))} /></label>
            {(["sparkOutput", "shapeOutput", "specifyOutput"] as const).map((field) => <label key={field} className="sm:col-span-2">{field} · JSON<textarea className="w-full font-mono text-xs" value={proposal.target[field]} onChange={(event) => edit((current) => ({ ...current, target: { ...current.target, [field]: event.target.value } }))} /></label>)}
          </fieldset>
          {preview && <fieldset className="space-y-2"><legend className="font-medium">{text("逐条原关系处置", "Original relation decisions")}</legend>
            {proposal.relations.map((choice, index) => <div key={`${choice.before.fromSlug}:${choice.before.toSlug}:${choice.before.type}:${choice.before.changeId}`} className="space-y-2 border-t py-2">
              <p className="break-words">{choice.before.fromSlug} → {choice.before.toSlug} · {choice.before.type} · {choice.before.changeId}</p>
              <label>{text("处置", "Decision")}<select aria-label={`Relation decision ${index}`} value={choice.action} onChange={(event) => edit((current) => ({ ...current, relations: current.relations.map((item, at) => at === index ? { ...item, action: event.target.value as RelationChoice["action"], replacements: event.target.value === "rewire" ? item.replacements.length ? item.replacements : [blankRelation()] : [] } : item) }))}>
                <option value="">{text("未决定", "Undecided")}</option><option value="retain">retain</option><option value="remove">remove</option><option value="rewire">rewire</option></select></label>
              {choice.action === "rewire" && <>{choice.replacements.map((replacement, at) => <div key={at} className="flex items-end gap-2">{relationInput(replacement, (value) => edit((current) => ({ ...current, relations: current.relations.map((item, i) => i === index ? { ...item, replacements: item.replacements.map((old, j) => j === at ? value : old) } : item) })), `Replacement ${index}-${at}`)}
                <button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, relations: current.relations.map((item, i) => i === index ? { ...item, replacements: item.replacements.filter((_, j) => j !== at) } : item) }))}><Trash2 size={14} /></button></div>)}
                <button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, relations: current.relations.map((item, i) => i === index ? { ...item, replacements: [...item.replacements, blankRelation()] } : item) }))}><Plus size={14} />{text("替代关系", "Replacement relation")}</button></>}
            </div>)}</fieldset>}
          <fieldset className="space-y-2"><legend className="font-medium">{text("新增关系", "Added relations")}</legend>
            {proposal.addedRelations.map((relation, index) => <div key={index} className="flex items-end gap-2">{relationInput(relation, (value) => edit((current) => ({ ...current, addedRelations: current.addedRelations.map((item, at) => at === index ? value : item) })), `Added ${index}`)}<button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, addedRelations: current.addedRelations.filter((_, at) => at !== index) }))}><Trash2 size={14} /></button></div>)}
            <button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, addedRelations: [...current.addedRelations, blankRelation()] }))}><Plus size={14} />{text("新增关系", "Add relation")}</button>
          </fieldset>
          <fieldset className="space-y-2"><legend className="font-medium">{text("祖先目标义务处置", "Ancestor goal obligation dispositions")}</legend>
            {proposal.dispositions.map((item, index) => <div key={item.idempotencyKey} className="space-y-2 border-t py-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><label>{text("祖先目标", "Ancestor goal")}<select value={item.goalSlug} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, goalSlug: event.target.value } : old) }))}><option value="">-</option>{preview?.ancestors.map((ancestor) => <option key={ancestor.goalSlug}>{ancestor.goalSlug}</option>)}</select></label>
                <label>{text("受影响节点", "Affected node")}<input className="w-full" value={item.affectedSlug} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, affectedSlug: event.target.value } : old) }))} /></label>
                <label>{text("处置", "Disposition")}<select value={item.disposition} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, disposition: event.target.value as Disposition["disposition"] } : old) }))}><option value="">-</option><option value="withdraw">withdraw</option><option value="replace">replace</option></select></label></div>
              {item.disposition === "replace" && <label>{text("替代节点", "Replacement node")}<input className="w-full" value={item.replacementSlug} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, replacementSlug: event.target.value } : old) }))} /></label>}
              <label>{text("原批准决定 ID", "Original approval decision ID")}<input className="w-full" value={item.reviewDecisionId} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, reviewDecisionId: event.target.value } : old) }))} /></label>
              <fieldset><legend>{text("变更前来源", "Before sources")}</legend>{sourceInputs(item.beforeSources, (value) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, beforeSources: value } : old) })), `Before ${index}`)}</fieldset>
              <fieldset><legend>{text("变更后来源", "After sources")}</legend>{sourceInputs(item.afterSources, (value) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, afterSources: value } : old) })), `After ${index}`)}</fieldset>
              <label>{text("原因", "Reason")}<textarea className="w-full" value={item.reason} onChange={(event) => edit((current) => ({ ...current, dispositions: current.dispositions.map((old, at) => at === index ? { ...old, reason: event.target.value } : old) }))} /></label>
              <button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, dispositions: current.dispositions.filter((_, at) => at !== index) }))}><Trash2 size={14} />{text("移除处置", "Remove disposition")}</button>
            </div>)}
            <button type="button" className="wb-button" onClick={() => edit((current) => ({ ...current, dispositions: [...current.dispositions, { goalSlug: "", affectedSlug: "", disposition: "", replacementSlug: "", reviewDecisionId: "", beforeSources: [], afterSources: [], reason: "", idempotencyKey: newKey() }] }))}><Plus size={14} />{text("新增原义务处置", "Add original obligation disposition")}</button>
          </fieldset>
          {preview && <div className="space-y-1 border-t pt-2"><strong>{text("最终关系差异", "Final relation difference")}</strong>
            <p>{text("删除", "Delete")}: {proposal.relations.filter((item) => item.action === "remove" || item.action === "rewire").map((item) => `${item.before.fromSlug} → ${item.before.toSlug} (${item.before.type})`).join("; ") || "-"}</p>
            <p>{text("新增", "Insert")}: {[...proposal.relations.flatMap((item) => item.action === "rewire" ? item.replacements : []), ...proposal.addedRelations].map((item) => `${item.fromSlug} → ${item.toSlug} (${item.type})`).join("; ") || "-"}</p>
            <p>{text("新沿革", "New lineage")}: {preview.sources.map((source) => `${proposal.target.slug || "C"} → ${source.slug}`).join("; ")}</p>
          </div>}
          <label>{text("合并原因", "Merge reason")}<textarea className="w-full" value={proposal.reason} onChange={(event) => edit((current) => ({ ...current, reason: event.target.value }))} /></label>
          <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={!preview || !contextsMatch || locked || sourceDetails.length !== preview.sources.length + preview.contexts.length} onChange={(event) => setConfirmed(event.target.checked)} />{text("我已核对当前来源、全部原关系、祖先义务及最终差异", "I reviewed current sources, every original relation, ancestor obligations and the final difference")}</label>
          <button type="submit" className="wb-button" disabled={!preview || !contextsMatch || !confirmed || locked}><GitMerge size={14} />{text("一次提交正式合并", "Commit formal merge once")}</button>
        </form>
      </fieldset>
      {needsLogin && <form onSubmit={(event) => void login(event)}><label>{text("操作凭据", "Operator credential")}<input type="password" autoComplete="off" value={credential} onChange={(event) => setCredential(event.target.value)} /></label><button type="submit" className="wb-button" disabled={busy || !credential}>{text("登录", "Sign in")}</button></form>}
      {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    </>}
  </section>;
}
