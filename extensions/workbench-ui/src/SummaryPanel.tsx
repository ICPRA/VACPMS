import { useRef, useState, type FormEvent } from "react";
import { Check, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { ReviewSourceFields } from "./ReviewSourceFields";
import type { ReviewSource, WorkbenchRequest } from "./workbenchModel";

type References = { nodes: unknown[]; relations: unknown[]; dispositionIds: string[]; decisionSources: unknown[] };
type Disposition = { id: string; goalSlug: string; affectedSlug: string; disposition: string; replacementSlug?: string; reviewDecisionId: string;
  beforeSources: ReviewSource[]; afterSources: ReviewSource[]; reason: string; idempotencyKey: string; actorKind: string; actorUserId: string; createdAt: string };
type Acceptance = { id: string; goalSlug: string; basis: string; evidenceSources: ReviewSource[]; goalsSatisfied: boolean; idempotencyKey: string;
  expectedReferences: References; impactReview: Array<{ slug: string; basis: string; dispositionId?: string }>;
  actorKind: string; actorUserId: string; createdAt: string; revokedAt: string | null; revokedByUserId: string | null; revokedByRunId: string | null; revocationReason: string | null; current: boolean };
type Summary = { goalSlug: string; acceptable: boolean; accepted: boolean; blockers: Array<{ slug: string; code: string }>;
  obligations: Array<{ slug: string; role: string; stage: string; disposition: string; dispositionId?: string; effective: boolean; pendingReview: boolean }>;
  latestAcceptance: Acceptance | null; dispositions: Disposition[]; references: References; changedSources: Array<{ slug: string; field: string; before: string; after: string }>;
  scopeChanged: boolean; reviewCandidates: string[] };
type History = { dispositions: Disposition[]; acceptances: Acceptance[]; dispositionsCursor: string; acceptancesCursor: string };
type Pending = { kind: "disposition" | "accept" | "revoke"; body: Record<string, unknown> };
const blankSource = (slug: string): ReviewSource => ({ kind: "specgraph", specSlug: slug, field: "", changeId: "" });
const completeSource = (source: ReviewSource) => source.kind === "specgraph" ? !!source.specSlug.trim() && !!source.field.trim() && !!source.changeId.trim()
  : !!source.environmentId.trim() && !!source.repositoryRoot.trim() && !!source.commitSha.trim() && !!source.path.trim();
const validText = (value: string) => !!value.trim() && new TextEncoder().encode(value).length <= 4000 && !value.includes("\0");
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const sameSources = (left: ReviewSource[], right: ReviewSource[]) => left.length === right.length && left.every((source, index) => {
  const other = right[index]!;
  return source.kind === other.kind && (source.kind === "specgraph" ? other.kind === "specgraph" &&
    source.specSlug === other.specSlug && source.field === other.field && source.changeId === other.changeId : other.kind === "git" &&
    source.environmentId === other.environmentId && source.repositoryRoot === other.repositoryRoot && source.commitSha === other.commitSha &&
    source.path === other.path && (source.entry ?? "") === (other.entry ?? ""));
});
const sameValue = (left: unknown, right: unknown): boolean => Array.isArray(left) && Array.isArray(right)
  ? left.length === right.length && left.every((value, index) => sameValue(value, right[index]))
  : left !== null && right !== null && typeof left === "object" && typeof right === "object"
    ? Object.keys(left).length === Object.keys(right).length && Object.keys(left).every((key) => sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
    : left === right;

function sameRequest(kind: Pending["kind"], record: Disposition | Acceptance, body: Record<string, unknown>) {
  if (kind === "revoke") return record.id === body.acceptanceId && (record as Acceptance).revocationReason === body.reason &&
    !!(record as Acceptance).revokedAt && !!(record as Acceptance).revokedByUserId && (record as Acceptance).revokedByRunId === null;
  if (record.goalSlug !== body.goalSlug || record.idempotencyKey !== body.idempotencyKey) return false;
  if (kind === "disposition") {
    const item = record as Disposition;
    return item.affectedSlug === body.affectedSlug && item.disposition === body.disposition && (item.replacementSlug ?? "") === (body.replacementSlug ?? "") &&
      item.reviewDecisionId === body.reviewDecisionId && item.reason === body.reason && sameSources(item.beforeSources, body.beforeSources as ReviewSource[]) &&
      sameSources(item.afterSources, body.afterSources as ReviewSource[]);
  }
  const item = record as Acceptance;
  const reviews = body.impactReview as Acceptance["impactReview"];
  return item.basis === body.basis && item.goalsSatisfied === body.goalsSatisfied && sameSources(item.evidenceSources, body.evidenceSources as ReviewSource[]) &&
    sameValue(item.expectedReferences, body.expectedReferences) && item.impactReview.length === reviews.length &&
    item.impactReview.every((review, index) => review.slug === reviews[index]?.slug && review.basis === reviews[index]?.basis &&
      (review.dispositionId ?? "") === (reviews[index]?.dispositionId ?? ""));
}

export function SummaryPanel({ project, goalSlug, language, request, onChanged }: {
  project: string; goalSlug: string; language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [affectedSlug, setAffectedSlug] = useState("");
  const [disposition, setDisposition] = useState<"needs_review" | "retain" | "adjust" | "replace" | "withdraw">("needs_review");
  const [replacementSlug, setReplacementSlug] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [beforeSources, setBeforeSources] = useState<ReviewSource[]>([]);
  const [afterSources, setAfterSources] = useState<ReviewSource[]>([]);
  const [dispositionReason, setDispositionReason] = useState("");
  const [basis, setBasis] = useState("");
  const [evidenceSources, setEvidenceSources] = useState<ReviewSource[]>([]);
  const [goalsSatisfied, setGoalsSatisfied] = useState(false);
  const [impactBasis, setImpactBasis] = useState<Record<string, string>>({});
  const [impactDisposition, setImpactDisposition] = useState<Record<string, string>>({});
  const [revokeReason, setRevokeReason] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/loop/summaries/${encodeURIComponent(goalSlug)}`;

  async function get(url: string) {
    const response = await request(url, { headers: { "X-Specgraph-Project": project }, cache: "no-store" });
    if (response.status === 401) setNeedsLogin(true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  function checkSummary(value: unknown): Summary {
    const state = (value as { summary?: Summary })?.summary;
    if (state?.goalSlug !== goalSlug || typeof state.acceptable !== "boolean" || typeof state.accepted !== "boolean" ||
      !Array.isArray(state.obligations) || !Array.isArray(state.blockers) || !Array.isArray(state.changedSources) ||
      !Array.isArray(state.reviewCandidates) || !state.references || !Array.isArray(state.references.nodes) ||
      !Array.isArray(state.references.relations) || !Array.isArray(state.references.dispositionIds) ||
      !Array.isArray(state.references.decisionSources)) throw new Error("Summary scope or response mismatch");
    return state;
  }

  function checkHistory(value: unknown, kind: "dispositions" | "acceptances") {
    const page = (value as { history?: { goalSlug: string; kind: string; dispositions?: Disposition[]; acceptances?: Acceptance[]; hasMore: boolean; nextCursor: string } })?.history;
    if (page?.goalSlug !== goalSlug || page.kind !== kind || typeof page.hasMore !== "boolean" || typeof page.nextCursor !== "string" ||
      page.hasMore !== (page.nextCursor.length > 0) || !Array.isArray(page[kind] ?? [])) throw new Error("Summary history scope or response mismatch");
    return { items: page[kind] ?? [], cursor: page.hasMore ? page.nextCursor : "" };
  }

  function reconcile(command: Pending | null, records: History) {
    if (!command) return;
    const items = command.kind === "disposition" ? records.dispositions : records.acceptances;
    const found = command.kind === "revoke"
      ? (items as Acceptance[]).find((entry) => entry.id === command.body.acceptanceId)
      : items.find((entry) => entry.idempotencyKey === command.body.idempotencyKey);
    if (found) {
      if (command.kind === "revoke" && !(found as Acceptance).revokedAt) {
        setRetryReady(true); setError(text("原接受尚未撤回；仅可明确重试原请求。", "Original acceptance is not revoked; only the original request may be explicitly retried."));
        return;
      }
      const matches = sameRequest(command.kind, found, command.body);
      if (matches) {
        pendingRef.current = null; setPending(null); setRetryReady(false); setConflict(false); setError("");
        setSaved(`${text("已观察到对应原记录；实际记录者", "Matching original record observed; actual recorder")}: ${command.kind === "revoke" ? (found as Acceptance).revokedByUserId : found.actorUserId}`); onChanged();
      } else { setConflict(true); setError(text("同一原身份存在不同记录；保持冻结。", "A different record has the original identity; controls remain frozen.")); }
    } else if (!(command.kind === "disposition" ? records.dispositionsCursor : records.acceptancesCursor)) {
      setRetryReady(true);
      setError(text("尚无匹配记录；仅可明确重试原请求。", "No matching record yet; only the original request may be explicitly retried."));
    }
  }

  async function readAll() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false);
    setSummary(null); setHistory(null);
    try {
      const [current, dispositions, acceptances] = await Promise.all([
        get(endpoint), get(`${endpoint}/history?kind=dispositions`), get(`${endpoint}/history?kind=acceptances`),
      ]);
      const state = checkSummary(current);
      const d = checkHistory(dispositions, "dispositions"), a = checkHistory(acceptances, "acceptances");
      const next: History = { dispositions: d.items as Disposition[], dispositionsCursor: d.cursor, acceptances: a.items as Acceptance[], acceptancesCursor: a.cursor };
      setSummary(state); setHistory(next); setNeedsLogin(false); setGoalsSatisfied(false); setConfirmRevoke(false); reconcile(pendingRef.current, next);
    } catch (cause) { setError(text("原汇总读取失败：", "Original summary read failed: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function readMore(kind: "dispositions" | "acceptances") {
    const cursor = kind === "dispositions" ? history?.dispositionsCursor : history?.acceptancesCursor;
    if (inFlight.current || !cursor || !history) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false);
    try {
      const result = checkHistory(await get(`${endpoint}/history?kind=${kind}&cursor=${encodeURIComponent(cursor)}`), kind);
      const next = { ...history, [kind]: [...history[kind], ...result.items], [`${kind}Cursor`]: result.cursor } as History;
      setHistory(next); reconcile(pendingRef.current, next);
    } catch (cause) { setSummary(null); setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function send(command: Pending) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSaved(""); setRetryReady(false);
    pendingRef.current = command; setPending(command);
    try {
      const response = await request(`/workbench-api/loop/summaries/${command.kind === "disposition" ? "disposition" : command.kind === "accept" ? "accept" : "revoke"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(command.body),
      });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) {
        if (response.status < 500) {
          pendingRef.current = null; setPending(null); setConflict(false); setSummary(null); setHistory(null);
          setGoalsSatisfied(false); setConfirmRevoke(false);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      const record = await response.json() as Disposition | Acceptance;
      const valid = sameRequest(command.kind, record, command.body);
      if (!valid || record.goalSlug !== goalSlug || (command.kind !== "revoke" && (record.actorKind !== "human" || !record.actorUserId))) throw new Error("Summary operation receipt mismatch");
      pendingRef.current = null; setPending(null); setConflict(false);
      setSummary(null); setHistory(null);
      setSaved(`${text("已记录；实际记录者", "Recorded; actual recorder")}: ${command.kind === "revoke" ? (record as Acceptance).revokedByUserId : record.actorUserId}`); onChanged();
    } catch (cause) { setError(text("汇总操作未确认或被拒绝；请读取原记录核对：", "Summary action unconfirmed or rejected; read the original record: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !key) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setKey(""); setNeedsLogin(false);
    } catch (cause) { setError(`${text("登录失败", "Sign-in failed")}: ${String(cause)}`); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const formal = disposition !== "needs_review";
  const canDisposition = !!summary && !!affectedSlug && validText(dispositionReason) && (!formal || !!decisionId.trim() && beforeSources.length > 0 && afterSources.length > 0 && beforeSources.every(completeSource) && afterSources.every(completeSource)) &&
    (disposition !== "replace" || !!replacementSlug);
  const canAccept = !!summary?.acceptable && goalsSatisfied && validText(basis) && evidenceSources.length > 0 && evidenceSources.every(completeSource) &&
    summary.reviewCandidates.every((slug) => validText(impactBasis[slug] ?? ""));
  const locked = busy || !!pending || needsLogin;
  const sourceFields = (sources: ReviewSource[], set: (value: ReviewSource[]) => void, prefix: string) => <div className="space-y-1">
    {sources.map((source, index) => <div key={index} className="border-b py-2"><ReviewSourceFields source={source} slug={goalSlug} labelPrefix={`${prefix} ${index + 1}`} language={language} disabled={locked}
      onChange={(value) => set(sources.map((item, i) => i === index ? value : item))} />
      <button type="button" className="wb-button" disabled={locked} onClick={() => set(sources.filter((_, i) => i !== index))}><Trash2 size={14} />{text("移除来源", "Remove source")}</button></div>)}
    <button type="button" className="wb-button" disabled={locked} onClick={() => set([...sources, blankSource(goalSlug)])}><Plus size={14} />{text("添加来源", "Add source")}</button>
  </div>;

  return <section aria-label={text("汇总目标", "Summary goal")} className="wb-panel space-y-3">
    <h3>{text("汇总目标", "Summary goal")}: {goalSlug}</h3>
    <p>{text("各祖先目标的义务独立；调整本目标不改变其他目标。接受不会完成未完成工作或更改节点阶段。", "Each ancestor goal has independent obligations. Adjusting this goal does not change another goal; acceptance does not complete unfinished work or change node stage.")}</p>
    <button type="button" className="wb-button" disabled={busy} onClick={() => void readAll()}><RefreshCw size={14} />{text("读取当前汇总与历史", "Read current summary and history")}</button>
    {needsLogin && <form onSubmit={(event) => void login(event)}><label>{text("SpecGraph操作凭据", "SpecGraph operator credential")}<input aria-label="Summary access key" type="password" value={key} onChange={(event) => setKey(event.target.value)} /></label><button type="submit" className="wb-button" disabled={!key || busy}>{text("登录", "Sign in")}</button></form>}
    {summary && history && <>
      <p>{text("当前可接受", "Currently acceptable")}: {summary.acceptable ? text("是", "yes") : text("否", "no")} · {text("当前已接受", "Currently accepted")}: {summary.accepted ? text("是", "yes") : text("否", "no")}</p>
      {summary.blockers.map((blocker) => <p key={`${blocker.slug}:${blocker.code}`} role="status">{text("阻碍", "Blocker")}: {blocker.slug} · {blocker.code}</p>)}
      <ul aria-label="Summary obligations" className="divide-y">{summary.obligations.map((item) => <li key={item.slug} className="py-1">{item.slug} · {item.stage} · {item.disposition} · {item.effective ? text("有效义务", "effective obligation") : text("已明确排除", "explicitly excluded")}{item.pendingReview ? ` · ${text("待审核", "review pending")}` : ""}</li>)}</ul>
      {summary.changedSources.map((change) => <p key={`${change.slug}:${change.field}`} className="break-all">{text("来源变化", "Source change")}: {change.slug} / {change.field} · {change.before} → {change.after}</p>)}
      <p>{text("当前引用（元数据，不是原文或哈希裁决）", "Current references (metadata, not source text or a hash verdict)")}</p><pre className="max-h-32 overflow-auto text-xs">{JSON.stringify(summary.references, null, 2)}</pre>
      <form aria-label="Record summary disposition" className="space-y-2 border-t pt-2" onSubmit={(event) => { event.preventDefault(); if (canDisposition && !locked) void send({ kind: "disposition", body: { goalSlug, affectedSlug, disposition, ...(disposition === "replace" ? { replacementSlug } : {}), reviewDecisionId: formal ? decisionId.trim() : "", beforeSources: formal ? beforeSources : [], afterSources: formal ? afterSources : [], reason: dispositionReason.trim(), idempotencyKey: newKey() } }); }}>
        <h4>{text("目标义务处置", "Goal obligation disposition")}</h4>
        <label>{text("受影响节点", "Affected node")}<select aria-label="Summary affected node" disabled={locked} value={affectedSlug} onChange={(event) => setAffectedSlug(event.target.value)}><option value="">{text("选择节点", "Select node")}</option>{summary.obligations.filter((item) => item.slug !== goalSlug).map((item) => <option key={item.slug} value={item.slug}>{item.slug} · {item.stage}</option>)}</select></label>
        <label>{text("处置", "Disposition")}<select aria-label="Summary disposition" disabled={locked} value={disposition} onChange={(event) => setDisposition(event.target.value as typeof disposition)}>{(["needs_review", "retain", "adjust", "replace", "withdraw"] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        {disposition === "replace" && <label>{text("替代节点", "Replacement node")}<select aria-label="Summary replacement node" disabled={locked} value={replacementSlug} onChange={(event) => setReplacementSlug(event.target.value)}><option value="">{text("选择替代节点", "Select replacement")}</option>{summary.obligations.filter((item) => item.effective && item.slug !== affectedSlug).map((item) => <option key={item.slug} value={item.slug}>{item.slug}</option>)}</select></label>}
        {formal && <><label>{text("原批准决定ID", "Original approval decision ID")}<input aria-label="Summary review decision ID" disabled={locked} value={decisionId} onChange={(event) => setDecisionId(event.target.value)} /></label>
          <fieldset><legend>{text("变更前来源", "Before sources")}</legend>{sourceFields(beforeSources, setBeforeSources, "Summary before source")}</fieldset>
          <fieldset><legend>{text("变更后来源", "After sources")}</legend>{sourceFields(afterSources, setAfterSources, "Summary after source")}</fieldset></>}
        <label>{text("原因", "Reason")}<textarea aria-label="Summary disposition reason" disabled={locked} maxLength={4000} value={dispositionReason} onChange={(event) => setDispositionReason(event.target.value)} /></label>
        <button type="submit" className="wb-button" disabled={locked || !canDisposition}><Check size={14} />{text("记录本目标处置", "Record this goal disposition")}</button>
      </form>
      <form aria-label="Accept summary" className="space-y-2 border-t pt-2" onSubmit={(event) => { event.preventDefault(); if (canAccept && !locked) void send({ kind: "accept", body: { goalSlug, basis: basis.trim(), evidenceSources, goalsSatisfied: true, idempotencyKey: newKey(), expectedReferences: summary.references,
        impactReview: summary.reviewCandidates.map((slug) => ({ slug, basis: impactBasis[slug]!.trim(), ...(impactDisposition[slug] ? { dispositionId: impactDisposition[slug] } : {}) })) } }); }}>
        <h4>{text("接受汇总目标", "Accept summary goal")}</h4>
        <label>{text("接受依据", "Acceptance basis")}<textarea aria-label="Summary acceptance basis" disabled={locked} maxLength={4000} value={basis} onChange={(event) => setBasis(event.target.value)} /></label>
        <fieldset><legend>{text("成果来源", "Evidence sources")}</legend>{sourceFields(evidenceSources, setEvidenceSources, "Summary evidence source")}</fieldset>
        {summary.reviewCandidates.map((slug) => <div key={slug} className="space-y-1"><p>{text("影响复核", "Impact review")}: {slug}</p>
          <textarea aria-label={`Summary impact basis ${slug}`} disabled={locked} maxLength={4000} value={impactBasis[slug] ?? ""} onChange={(event) => setImpactBasis({ ...impactBasis, [slug]: event.target.value })} />
          <select aria-label={`Summary impact disposition ${slug}`} disabled={locked} value={impactDisposition[slug] ?? ""} onChange={(event) => setImpactDisposition({ ...impactDisposition, [slug]: event.target.value })}><option value="">{text("无适用处置", "No applicable disposition")}</option>{summary.obligations.filter((item) => item.slug === slug && item.dispositionId && !item.pendingReview).map((item) => <option key={item.dispositionId} value={item.dispositionId}>{item.dispositionId}</option>)}</select>
        </div>)}
        <label className="flex items-start gap-2"><input aria-label="Confirm summary goals satisfied" type="checkbox" disabled={locked} checked={goalsSatisfied} onChange={(event) => setGoalsSatisfied(event.target.checked)} />{text("明确声明当前目标与有效义务满足；并非自动完成未完成节点", "Explicitly declare the current goal and effective obligations satisfied; this does not complete unfinished nodes")}</label>
        <button type="submit" className="wb-button" disabled={locked || !canAccept}><Check size={14} />{text("接受当前汇总", "Accept current summary")}</button>
      </form>
      {summary.latestAcceptance && !summary.latestAcceptance.revokedAt && <form aria-label="Revoke summary acceptance" className="space-y-2 border-t pt-2" onSubmit={(event) => { event.preventDefault(); if (!locked && confirmRevoke && validText(revokeReason)) void send({ kind: "revoke", body: { acceptanceId: summary.latestAcceptance!.id, reason: revokeReason.trim() } }); }}>
        <h4>{text("撤回确切接受", "Revoke exact acceptance")}: {summary.latestAcceptance.id}</h4>
        <label>{text("撤回原因", "Revocation reason")}<textarea aria-label="Summary revocation reason" disabled={locked} maxLength={4000} value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} /></label>
        <label className="flex items-start gap-2"><input aria-label="Confirm summary revocation" type="checkbox" disabled={locked} checked={confirmRevoke} onChange={(event) => setConfirmRevoke(event.target.checked)} />{text("确认撤回此接受记录，不删除历史或更改子节点完成", "Confirm revoking this acceptance without deleting history or changing child completion")}</label>
        <button type="submit" className="wb-button" disabled={locked || !confirmRevoke || !validText(revokeReason)}><X size={14} />{text("撤回此接受", "Revoke this acceptance")}</button>
        {confirmRevoke && <button type="button" className="wb-button" onClick={() => setConfirmRevoke(false)}>{text("取消", "Cancel")}</button>}
      </form>}
      {(["dispositions", "acceptances"] as const).map((kind) => <details key={kind}><summary>{kind === "dispositions" ? text("义务处置历史", "Disposition history") : text("目标接受历史", "Acceptance history")}</summary>
        {(history[kind] as Array<Disposition | Acceptance>).map((item) => <p key={item.id} className="break-all border-b py-1">{item.id} · {item.actorUserId} · {item.createdAt} · {kind === "dispositions" ? (item as Disposition).affectedSlug + " / " + (item as Disposition).disposition : (item as Acceptance).revokedAt ? `${text("已撤回者", "revoked by")} ${(item as Acceptance).revokedByUserId}` : (item as Acceptance).current ? text("当前有效", "current") : text("历史记录", "historical")}</p>)}
        {history[`${kind}Cursor`] && <button type="button" className="wb-button" disabled={busy} onClick={() => void readMore(kind)}><Plus size={14} />{text("读取更多原历史", "Read more original history")}</button>}
      </details>)}
    </>}
    {pending && <p role="status">{text("原请求保持冻结", "Original request remains frozen")}: {pending.kind} · {String(pending.body.idempotencyKey ?? pending.body.acceptanceId)}</p>}
    {pending && retryReady && !conflict && <button type="button" className="wb-button" disabled={busy} onClick={() => void send(pending)}><RefreshCw size={14} />{text("明确重试原请求", "Explicitly retry original request")}</button>}
    {pending && conflict && <button type="button" className="wb-button" disabled={busy} onClick={() => { pendingRef.current = null; setPending(null); setConflict(false); setSummary(null); setHistory(null); setError(text("原冲突请求已放弃；先重读当前汇总。", "Conflicting original request discarded; read the current summary before another action.")); }}>{text("放弃冲突请求", "Discard conflicting request")}</button>}
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{saved}</p>}
  </section>;
}
