import { useRef, useState, type FormEvent } from "react";
import { Ban, Check, RefreshCw, Square } from "lucide-react";
import type { ReviewSource, WorkbenchRequest, WorkbenchRun } from "./workbenchModel";

type Condition = { value: "true" | "false" | "unknown"; reason: string; reports: Array<{ id: string; deliveryId: string; commitSha: string; status: string; createdAt: string }>; missingPlans: ReviewSource[] };
type SatisfactionJudgment = { id: string; runId: string; attemptId: string; deliveryId: string; value: "true" | "false" | "unknown"; reason: string;
  actorUserId: string; actorRunId?: string; recordedAt: string; predecessorId?: string };
type Intervention = { id: string; runId: string; attemptId: string; judgmentId: string; reportIds: string[]; conflictKind: string; reason: string; recordedAt: string;
  resolvedAt?: string; resolvedByUserId?: string; resolutionReason?: string; resolutionJudgmentId?: string; resolutionReportIds?: string[] };
type SatisfactionBasis = { value: "true" | "false" | "unknown"; judgmentId: string; reportIds: string[]; interventionId?: string };
type JoinJudgment = { id: string; flowId: string; conditionKey: string; value: string; inputRefs: ReviewSource[]; reason: string; actorUserId: string; actorRunId?: string; recordedAt: string; predecessorId?: string };
type JoinFact = { value: string; reason?: string; report?: { id: string; deliveryId: string; commitSha: string; status: string }; judgment?: JoinJudgment };
type JoinMember = { runId: string; conditionKey: string; state: string; admissionId?: string; basis?: JoinFact & { flowId: string; conditionKey: string }; completion?: { id: string; runId: string; taskSlug: string } };
type JoinEvaluation = { satisfied: boolean; reason?: string; participants: JoinMember[]; unknown: JoinMember[]; conditions: Array<{ key: string; evaluation: JoinFact }>;
  witness?: { id: string; runId: string; taskSlug: string }; explicitSkip: boolean };
type JoinProof = { sourceAttemptId: string; flowId: string; mode: string; evaluation: JoinEvaluation };
type Attempt = { id: string; number: number; grantedAt: string; predecessorId?: string; deliveryId?: string; consumedCondition?: Condition; flowId?: string; consumedJoin?: JoinProof; consumedSatisfaction?: SatisfactionBasis };
type CandidateLoop = { runId: string; taskSlug: string; packageId: string; maxAttempts: number; planSources: ReviewSource[]; configuredBy: string; configuredAt: string;
  terminationKind: "report" | "satisfaction"; satisfaction?: { criterion: string; value: "true" | "false" | "unknown"; reason?: string; judgment?: SatisfactionJudgment; intervention?: Intervention };
  attempts: Attempt[]; currentAttempt?: Attempt; condition?: Condition; status: string; stop?: { actorUserId: string; reason: string; recordedAt: string };
  abandon?: { actorUserId: string; reason: string; recordedAt: string }; completedAt?: string;
  join?: { mode: string; allowEmptySkip: boolean; flowId?: string; evaluation?: JoinEvaluation; reason?: string }; completedJoin?: JoinProof;
  completedCondition?: Condition; completedSatisfaction?: SatisfactionBasis };
type ArmBody = { runId: string; maxAttempts: number; planSources: ReviewSource[]; terminationKind: "report" | "satisfaction"; satisfactionCriterion?: string;
  join?: { mode: "all" | "any"; allowEmptySkip: boolean } };
type JudgmentBody = { runId: string; attemptId: string; expectedJudgmentId: string | null; value: "true" | "false" | "unknown"; reason: string };
type ResolutionBody = { runId: string; attemptId: string; interventionId: string; expectedJudgmentId: string; expectedReportIds: string[]; reason: string };
type SatisfactionHistory = { runId: string; attemptId: string; judgments: SatisfactionJudgment[]; interventions: Intervention[];
  nextJudgmentCursor?: string; nextInterventionCursor?: string };
type PendingCandidate = { action: "arm"; body: ArmBody } | { action: "judgment"; body: JudgmentBody } | { action: "resolve"; body: ResolutionBody };
type Recovery = { project: string; taskSlug: string; runId: string; pending: PendingCandidate };
const STORAGE_KEY = "workbench.pending-candidate-loop.v1";
const MAX_RECOVERY_BYTES = 64 * 1024;
const validSource = (value: unknown): value is ReviewSource => {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const fields = item.kind === "specgraph" ? ["specSlug", "field", "changeId"] : item.kind === "git" ? ["environmentId", "repositoryRoot", "commitSha", "path"] : null;
  return !!fields && fields.every((field) => typeof item[field] === "string" && !!(item[field] as string).trim()) &&
    Object.keys(item).every((key) => key === "kind" || fields.includes(key) || item.kind === "git" && key === "entry") &&
    (item.kind !== "git" || (item.entry === undefined || typeof item.entry === "string") && /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(item.commitSha as string));
};
function readRecovery(storage: Storage): Recovery | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) throw new Error("Candidate recovery record exceeds its limit");
  const record = JSON.parse(raw) as Recovery;
  const body = record?.pending?.body as Record<string, unknown> | undefined;
  if (!record || typeof record.project !== "string" || !record.project || typeof record.taskSlug !== "string" || !record.taskSlug ||
    typeof record.runId !== "string" || !record.runId || !body || body.runId !== record.runId) throw new Error("Invalid candidate recovery scope");
  if (record.pending.action === "arm" ? !Number.isSafeInteger(body.maxAttempts) || Number(body.maxAttempts) < 1 || !Array.isArray(body.planSources) || body.planSources.length === 0 ||
    !body.planSources.every(validSource) || Object.keys(body).some((key) => !["runId", "maxAttempts", "planSources", "terminationKind", "satisfactionCriterion", "join"].includes(key)) ||
    (body.join !== undefined && (!body.join || typeof body.join !== "object" || Object.keys(body.join).some((key) => key !== "mode" && key !== "allowEmptySkip") ||
      !["all", "any"].includes(String((body.join as ArmBody["join"])?.mode)) || typeof (body.join as ArmBody["join"])?.allowEmptySkip !== "boolean")) ||
    (body.terminationKind !== "report" && body.terminationKind !== "satisfaction") ||
    (body.terminationKind === "satisfaction" ? typeof body.satisfactionCriterion !== "string" || !body.satisfactionCriterion.trim() || new TextEncoder().encode(body.satisfactionCriterion).length > 4000 || body.satisfactionCriterion.includes("\0") : body.satisfactionCriterion !== undefined)
    : record.pending.action === "judgment" ? typeof body.attemptId !== "string" || !body.attemptId || !(body.expectedJudgmentId === null || typeof body.expectedJudgmentId === "string" && !!body.expectedJudgmentId) ||
      (body.value !== "true" && body.value !== "false" && body.value !== "unknown") || typeof body.reason !== "string" || !body.reason.trim() || Array.from(body.reason).length > 4000 || body.reason.includes("\0") ||
      Object.keys(body).some((key) => !["runId", "attemptId", "expectedJudgmentId", "value", "reason"].includes(key))
      : record.pending.action === "resolve" ? typeof body.attemptId !== "string" || !body.attemptId || typeof body.interventionId !== "string" || !body.interventionId ||
        typeof body.expectedJudgmentId !== "string" || !body.expectedJudgmentId || !Array.isArray(body.expectedReportIds) ||
        body.expectedReportIds.some((id) => typeof id !== "string" || !id) || new Set(body.expectedReportIds).size !== body.expectedReportIds.length ||
        typeof body.reason !== "string" || !body.reason.trim() || Array.from(body.reason).length > 4000 || body.reason.includes("\0") ||
        Object.keys(body).some((key) => !["runId", "attemptId", "interventionId", "expectedJudgmentId", "expectedReportIds", "reason"].includes(key))
        : true) throw new Error("Invalid candidate recovery request");
  return record;
}
function keepRecovery(storage: Storage, record: Recovery) {
  const prior = readRecovery(storage);
  if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error("Resolve the original candidate request first");
  const raw = JSON.stringify(record);
  if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) throw new Error("Candidate recovery request exceeds its limit");
  if (!prior) storage.setItem(STORAGE_KEY, raw);
}
function clearRecovery(storage: Storage, record: Recovery) {
  if (JSON.stringify(readRecovery(storage)) !== JSON.stringify(record)) throw new Error("Candidate recovery identity changed; record was not cleared");
  storage.removeItem(STORAGE_KEY);
}
type SetupPreview = { runId: string; packageId: string; taskSlug: string; testPlanSources: ReviewSource[]; workPurpose: string; workspace: string };

function sourceLabel(source: ReviewSource) {
  return source.kind === "specgraph" ? `SpecGraph: ${source.specSlug} / ${source.field} / ${source.changeId}`
    : `Git: ${source.environmentId} / ${source.repositoryRoot} / ${source.commitSha} / ${source.path}${source.entry ? ` / ${source.entry}` : ""}`;
}
function sameSource(left: ReviewSource, right: ReviewSource) {
  return left.kind === right.kind && (left.kind === "specgraph" ? right.kind === "specgraph" && left.specSlug === right.specSlug && left.field === right.field && left.changeId === right.changeId
    : right.kind === "git" && left.environmentId === right.environmentId && left.repositoryRoot === right.repositoryRoot && left.commitSha === right.commitSha && left.path === right.path && (left.entry ?? "") === (right.entry ?? ""));
}

export function CandidateLoopPanel({ project, run, language, request, onChanged }: {
  project: string; run: WorkbenchRun; language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const fact = (value: JoinFact) => <>
    {value.judgment ? <>
      <p>{text("判断引用", "Judgment reference")}: {value.judgment.id} · {value.judgment.flowId} / {value.judgment.conditionKey} · {value.judgment.value} · {value.judgment.reason}</p>
      <p>{text("实际记录者", "Actual recorder")}: {value.judgment.actorUserId}{value.judgment.actorRunId ? ` / ${value.judgment.actorRunId}` : ""} · {value.judgment.recordedAt}</p>
      {value.judgment.predecessorId && <p>{text("前一判断", "Predecessor judgment")}: {value.judgment.predecessorId}</p>}
      {value.judgment.inputRefs.map((source, index) => <p key={index}>{text("判断来源", "Judgment source")}: {sourceLabel(source)}</p>)}
      {value.judgment.inputRefs.length === 0 && <p>{text("未声明外部来源", "No external sources declared")}</p>}
    </> : value.report
      ? <p>{text("报告引用", "Report reference")}: {value.report.id} / {value.report.deliveryId} / {value.report.commitSha} / {value.report.status}</p>
      : <p>{value.reason ?? text("尚无条件事实", "No condition fact")}</p>}
  </>;
  const joinFacts = (evaluation: JoinEvaluation, label: string) => <div className="space-y-1 break-all">
    <p>{label}: {evaluation.satisfied ? text("已满足", "satisfied") : text("未满足", "not satisfied")} · {evaluation.reason ?? ""}{evaluation.explicitSkip ? ` · ${text("明确跳过", "explicit skip")}` : ""}</p>
    {evaluation.participants.map((member) => <div key={`${member.runId}:${member.conditionKey}`}>
      <p>{text("参与分支", "Participating branch")}: {member.runId} · {member.conditionKey} · {member.state} · {member.completion?.id ?? text("无完成记录", "no completion")}</p>
      {member.basis && <div><p>{text("准入时消费依据", "Admitted basis")}: {member.admissionId ?? ""} · {member.basis.flowId} / {member.basis.conditionKey} · {member.basis.value}</p>{fact(member.basis)}</div>}
    </div>)}
    {evaluation.unknown.map((member) => <div key={`${member.runId}:${member.conditionKey}`}>
      <p>{text("未知分支", "Unknown branch")}: {member.runId} · {member.conditionKey} · {member.state}</p>
      {member.basis && <div><p>{text("准入时消费依据", "Admitted basis")}: {member.admissionId ?? ""} · {member.basis.flowId} / {member.basis.conditionKey} · {member.basis.value}</p>{fact(member.basis)}</div>}
    </div>)}
    {evaluation.conditions.map((condition) => <div key={condition.key}>
      <p>{text("条件引用", "Condition reference")}: {condition.key} · {condition.evaluation.value}</p>
      {fact(condition.evaluation)}
    </div>)}
    {evaluation.witness && <p>{text("满足见证", "Satisfaction witness")}: {evaluation.witness.id} · {evaluation.witness.runId}</p>}
  </div>;
  const [loop, setLoop] = useState<CandidateLoop | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState<{ action: "stop" | "abandon"; reason: string } | null>(null);
  const [retryReady, setRetryReady] = useState(false);
  const [observedAction, setObservedAction] = useState<"stop" | "abandon" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [setupPreview, setSetupPreview] = useState<SetupPreview | null>(null);
  const [selectedPlans, setSelectedPlans] = useState<number[]>([]);
  const [maxAttempts, setMaxAttempts] = useState("");
  const [terminationKind, setTerminationKind] = useState<"" | "report" | "satisfaction">("");
  const [criterion, setCriterion] = useState("");
  const [joinMode, setJoinMode] = useState<"" | "all" | "any">("");
  const [allowEmptySkip, setAllowEmptySkip] = useState(false);
  const [setupConfirmedIdentity, setSetupConfirmedIdentity] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(() => {
    try { return { record: readRecovery(localStorage), error: "" }; }
    catch (cause) { return { record: null, error: String(cause) }; }
  });
  const ownRecovery = recovery.record?.project === project && recovery.record.taskSlug === run.taskSlug && recovery.record.runId === run.id ? recovery.record : null;
  const foreignRecovery = recovery.record && !ownRecovery ? recovery.record : null;
  const [pendingArm, setPendingArm] = useState<ArmBody | null>(ownRecovery?.pending.action === "arm" ? ownRecovery.pending.body : null);
  const [pendingControl, setPendingControl] = useState<Extract<PendingCandidate, { action: "judgment" | "resolve" }> | null>(
    ownRecovery?.pending.action === "judgment" || ownRecovery?.pending.action === "resolve" ? ownRecovery.pending : null);
  const [retryArm, setRetryArm] = useState(false);
  const [retryControl, setRetryControl] = useState(false);
  const [history, setHistory] = useState<SatisfactionHistory | null>(null);
  const [judgmentValue, setJudgmentValue] = useState<"true" | "false" | "unknown">("unknown");
  const [judgmentReason, setJudgmentReason] = useState("");
  const [resolutionReason, setResolutionReason] = useState("");
  const [confirmResolution, setConfirmResolution] = useState(false);
  const [controlMessage, setControlMessage] = useState("");
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/loop/candidate-loops/${encodeURIComponent(run.id)}`;
  function finishRecovery(pending: PendingCandidate) {
    clearRecovery(localStorage, { project, taskSlug: run.taskSlug, runId: run.id, pending });
    setRecovery({ record: null, error: "" }); setPendingArm(null); setPendingControl(null);
  }
  async function readHistory(attemptId: string, judgmentCursor = "", interventionCursor = "") {
    const params = new URLSearchParams({ attemptId, ...(judgmentCursor ? { judgmentCursor } : {}), ...(interventionCursor ? { interventionCursor } : {}) });
    const response = await request(`${endpoint}/satisfaction-history?${params}`, { headers: { "X-Specgraph-Project": project }, cache: "no-store" });
    if (response.status === 401) setNeedsLogin(true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const page = await response.json() as SatisfactionHistory;
    if (page.runId !== run.id || page.attemptId !== attemptId || !Array.isArray(page.judgments) || !Array.isArray(page.interventions) ||
      page.judgments.some((item) => item.runId !== run.id || item.attemptId !== attemptId) ||
      page.interventions.some((item) => item.runId !== run.id || item.attemptId !== attemptId)) throw new Error("Candidate satisfaction history scope mismatch");
    return page;
  }

  function reconcileControl(current: CandidateLoop, page: SatisfactionHistory) {
    if (!pendingControl || page.attemptId !== pendingControl.body.attemptId) return;
    if (pendingControl.action === "judgment") {
      const prior = page.judgments.find((item) => (item.predecessorId ?? null) === pendingControl.body.expectedJudgmentId);
      if (prior) {
        const originalAttempt = current.attempts.find((item) => item.id === pendingControl.body.attemptId);
        if (prior.value !== pendingControl.body.value || prior.reason !== pendingControl.body.reason || !originalAttempt?.deliveryId || prior.deliveryId !== originalAttempt.deliveryId) throw new Error("Different judgment was recorded for the original CAS predecessor");
        finishRecovery(pendingControl); setRetryControl(false); setControlMessage(`${text("已观察到匹配判断，实际记录者", "Matching judgment observed; actual recorder")}: ${prior.actorUserId}`); onChanged();
      } else if (!page.nextJudgmentCursor) {
        if (current.currentAttempt?.id === pendingControl.body.attemptId && (current.satisfaction?.judgment?.id ?? null) === pendingControl.body.expectedJudgmentId) setRetryControl(true);
        else throw new Error("Original judgment baseline changed; request remains frozen");
      }
    } else {
      const intervention = page.interventions.find((item) => item.id === pendingControl.body.interventionId);
      if (intervention?.resolvedAt) {
        if (intervention.resolutionJudgmentId !== pendingControl.body.expectedJudgmentId || intervention.resolutionReason !== pendingControl.body.reason ||
          JSON.stringify(intervention.resolutionReportIds ?? []) !== JSON.stringify(pendingControl.body.expectedReportIds) || !intervention.resolvedByUserId) throw new Error("Different intervention resolution was recorded");
        finishRecovery(pendingControl); setRetryControl(false); setControlMessage(`${text("已观察到原介入解除，实际处理者", "Original intervention resolution observed; actual actor")}: ${intervention.resolvedByUserId}`); onChanged();
      } else if (!page.nextInterventionCursor) {
        const ids = current.condition?.reports.map((item) => item.id).sort() ?? [];
        if (current.currentAttempt?.id === pendingControl.body.attemptId && current.satisfaction?.intervention?.id === pendingControl.body.interventionId &&
          !current.satisfaction.intervention.resolvedAt && current.satisfaction.judgment?.id === pendingControl.body.expectedJudgmentId &&
          current.condition?.value === current.satisfaction.value && (current.condition?.value === "true" || current.condition?.value === "false") &&
          JSON.stringify(ids) === JSON.stringify(pendingControl.body.expectedReportIds)) setRetryControl(true);
        else throw new Error("Original intervention facts changed; request remains frozen");
      }
    }
  }
  const setupIdentity = JSON.stringify([run.id, run.packageId, run.state, setupPreview, selectedPlans, maxAttempts, terminationKind, criterion, joinMode, allowEmptySkip]);
  const setupConfirmed = setupConfirmedIdentity === setupIdentity;
  const limit = Number(maxAttempts);
  const selectedSources = selectedPlans.map((index) => setupPreview?.testPlanSources[index]).filter((item): item is ReviewSource => !!item);
  const setupReady = !!setupPreview && setupPreview.runId === run.id && setupPreview.packageId === run.packageId &&
    (run.state === "prepared" || run.state === "bound") && Number.isSafeInteger(limit) && limit > 0 && selectedSources.length > 0 &&
    !!terminationKind && (terminationKind === "report" || !!criterion.trim() && new TextEncoder().encode(criterion).length <= 4000 && !criterion.includes("\0"));

  async function inspectSetup() {
    if (inFlight.current || pendingArm || pendingControl || foreignRecovery || recovery.error || run.executorKind !== "agent" || run.workPurpose !== "implementation" || !["prepared", "bound"].includes(run.state)) return;
    inFlight.current = true; setBusy(true); setError(""); setSetupPreview(null); setSelectedPlans([]); setSetupConfirmedIdentity(null);
    try {
      const get = async (suffix: "context" | "dispatch") => {
        const response = await request(`/workbench-api/loop/runs/${encodeURIComponent(run.id)}/${suffix}`, { headers: { "X-Specgraph-Project": project }, cache: "no-store" });
        if (response.status === 401) setNeedsLogin(true);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      };
      const [context, dispatch] = await Promise.all([get("context"), get("dispatch")]);
      const recorded = context as { runId: string; taskSlug: string; packageId: string; body: { workspace?: string; dispatch_target?: { workPurpose?: string; qaBasis?: { testPlanSources?: ReviewSource[] } } } };
      const admission = dispatch as { admission: unknown; cancellation: unknown };
      if (recorded?.runId !== run.id || recorded.taskSlug !== run.taskSlug || recorded.packageId !== run.packageId ||
        recorded.body?.dispatch_target?.workPurpose !== "implementation" || !Array.isArray(recorded.body.dispatch_target.qaBasis?.testPlanSources) ||
        admission?.admission !== null || admission.cancellation !== null) throw new Error("Original implementation preparation is no longer eligible");
      setSetupPreview({ runId: run.id, packageId: run.packageId, taskSlug: run.taskSlug,
        testPlanSources: recorded.body.dispatch_target.qaBasis.testPlanSources, workPurpose: "implementation", workspace: recorded.body.workspace ?? run.workspace });
    } catch (cause) { setLoop(null); setHistory(null); setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function arm(original?: ArmBody) {
    if (inFlight.current || recovery.error || foreignRecovery || pendingControl || (original ? !retryArm || pendingArm !== original : !setupReady || !setupConfirmed || !!pendingArm)) return;
    const body: ArmBody = original ?? { runId: run.id, maxAttempts: limit, planSources: selectedSources, terminationKind: terminationKind as "report" | "satisfaction",
      ...(terminationKind === "satisfaction" ? { satisfactionCriterion: criterion.trim() } : {}),
      ...(joinMode ? { join: { mode: joinMode, allowEmptySkip } } : {}) };
    const pending: PendingCandidate = { action: "arm", body };
    try { const record = { project, taskSlug: run.taskSlug, runId: run.id, pending }; keepRecovery(localStorage, record); setRecovery({ record, error: "" }); }
    catch (cause) { setError(`${text("恢复记录不能保存；未发送请求", "Recovery record could not be saved; request was not sent")}: ${String(cause)}`); return; }
    inFlight.current = true; setBusy(true); setError(""); setRetryArm(false); setPendingArm(body);
    try {
      const response = await request("/workbench-api/loop/candidate-loops/arm", { method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(body) });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) {
        if (response.status < 500) { finishRecovery(pending); setSetupPreview(null); setSetupConfirmedIdentity(null); }
        throw new Error(`HTTP ${response.status}`);
      }
      const configured = receipt(await response.json());
      if (configured.maxAttempts !== body.maxAttempts || configured.terminationKind !== body.terminationKind ||
        (body.terminationKind === "satisfaction" ? configured.satisfaction?.criterion !== body.satisfactionCriterion : !!configured.satisfaction) ||
        (body.join ? configured.join?.mode !== body.join.mode || configured.join.allowEmptySkip !== body.join.allowEmptySkip : !!configured.join) ||
        !configured.configuredBy.startsWith("user:") ||
        configured.planSources.length !== body.planSources.length || body.planSources.some((source) => !configured.planSources.some((saved) => sameSource(saved, source)))) throw new Error("Candidate loop configuration receipt mismatch");
      finishRecovery(pending); setLoop(configured); setSetupPreview(null); setSetupConfirmedIdentity(null); onChanged();
    } catch (cause) { setError(text("候选配置结果未确认或被拒绝；先读原循环核对：", "Candidate configuration outcome unconfirmed or rejected; read the original loop: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function receipt(value: unknown): CandidateLoop {
    if (!value || typeof value !== "object") throw new Error("Invalid candidate loop receipt");
    const result = value as CandidateLoop;
    if (result.runId !== run.id || result.taskSlug !== run.taskSlug || result.packageId !== run.packageId ||
      !Array.isArray(result.attempts) || !Array.isArray(result.planSources) || !Number.isInteger(result.maxAttempts) || result.maxAttempts < 1 ||
      (result.terminationKind !== "report" && result.terminationKind !== "satisfaction") ||
      (result.terminationKind === "satisfaction" ? !result.satisfaction?.criterion : !!result.satisfaction) || typeof result.status !== "string" ||
      (result.satisfaction?.judgment && (result.satisfaction.judgment.runId !== run.id || result.satisfaction.judgment.attemptId !== result.currentAttempt?.id ||
        result.satisfaction.judgment.deliveryId !== result.currentAttempt.deliveryId)) ||
      (result.satisfaction?.intervention && (result.satisfaction.intervention.runId !== run.id || result.satisfaction.intervention.attemptId !== result.currentAttempt?.id ||
        !Array.isArray(result.satisfaction.intervention.reportIds)))) throw new Error("Candidate loop scope or receipt mismatch");
    return result;
  }

  async function read() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setLoop(null); setHistory(null); setRetryArm(false); setRetryControl(false); setConfirmResolution(false);
    if (uncertain) setRetryReady(false);
    try {
      const response = await request(endpoint, { headers: { "X-Specgraph-Project": project }, cache: "no-store" });
      if (response.status === 401) setNeedsLogin(true);
      if (response.status === 404 && pendingArm) {
        setRetryArm(true); setError(text("原循环尚无匹配配置；仅可明确重试原请求。", "No matching original configuration yet; only the original request may be explicitly retried.")); return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const current = receipt(await response.json());
      if (current.terminationKind === "satisfaction") {
        const attemptId = pendingControl?.body.attemptId ?? current.currentAttempt?.id;
        if (attemptId) {
          const page = await readHistory(attemptId);
          setHistory(page); reconcileControl(current, page);
        } else if (pendingControl) throw new Error("Original satisfaction attempt is unavailable");
      } else if (pendingControl) throw new Error("Original run has a different termination mode");
      setLoop(current);
      if (pendingArm) {
        if (current.maxAttempts === pendingArm.maxAttempts && current.terminationKind === pendingArm.terminationKind &&
          (pendingArm.terminationKind === "satisfaction" ? current.satisfaction?.criterion === pendingArm.satisfactionCriterion : !current.satisfaction) &&
          (pendingArm.join ? current.join?.mode === pendingArm.join.mode && current.join.allowEmptySkip === pendingArm.join.allowEmptySkip : !current.join) &&
          current.planSources.length === pendingArm.planSources.length && pendingArm.planSources.every((source) => current.planSources.some((saved) => sameSource(saved, source)))) {
          finishRecovery({ action: "arm", body: pendingArm }); setSetupPreview(null); setSetupConfirmedIdentity(null); onChanged();
          setObservedAction(null); setError("");
        } else setError(text("原循环配置与未知请求不同；保持冻结。", "Original loop configuration differs from the uncertain request; controls remain frozen."));
      }
      if (uncertain) {
        const recorded = current[uncertain.action];
        if (recorded) {
          if (recorded.reason !== uncertain.reason || !recorded.actorUserId || !recorded.recordedAt) throw new Error("A different candidate loop decision was recorded");
          setUncertain(null); setRetryReady(false); setObservedAction(uncertain.action); onChanged();
        } else {
          setRetryReady(true);
          setError(text("尚无匹配记录；只能明确重试原请求。", "No matching record yet; only the original request may be explicitly retried."));
        }
      }
    } catch (cause) { setError(text("原候选循环读取失败：", "Original candidate loop read failed: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function readMoreHistory() {
    if (inFlight.current || !history || !loop || (!history.nextJudgmentCursor && !history.nextInterventionCursor)) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryControl(false);
    try {
      const next = await readHistory(history.attemptId, history.nextJudgmentCursor, history.nextInterventionCursor);
      const { nextJudgmentCursor: _judgmentCursor, nextInterventionCursor: _interventionCursor, ...page } = next;
      const combined: SatisfactionHistory = { ...page,
        judgments: history.nextJudgmentCursor ? [...history.judgments, ...next.judgments] : history.judgments,
        interventions: history.nextInterventionCursor ? [...history.interventions, ...next.interventions] : history.interventions,
        ...(history.nextJudgmentCursor && next.nextJudgmentCursor ? { nextJudgmentCursor: next.nextJudgmentCursor } : {}),
        ...(history.nextInterventionCursor && next.nextInterventionCursor ? { nextInterventionCursor: next.nextInterventionCursor } : {}) };
      setHistory(combined); reconcileControl(loop, combined);
    } catch (cause) { setLoop(null); setHistory(null); setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function inspectAttemptHistory(attemptId: string) {
    if (inFlight.current || pendingControl || !loop?.attempts.some((item) => item.id === attemptId)) return;
    inFlight.current = true; setBusy(true); setHistory(null); setError(""); setConfirmResolution(false);
    try { setHistory(await readHistory(attemptId)); }
    catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function sendControl(pending: Extract<PendingCandidate, { action: "judgment" | "resolve" }>, retryOriginal = false) {
    if (inFlight.current || recovery.error || foreignRecovery || pendingArm || uncertain || needsLogin ||
      (retryOriginal ? !retryControl || pendingControl !== pending : !!pendingControl)) return;
    const record: Recovery = { project, taskSlug: run.taskSlug, runId: run.id, pending };
    try { keepRecovery(localStorage, record); setRecovery({ record, error: "" }); }
    catch (cause) { setError(`${text("恢复记录不能保存；未发送请求", "Recovery record could not be saved; request was not sent")}: ${String(cause)}`); return; }
    inFlight.current = true; setBusy(true); setError(""); setControlMessage(""); setRetryControl(false); setPendingControl(pending);
    try {
      const response = await request(`${endpoint}/${pending.action === "judgment" ? "satisfaction" : "intervention"}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(pending.body),
      });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) {
        if (response.status < 500) { finishRecovery(pending); setLoop(null); setHistory(null); }
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json() as { judgment?: SatisfactionJudgment; replayed?: boolean } & Intervention;
      if (pending.action === "judgment") {
        const judgment = result.judgment;
        const delivery = loop?.attempts.find((item) => item.id === pending.body.attemptId)?.deliveryId;
        if (!judgment?.id || judgment.runId !== run.id || judgment.attemptId !== pending.body.attemptId || judgment.deliveryId !== delivery ||
          judgment.value !== pending.body.value || judgment.reason !== pending.body.reason || (judgment.predecessorId ?? null) !== pending.body.expectedJudgmentId || !judgment.actorUserId) throw new Error("Candidate judgment receipt mismatch");
      } else if (result.id !== pending.body.interventionId || result.runId !== run.id || result.attemptId !== pending.body.attemptId ||
        result.resolutionJudgmentId !== pending.body.expectedJudgmentId || result.resolutionReason !== pending.body.reason || !result.resolvedAt || !result.resolvedByUserId ||
        JSON.stringify(result.resolutionReportIds ?? []) !== JSON.stringify(pending.body.expectedReportIds)) throw new Error("Candidate intervention receipt mismatch");
      finishRecovery(pending); setLoop(null); setHistory(null); setControlMessage(pending.action === "judgment"
        ? text("判断事实已登记；重读原循环及历史，不自动解除介入或启动后继。", "Judgment fact recorded; reread the original loop and history. No intervention is automatically cleared or successor started.")
        : text("原介入已按确切事实解除；没有强行继续或启动新候选。", "Original intervention resolved against exact facts; no forced continuation or new candidate was started.")); onChanged();
    } catch (cause) { setError(text("原人工操作结果未确认或被拒绝；先读原循环及历史核对：", "Original human action unconfirmed or rejected; read the loop and history: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function recordJudgment() {
    if (!loop?.satisfaction || !loop.currentAttempt?.deliveryId || !history || history.attemptId !== loop.currentAttempt.id ||
      !judgmentReason.trim() || Array.from(judgmentReason).length > 4000) return;
    void sendControl({ action: "judgment", body: { runId: run.id, attemptId: loop.currentAttempt.id,
      expectedJudgmentId: loop.satisfaction.judgment?.id ?? null, value: judgmentValue, reason: judgmentReason.trim() } });
  }

  function resolveIntervention() {
    const intervention = loop?.satisfaction?.intervention;
    const judgment = loop?.satisfaction?.judgment;
    if (!loop?.currentAttempt || !intervention || intervention.resolvedAt || !judgment || !loop.condition || !confirmResolution ||
      !resolutionReason.trim() || Array.from(resolutionReason).length > 4000 || loop.condition.value !== loop.satisfaction!.value ||
      (loop.condition.value !== "true" && loop.condition.value !== "false") || history?.attemptId !== loop.currentAttempt.id) return;
    void sendControl({ action: "resolve", body: { runId: run.id, attemptId: loop.currentAttempt.id, interventionId: intervention.id,
      expectedJudgmentId: judgment.id, expectedReportIds: loop.condition.reports.map((item) => item.id).sort(), reason: resolutionReason.trim() } });
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !key) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setNeedsLogin(false); setKey("");
    } catch (cause) { setError(text("登录失败：", "Sign-in failed: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function command(action: "stop" | "abandon", event?: FormEvent) {
    event?.preventDefault();
    const submittedReason = uncertain?.reason ?? reason.trim();
    if (inFlight.current || !loop || pendingArm || pendingControl || foreignRecovery || recovery.error || (uncertain && (!retryReady || uncertain.action !== action)) || needsLogin || !submittedReason || submittedReason.length > 4000 ||
      (action === "abandon" && (!uncertain && !confirmAbandon || !!loop.completedAt || loop.status === "completed" || !!loop.abandon)) ||
      (action === "stop" && (!!loop.stop || !!loop.abandon))) return;
    inFlight.current = true; setBusy(true); setError(""); setObservedAction(null);
    try {
      const response = await request(`${endpoint}/${action}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify({ runId: run.id, reason: submittedReason }) });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const next = receipt(await response.json());
      if ((action === "abandon" && next.status !== "abandoned") || next[action]?.reason !== submittedReason || !next[action]?.actorUserId || !next[action]?.recordedAt) throw new Error("Candidate loop command receipt mismatch");
      setLoop(next); setReason(""); setConfirmAbandon(false); setUncertain(null); setRetryReady(false); onChanged();
    } catch (cause) {
      setUncertain({ action, reason: submittedReason }); setRetryReady(false);
      setError(text("人工操作结果未确认；先读取原循环核对，不自动重试：", "Human action outcome unconfirmed; read the original loop before retrying: ") + String(cause));
    } finally { setBusy(false); inFlight.current = false; }
  }

  return <section aria-label={text("候选循环详情", "Candidate loop detail")} className="wb-panel space-y-2">
    <h3>{text("固定候选循环", "Formal candidate loop")} · {run.id}</h3>
    {foreignRecovery && <p role="alert">{text("先恢复另一原候选请求", "Resolve the original candidate request for another run first")}: {foreignRecovery.project} / {foreignRecovery.taskSlug} / {foreignRecovery.runId}</p>}
    {recovery.error && <p role="alert">{text("候选恢复记录不可读；未新建请求", "Candidate recovery record cannot be read; no new request was created")}: {recovery.error}</p>}
    {!run.candidateLoop && !loop && run.executorKind === "agent" && run.workPurpose === "implementation" && <fieldset disabled={busy || !!pendingArm || !!pendingControl || !!foreignRecovery || !!recovery.error} className="space-y-2 border-t pt-2" aria-label="Candidate loop setup">
      <p>{text("首次准入前固定候选预算和终止规则；此处只配置，不启动模型或候选。", "Fix the candidate budget and termination rule before first admission; this configures but does not start a model or candidate.")}</p>
      <button type="button" className="wb-button" onClick={() => void inspectSetup()}><RefreshCw size={14} />{text("读取原实现工作包与准入", "Read original implementation package and admission")}</button>
      {setupPreview && <>
        <p>{text("原工作包", "Original package")}: {setupPreview.taskSlug} · {setupPreview.runId} / {setupPreview.packageId} · {setupPreview.workspace}</p>
        <fieldset><legend>{text("固定指定测试计划", "Fixed assigned test plans")}</legend>{setupPreview.testPlanSources.map((source, index) => <label key={index} className="block break-all"><input type="checkbox" aria-label={`Candidate plan ${index + 1}`} checked={selectedPlans.includes(index)} onChange={(event) => { setSelectedPlans(event.target.checked ? [...selectedPlans, index] : selectedPlans.filter((value) => value !== index)); setSetupConfirmedIdentity(null); }} />{sourceLabel(source)}</label>)}</fieldset>
      </>}
      <label>{text("最大正式候选次数", "Maximum formal candidates")}<input aria-label="Candidate max attempts" type="number" min={1} step={1} value={maxAttempts} onChange={(event) => { setMaxAttempts(event.target.value); setSetupConfirmedIdentity(null); }} /></label>
      <label>{text("终止模式", "Termination mode")}<select aria-label="Candidate termination mode" value={terminationKind} onChange={(event) => { setTerminationKind(event.target.value as typeof terminationKind); setSetupConfirmedIdentity(null); }}>
        <option value="">{text("明确选择", "Select explicitly")}</option><option value="report">{text("指定报告结果", "Assigned report result")}</option><option value="satisfaction">{text("语义满意判断", "Satisfaction judgment")}</option>
      </select></label>
      {terminationKind === "satisfaction" && <label>{text("满意标准", "Satisfaction criterion")}<textarea aria-label="Candidate satisfaction criterion" maxLength={4000} value={criterion} onChange={(event) => { setCriterion(event.target.value); setSetupConfirmedIdentity(null); }} /></label>}
      <label>{text("本轮可选汇合", "Optional attempt join")}<select aria-label="Candidate join mode" value={joinMode} onChange={(event) => { setJoinMode(event.target.value as typeof joinMode); setSetupConfirmedIdentity(null); }}><option value="">{text("不配置", "None")}</option><option value="all">all</option><option value="any">any</option></select></label>
      {joinMode && <label className="flex items-start gap-2"><input aria-label="Candidate allow empty skip" type="checkbox" checked={allowEmptySkip} onChange={(event) => { setAllowEmptySkip(event.target.checked); setSetupConfirmedIdentity(null); }} />{text("允许空集合明确跳过", "Allow explicit empty skip")}</label>}
      <label className="flex items-start gap-2"><input aria-label="Confirm candidate setup" type="checkbox" disabled={!setupReady} checked={setupConfirmed} onChange={(event) => setSetupConfirmedIdentity(event.target.checked ? setupIdentity : null)} />{text("确认原run、工作包、计划、次数与终止模式；仅保存配置，不授权新候选。", "Confirm the original run, package, plans, limit and termination mode; this only saves configuration, not a new candidate grant.")}</label>
      <button type="button" className="wb-button" disabled={!setupReady || !setupConfirmed} onClick={() => void arm()}><Check size={14} />{text("配置正式候选循环", "Arm formal candidate loop")}</button>
    </fieldset>}
    {pendingArm && <><p role="status">{text("原配置请求冻结，先读原run核对；不自动换模式或重发。", "Original configuration request frozen; read the original run before retrying, without changing mode or resending automatically.")}</p>
      {retryArm && <button type="button" className="wb-button" disabled={busy} onClick={() => void arm(pendingArm)}><RefreshCw size={14} />{text("明确重试原候选配置", "Explicitly retry original candidate setup")}</button>}
    </>}
    {(loop || run.candidateLoop || pendingArm) && <>
      <p>{text("已准入候选", "Admitted candidates")}: {loop?.currentAttempt?.number ?? run.candidateLoop?.attemptOrdinal ?? 0} / {loop?.maxAttempts ?? run.candidateLoop?.maxAttempts ?? text("待核对", "unconfirmed")} · {text("状态", "Status")}: {loop?.status ?? run.candidateLoop?.status ?? text("待核对", "unconfirmed")}</p>
      <button type="button" className="wb-button" disabled={busy} onClick={() => void read()}><RefreshCw size={14} />{text("读取原候选循环", "Read original candidate loop")}</button>
    </>}
    {needsLogin && <form onSubmit={(event) => void login(event)} className="flex flex-wrap gap-2"><input aria-label="Candidate loop access key" type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} /><button type="submit" className="wb-button" disabled={busy || !key}>{text("登录", "Sign in")}</button></form>}
    {loop && <>
      <p>{text("原配置人", "Original configurator")}: {loop.configuredBy} · {loop.configuredAt}</p>
      <p>{text("固定终止模式", "Fixed termination mode")}: {loop.terminationKind === "report" ? text("指定报告结果", "Assigned report result") : text("语义满意判断", "Satisfaction judgment")}</p>
      <div><h4>{text("指定计划", "Assigned plans")}</h4><ul>{loop.planSources.map((source, index) => <li key={index} className="break-all">{sourceLabel(source)}</li>)}</ul></div>
      <div><h4>{text("候选历史与消费依据", "Candidate history and consumed basis")}</h4>
        {loop.attempts.map((attempt) => <div key={attempt.id} className="break-all border-t py-2">
          <p>#{attempt.number} · {attempt.id} · {attempt.grantedAt} · {text("交付", "Delivery")}: {attempt.deliveryId ?? text("未提交", "Not submitted")}</p>
          {attempt.flowId && <p>{text("本轮绑定流程", "Attempt flow")}: {attempt.flowId}</p>}
          {attempt.consumedCondition && <p>{text("前轮消费条件", "Consumed prior condition")}: {attempt.consumedCondition.value} · {attempt.consumedCondition.reason} · {attempt.consumedCondition.reports.map((report) => report.id).join(", ")}</p>}
          {attempt.consumedSatisfaction && <p>{text("前轮消费满意依据", "Consumed prior satisfaction basis")}: {attempt.consumedSatisfaction.value} · {attempt.consumedSatisfaction.judgmentId} · {attempt.consumedSatisfaction.reportIds.join(", ")} · {attempt.consumedSatisfaction.interventionId ?? text("无人工介入", "no intervention")}</p>}
          {attempt.consumedJoin && <><p>{text("消费前轮汇合", "Consumed prior join")}: {attempt.consumedJoin.sourceAttemptId} / {attempt.consumedJoin.flowId} · {attempt.consumedJoin.mode}</p>
            {joinFacts(attempt.consumedJoin.evaluation, text("冻结汇合", "Frozen join"))}</>}
        </div>)}
      </div>
      {loop.condition && <div><p>{text("当前条件", "Current condition")}: {loop.condition.value} · {loop.condition.reason}</p>
        {loop.condition.reports.map((report) => <p key={report.id} className="break-all">{text("报告引用", "Report reference")}: {report.id} · {report.deliveryId} · {report.commitSha} · {report.status} · {report.createdAt}</p>)}
        {loop.condition.missingPlans.map((source, index) => <p key={index} className="break-all">{text("缺少计划事实", "Missing plan evidence")}: {sourceLabel(source)}</p>)}
      </div>}
      {loop.satisfaction && <div aria-label="Candidate satisfaction" className="space-y-1 border-t pt-2">
        <p>{text("固定满意标准", "Fixed satisfaction criterion")}: {loop.satisfaction.criterion}</p>
        <p>{text("当前满意判断", "Current satisfaction judgment")}: {loop.satisfaction.value} · {loop.satisfaction.reason ?? ""}</p>
        {loop.satisfaction.judgment && <p>{text("最新判断事实", "Latest judgment fact")}: {loop.satisfaction.judgment.id} · {loop.satisfaction.judgment.attemptId} / {loop.satisfaction.judgment.deliveryId} · {loop.satisfaction.judgment.actorUserId}{loop.satisfaction.judgment.actorRunId ? ` / ${loop.satisfaction.judgment.actorRunId}` : ""} · {loop.satisfaction.judgment.reason} · {loop.satisfaction.judgment.recordedAt}</p>}
        {loop.satisfaction.intervention && <p>{text("原人工介入", "Original human intervention")}: {loop.satisfaction.intervention.id} · {loop.satisfaction.intervention.conflictKind} · {loop.satisfaction.intervention.judgmentId} / {loop.satisfaction.intervention.reportIds.join(", ")} · {loop.satisfaction.intervention.resolvedAt ? `${text("已解除", "resolved")}: ${loop.satisfaction.intervention.resolvedByUserId} · ${loop.satisfaction.intervention.resolvedAt}` : text("未解除，阻止后继与首次完成", "unresolved; blocks next and first completion")}</p>}
      </div>}
      {loop.satisfaction && <label>{text("读取确切候选轮历史", "Inspect exact candidate attempt history")}<select aria-label="Candidate history attempt" disabled={busy || !!pendingControl} value={history?.attemptId ?? loop.currentAttempt?.id ?? ""} onChange={(event) => void inspectAttemptHistory(event.target.value)}>
        {loop.attempts.map((item) => <option key={item.id} value={item.id}>#{item.number} · {item.id} · {item.deliveryId ?? text("未提交", "not submitted")}</option>)}
      </select></label>}
      {loop.satisfaction && history && <div aria-label="Candidate satisfaction history" className="space-y-1 border-t pt-2">
        <h4>{text("确切候选判断与介入历史", "Exact candidate judgment and intervention history")} · {history.attemptId}</h4>
        {history.judgments.map((item) => <p key={item.id} className="break-all">{text("判断", "Judgment")}: {item.id} · {item.value} · {text("前驱", "predecessor")}: {item.predecessorId ?? text("无", "none")} · {item.deliveryId} · {item.actorUserId}{item.actorRunId ? ` / ${item.actorRunId}` : ""} · {item.reason} · {item.recordedAt}</p>)}
        {history.interventions.map((item) => <p key={item.id} className="break-all">{text("介入", "Intervention")}: {item.id} · {item.judgmentId} / {item.reportIds.join(", ")} · {item.conflictKind} · {item.resolvedAt ? `${text("解除", "resolved")}: ${item.resolutionJudgmentId} / ${(item.resolutionReportIds ?? []).join(", ")} · ${item.resolvedByUserId}` : text("未解除", "unresolved")}</p>)}
        {(history.nextJudgmentCursor || history.nextInterventionCursor) && <button type="button" className="wb-button" disabled={busy} onClick={() => void readMoreHistory()}><RefreshCw size={14} />{text("读取更多原判断历史", "Read more original judgment history")}</button>}
      </div>}
      {loop.satisfaction && loop.currentAttempt?.deliveryId && history?.attemptId === loop.currentAttempt.id && !pendingControl && !pendingArm && !foreignRecovery && !recovery.error && <div className="space-y-2 border-t pt-2" aria-label="Candidate satisfaction control">
        <p>{text("基于当前所见最新判断追加事实；不会自动解除介入、增加次数或启动模型。", "Append a fact against the latest judgment shown; this does not clear an intervention, add attempts or start a model.")}</p>
        <p>{text("当前CAS前驱", "Current CAS predecessor")}: {loop.satisfaction.judgment?.id ?? text("无（首条）", "none (first judgment)")}</p>
        <label>{text("满意判断", "Satisfaction value")}<select aria-label="Candidate satisfaction value" disabled={busy} value={judgmentValue} onChange={(event) => setJudgmentValue(event.target.value as typeof judgmentValue)}><option value="unknown">unknown</option><option value="false">false</option><option value="true">true</option></select></label>
        <label>{text("判断理由", "Judgment reason")}<textarea aria-label="Candidate satisfaction reason" disabled={busy} maxLength={4000} value={judgmentReason} onChange={(event) => setJudgmentReason(event.target.value)} /></label>
        <button type="button" className="wb-button" disabled={busy || !judgmentReason.trim()} onClick={() => recordJudgment()}><Check size={14} />{text("追加确切候选判断", "Append exact candidate judgment")}</button>
        {loop.satisfaction.intervention && !loop.satisfaction.intervention.resolvedAt && <div className="space-y-1 border-t pt-2">
          <p>{text("只能在当前判断与指定报告都明确一致时，由人核对原介入及事实ID后解除；这不是强行继续。", "Only a human may resolve the original intervention after current judgment and assigned reports explicitly agree; this is not forced continuation.")}</p>
          <p>{text("待核对的介入/当前判断/报告", "Intervention / current judgment / reports to review")}: {loop.satisfaction.intervention.id} / {loop.satisfaction.judgment?.id ?? text("无", "none")} / {loop.condition?.reports.map((item) => item.id).sort().join(", ") ?? text("无", "none")}</p>
          <label>{text("解除依据", "Resolution reason")}<textarea aria-label="Candidate intervention reason" disabled={busy} maxLength={4000} value={resolutionReason} onChange={(event) => setResolutionReason(event.target.value)} /></label>
          <label className="flex items-start gap-2"><input aria-label="Confirm candidate intervention resolution" type="checkbox" disabled={busy || !loop.satisfaction.judgment || !loop.condition || loop.condition.value !== loop.satisfaction.value || (loop.condition.value !== "true" && loop.condition.value !== "false")} checked={confirmResolution} onChange={(event) => setConfirmResolution(event.target.checked)} />{text("确认上述确切事实已一致，解除此介入但不启动下一轮", "Confirm these exact facts agree; resolve this intervention without starting another attempt")}</label>
          <button type="button" className="wb-button" disabled={busy || !confirmResolution || !resolutionReason.trim() || !loop.satisfaction.judgment || !loop.condition || loop.condition.value !== loop.satisfaction.value || (loop.condition.value !== "true" && loop.condition.value !== "false")} onClick={() => resolveIntervention()}><Check size={14} />{text("解除原介入", "Resolve original intervention")}</button>
          {confirmResolution && <button type="button" className="wb-button" onClick={() => setConfirmResolution(false)}>{text("取消确认", "Cancel confirmation")}</button>}
        </div>}
      </div>}
      {loop.status === "condition_met" && <p>{loop.terminationKind === "satisfaction"
        ? text("报告与满意判断均为真且无未解除介入；仍须本轮汇合及原成果完成检查。", "Reports and satisfaction are both true with no unresolved intervention; attempt join and original completion checks still apply")
        : loop.join ? text("报告终止条件已满足；仍需本轮汇合及原成果完成检查。", "Report termination met; current attempt join and original completion still required")
          : text("报告终止条件已满足；仍需原成果完成检查。", "Report termination met; original completion still required")}</p>}
      {loop.status === "ready_next" && <p>{loop.terminationKind === "satisfaction"
        ? text("报告与满意判断均为假且无未解除介入；仍须原汇合与准入检查，这不是新候选许可。", "Reports and satisfaction are both false with no unresolved intervention; the original join and admission checks remain, and this is not a new candidate grant")
        : text("报告侧条件允许考虑下一候选；这不是新许可，配置汇合仍可能阻止。", "Report-side condition is ready for a next candidate; this is not a grant and a configured join may still block")}</p>}
      {loop.join && <div aria-label={text("当前候选汇合", "Current candidate join")} className="space-y-1 border-t pt-2">
        <p>{text("本轮汇合配置", "Current join configuration")}: {loop.join.mode} · {text("空集合明确跳过", "Explicit empty skip")}: {loop.join.allowEmptySkip ? text("是", "yes") : text("否", "no")}</p>
        {loop.join.flowId ? <p>{text("本轮流程", "Current attempt flow")}: {loop.join.flowId}</p> : null}
        {loop.join.evaluation ? joinFacts(loop.join.evaluation, text("当前汇合", "Current join"))
          : <p>{text("当前汇合", "Current join")}: {loop.join.reason ?? text("未绑定流程", "flow_missing")}</p>}
      </div>}
      {loop.completedAt && <p>{text("原成果完成记录", "Original completion recorded")}: {loop.completedAt}</p>}
      {loop.completedCondition && <p>{text("完成时报告依据", "Recorded completion reports")}: {loop.completedCondition.value} · {loop.completedCondition.reports.map((report) => report.id).join(", ")}</p>}
      {loop.completedSatisfaction && <p>{text("完成时满意依据（非当前判断）", "Recorded completion satisfaction (not current judgment)")}: {loop.completedSatisfaction.value} · {loop.completedSatisfaction.judgmentId} · {loop.completedSatisfaction.reportIds.join(", ")} · {loop.completedSatisfaction.interventionId ?? text("无人工介入", "no intervention")}</p>}
      {loop.completedJoin && <div aria-label={text("完成时汇合依据", "Recorded completion join")} className="space-y-1 border-t pt-2">
        <p>{text("完成时记录的汇合", "Recorded completion join")}: {loop.completedJoin.sourceAttemptId} / {loop.completedJoin.flowId} · {loop.completedJoin.mode}</p>
        {joinFacts(loop.completedJoin.evaluation, text("冻结汇合", "Frozen join"))}
      </div>}
      {loop.stop && <p>{text("已停止后续候选（不等于物理停止）", "Future candidates stopped (not physical shutdown)")}: {loop.stop.reason} · {loop.stop.actorUserId} · {loop.stop.recordedAt}</p>}
      {loop.abandon && <p>{text("预算已明确结束；非成功，未释放责任", "Budget explicitly ended; not success or responsibility release")}: {loop.abandon.reason} · {loop.abandon.actorUserId} · {loop.abandon.recordedAt}</p>}
      {!loop.abandon && !uncertain && !pendingArm && !pendingControl && !foreignRecovery && !recovery.error && !loop.completedAt && loop.status !== "completed" && <>
        <label className="block">{text("处置原因", "Action reason")}<textarea aria-label="Candidate loop reason" className="block w-full rounded border bg-background p-2" maxLength={4000} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        {!loop.stop && <form onSubmit={(event) => void command("stop", event)} className="space-y-2">
          <button type="submit" className="wb-button" disabled={busy || !reason.trim()}><Square size={14} />{text("停止后续候选（非物理停止）", "Stop future candidates (not physical shutdown)")}</button>
        </form>}
        <form onSubmit={(event) => void command("abandon", event)} className="space-y-2">
          <p>{text("结束固定候选预算，不代表成功或释放责任。", "End the formal candidate budget; this is not success or responsibility release.")}</p>
          <label className="flex items-start gap-2"><input aria-label="Confirm candidate budget abandonment" type="checkbox" checked={confirmAbandon} onChange={(event) => setConfirmAbandon(event.target.checked)} />{text("确认结束预算管理", "Confirm ending budget management")}</label>
          <button type="submit" className="wb-button" disabled={busy || !confirmAbandon || !reason.trim()}><Ban size={14} />{text("结束候选预算", "Abandon candidate budget")}</button>
          {confirmAbandon && <button type="button" className="wb-button" onClick={() => setConfirmAbandon(false)}>{text("取消", "Cancel")}</button>}
        </form>
      </>}
    </>}
    {observedAction && loop?.[observedAction] && <p role="status">{text("已观察到对应决定；实际记录者", "Matching decision observed; actual recorder")}: {loop[observedAction].actorUserId} · {loop[observedAction].recordedAt}</p>}
    {pendingControl && <><p role="status">{text("原CAS请求冻结；先读取原循环及确切attempt历史，不自动换判断或报告ID。", "Original CAS request frozen; read the loop and exact attempt history without changing judgment or report IDs.")}: {pendingControl.action} · {pendingControl.body.attemptId}</p>
      {retryControl && <button type="button" className="wb-button" disabled={busy} onClick={() => void sendControl(pendingControl, true)}><RefreshCw size={14} />{text("明确重试原CAS请求", "Explicitly retry original CAS request")}</button>}
    </>}
    {controlMessage && <p role="status">{controlMessage}</p>}
    {uncertain && <><p>{text("原请求已冻结；必须先读取原循环及历史，不会自动重新提交。", "Original request frozen; read the original loop and history before any new action.")}</p>
      {retryReady && <button type="button" className="wb-button" disabled={busy} onClick={() => void command(uncertain.action)}>{text("明确重试原请求", "Explicitly retry original request")}</button>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
