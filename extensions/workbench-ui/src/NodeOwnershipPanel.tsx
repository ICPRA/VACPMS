import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Square } from "lucide-react";
import type { WorkbenchRequest } from "./workbenchModel";

type Summary = { kind: "progress"; eventId: string } | { kind: "program_result"; attemptId: string } |
  { kind: "human_substitute"; humanSubstitute: { statement: string; sourceRefs: string[]; missingInfo: string[] } };
type Dispatch = { runId: string; admissionId: string; executorKind: string; environmentId: string; nativeProjectId?: string; attemptId?: string };
type Preparation = { runId: string; packageId: string; executorKind: string; state: string; environmentId: string; threadId: string; raw: boolean };
type Claim = { agent: string; claimedAt: string; leaseExpires: string };
type Handoff = { runId: string; admissionId: string; summary: Summary };
type PreparedHandoff = { runId: string; packageId: string; summary: Summary; stopNote: string };
type ClaimHandoff = { agent: string; claimedAt: string; summary: Summary; stopNote: string };
type Operation = { id: string; taskSlug: string; idempotencyKey: string; action: "take" | "return"; status: "pending" | "committed" | "cancelled";
  beforeOwnerUserId: string | null; afterOwnerUserId: string | null; fromVersion: number; toVersion?: number; actorUserId: string; reason: string;
  dispatches: Dispatch[]; preparations: Preparation[]; frozenClaim: Claim | null; handoffs: Handoff[]; preparedHandoffs: PreparedHandoff[];
  claimHandoff: ClaimHandoff | null; createdAt: string; finishedAt?: string; cancelActorUserId?: string; cancelReason?: string };
type Observation = { runId: string; admissionId: string; stopConfirmedAt?: string; releaseKind?: string; currentAttemptId?: string;
  programResult: { outcome: string; exitCode: number | null; summary: string | null } | null };
type OwnerState = { taskSlug: string; version: number; humanOwnerUserId: string | null; currentClaim: Claim | null; pending?: Operation;
  dispatchObservations: Observation[]; preparationObservations: Array<{ runId: string; packageId: string; cancelledAt?: string }> };
type History = { taskSlug: string; operations: Operation[]; hasMore: boolean; nextCursor: string | null };
type DispatchStatus = { admission: { id: string; runId: string } | null; resolution: { kind: string } | null;
  stopConfirmation: { actor: string; note: string; confirmedAt: string; programAttemptId?: string } | null };
type BeginBody = { taskSlug: string; expectedVersion: number; expectedOwnerUserId: string | null; idempotencyKey: string; reason: string };
type CommitBody = { operationId: string; expectedVersion: number; handoffs: Handoff[]; preparedHandoffs: PreparedHandoff[]; claimHandoff: ClaimHandoff | null };
type Pending = { action: "take-begin" | "return"; body: BeginBody } | { action: "take-commit"; body: CommitBody } |
  { action: "take-cancel"; body: { operationId: string; reason: string } } |
  { action: "program-stop"; body: { runId: string; admissionId: string; attemptId: string; environmentId: string; nativeProjectId: string; note: string } };
type Recovery = { project: string; taskSlug: string; pending: Pending };
type Draft = { kind: "" | Summary["kind"]; eventId: string; statement: string; sources: string; missing: string; stopNote: string; confirmedStop: boolean };
const STORAGE_KEY = "workbench.pending-node-owner.v1";
const blankDraft = (): Draft => ({ kind: "", eventId: "", statement: "", sources: "", missing: "", stopNote: "", confirmedStop: false });
const lines = (value: string) => value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const nonempty = (value: unknown) => typeof value === "string" && value.length > 0;
const recordValue = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function validSummary(value: unknown): boolean {
  if (!recordValue(value)) return false;
  if (value.kind === "progress") return nonempty(value.eventId);
  if (value.kind === "program_result") return nonempty(value.attemptId);
  const substitute = value.humanSubstitute;
  return value.kind === "human_substitute" && recordValue(substitute) && nonempty(substitute.statement) &&
    Array.isArray(substitute.sourceRefs) && substitute.sourceRefs.length > 0 && substitute.sourceRefs.every(nonempty) &&
    Array.isArray(substitute.missingInfo) && substitute.missingInfo.length > 0 && substitute.missingInfo.every(nonempty);
}
function validRecovery(record: unknown): record is Recovery {
  if (!recordValue(record) || !nonempty(record.project) || !nonempty(record.taskSlug) || !recordValue(record.pending)) return false;
  const { action, body } = record.pending;
  if (!recordValue(body)) return false;
  if (action === "take-begin" || action === "return") return body.taskSlug === record.taskSlug && Number.isInteger(body.expectedVersion) &&
    (body.expectedOwnerUserId === null || nonempty(body.expectedOwnerUserId)) && nonempty(body.idempotencyKey) && nonempty(body.reason);
  if (action === "take-cancel") return nonempty(body.operationId) && nonempty(body.reason);
  if (action === "program-stop") return ["runId", "admissionId", "attemptId", "environmentId", "nativeProjectId", "note"].every((key) => nonempty(body[key]));
  if (action !== "take-commit" || !nonempty(body.operationId) || !Number.isInteger(body.expectedVersion) ||
    !Array.isArray(body.handoffs) || !Array.isArray(body.preparedHandoffs)) return false;
  const handoffs = body.handoffs.every((item: unknown) => recordValue(item) && nonempty(item.runId) && nonempty(item.admissionId) && validSummary(item.summary));
  const prepared = body.preparedHandoffs.every((item: unknown) => recordValue(item) && nonempty(item.runId) && nonempty(item.packageId) && nonempty(item.stopNote) && validSummary(item.summary));
  const claim = body.claimHandoff;
  return handoffs && prepared && (claim === null || recordValue(claim) && nonempty(claim.agent) && nonempty(claim.claimedAt) && nonempty(claim.stopNote) && validSummary(claim.summary));
}
function sameHandoffs(left: Handoff[], right: Handoff[]) {
  return JSON.stringify([...left].sort((a, b) => a.runId.localeCompare(b.runId))) === JSON.stringify([...right].sort((a, b) => a.runId.localeCompare(b.runId)));
}
function samePrepared(left: PreparedHandoff[], right: PreparedHandoff[]) {
  return JSON.stringify([...left].sort((a, b) => a.runId.localeCompare(b.runId))) === JSON.stringify([...right].sort((a, b) => a.runId.localeCompare(b.runId)));
}

function readRecovery(storage: Storage): Recovery | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > 64 * 1024) throw new Error("Node owner recovery record exceeds its limit");
  const record: unknown = JSON.parse(raw);
  if (!validRecovery(record)) throw new Error("Invalid node owner recovery record");
  return record;
}
function keepRecovery(storage: Storage, record: Recovery) {
  const prior = readRecovery(storage);
  if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error("Resolve the original node owner request first");
  const raw = JSON.stringify(record);
  if (new TextEncoder().encode(raw).length > 64 * 1024) throw new Error("Node owner recovery request exceeds its limit");
  if (!prior) storage.setItem(STORAGE_KEY, raw);
}
function clearRecovery(storage: Storage, record: Recovery) {
  if (JSON.stringify(readRecovery(storage)) !== JSON.stringify(record)) throw new Error("Node owner recovery identity changed; record was not cleared");
  storage.removeItem(STORAGE_KEY);
}

export function NodeOwnershipPanel({ project, taskSlug, role, stage, events, language, request, onChanged, onOpenRun }: {
  project: string; taskSlug: string; role: "work" | "summary"; stage: string; events: Array<{ id: string; agent?: string; type?: string; message?: string; createdAt?: string }>;
  language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void; onOpenRun: (id: string) => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [recovery, setRecovery] = useState(() => {
    try { return { record: readRecovery(localStorage), error: "" }; }
    catch (cause) { return { record: null, error: String(cause) }; }
  });
  const ownRecovery = recovery.record?.project === project && recovery.record.taskSlug === taskSlug ? recovery.record : null;
  const foreignRecovery = recovery.record && !ownRecovery ? recovery.record : null;
  const [pendingWrite, setPendingWrite] = useState<Pending | null>(ownRecovery?.pending ?? null);
  const [retryReady, setRetryReady] = useState(false);
  const [state, setState] = useState<OwnerState | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [takeReason, setTakeReason] = useState("");
  const [returnReason, setReturnReason] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [confirmTake, setConfirmTake] = useState(false);
  const [confirmReturn, setConfirmReturn] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [programStop, setProgramStop] = useState<Record<string, { note: string; confirmed: boolean }>>({});
  const inFlight = useRef(false);
  const scope = useRef<AbortController | null>(null);
  const endpoint = `/workbench-api/loop/node-ownership/${encodeURIComponent(taskSlug)}`;
  const terminal = role !== "work" || stage === "done" || stage === "abandoned" || stage === "superseded";
  const locked = busy || !!pendingWrite || !!foreignRecovery || !!recovery.error;

  function checkedState(value: unknown): OwnerState {
    const next = value as OwnerState;
    if (!next || next.taskSlug !== taskSlug || !Number.isInteger(next.version) || !Array.isArray(next.dispatchObservations) ||
      !Array.isArray(next.preparationObservations) || (next.pending && (next.pending.taskSlug !== taskSlug || !Number.isInteger(next.pending.fromVersion) || next.pending.fromVersion < 1))) throw new Error("Node owner scope or response mismatch");
    return next;
  }
  function checkedHistory(value: unknown): History {
    const page = value as History;
    if (!page || page.taskSlug !== taskSlug || !Array.isArray(page.operations) || page.operations.some((item) => item.taskSlug !== taskSlug) ||
      typeof page.hasMore !== "boolean" || !(page.nextCursor === null || typeof page.nextCursor === "string")) throw new Error("Node owner history scope mismatch");
    return page;
  }
  async function get(url: string) {
    const response = await request(url, { headers: { "X-Specgraph-Project": project }, cache: "no-store", ...(scope.current ? { signal: scope.current.signal } : {}) });
    scope.current?.signal.throwIfAborted();
    if (response.status === 401) setNeedsLogin(true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }
  async function read() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false); setState(null); setHistory(null); setConfirmTake(false); setConfirmReturn(false); setConfirmCancel(false);
    try {
      const current = checkedState(await get(endpoint));
      const page = pendingWrite && pendingWrite.action !== "program-stop" ? checkedHistory(await get(`${endpoint}/history`)) : null;
      setState(current); if (page) setHistory(page);
      if (pendingWrite && page) reconcile(pendingWrite, current, page);
      if (pendingWrite?.action === "program-stop") {
        const dispatch = await get(`/workbench-api/loop/runs/${encodeURIComponent(pendingWrite.body.runId)}/dispatch`) as DispatchStatus;
        reconcileProgramStop(pendingWrite, dispatch);
      }
    } catch (cause) { if (!scope.current?.signal.aborted) setError(String(cause)); }
    finally { inFlight.current = false; if (!scope.current?.signal.aborted) setBusy(false); }
  }
  useEffect(() => { const controller = new AbortController(); scope.current = controller; void read(); return () => controller.abort(); }, [project, taskSlug]);

  function finishPending(command: Pending) {
    clearRecovery(localStorage, { project, taskSlug, pending: command });
    setRecovery({ record: null, error: "" }); setPendingWrite(null); setRetryReady(false);
  }
  function summaryFor(id: string, runId: string, executor: string, attemptId?: string, result?: Observation["programResult"]): Summary | null {
    const draft = drafts[id] ?? blankDraft();
    if (draft.kind === "progress") {
      return events.some((item) => item.id === draft.eventId && item.agent === runId && item.type === "progress") ? { kind: "progress", eventId: draft.eventId } : null;
    }
    if (draft.kind === "program_result") return executor === "program" && attemptId && result ? { kind: "program_result", attemptId } : null;
    if (draft.kind === "human_substitute") {
      const sourceRefs = lines(draft.sources), missingInfo = lines(draft.missing);
      return draft.statement.trim() && sourceRefs.length && missingInfo.length ? { kind: "human_substitute", humanSubstitute: { statement: draft.statement.trim(), sourceRefs, missingInfo } } : null;
    }
    return null;
  }
  const operation = state?.pending;
  const handoffs = operation?.dispatches.map((frozen) => {
    const observation = state?.dispatchObservations.find((item) => item.runId === frozen.runId && item.admissionId === frozen.admissionId);
    const summary = summaryFor(`dispatch:${frozen.runId}`, frozen.runId, frozen.executorKind, frozen.attemptId, observation?.programResult);
    return observation?.stopConfirmedAt && observation.releaseKind && (!frozen.attemptId || observation.currentAttemptId === frozen.attemptId) && summary
      ? { runId: frozen.runId, admissionId: frozen.admissionId, summary } : null;
  }) ?? [];
  const preparedHandoffs = operation?.preparations.filter((item) => item.raw && item.state === "bound").map((item) => {
    const draft = drafts[`prepared:${item.runId}`] ?? blankDraft();
    const summary = summaryFor(`prepared:${item.runId}`, item.runId, item.executorKind);
    return summary && draft.confirmedStop && draft.stopNote.trim()
      ? { runId: item.runId, packageId: item.packageId, summary, stopNote: draft.stopNote.trim() } : null;
  }) ?? [];
  const claimDraft = drafts.claim ?? blankDraft();
  const claimSummary = operation?.frozenClaim && summaryFor("claim", operation.frozenClaim.agent, "agent");
  const claimHandoff = operation?.frozenClaim && claimSummary && claimDraft.confirmedStop && claimDraft.stopNote.trim()
    ? { agent: operation.frozenClaim.agent, claimedAt: operation.frozenClaim.claimedAt, summary: claimSummary, stopNote: claimDraft.stopNote.trim() } : null;
  const canCommit = !!state && !!operation && operation.status === "pending" && !terminal && handoffs.length === operation.dispatches.length && handoffs.every(Boolean) &&
    preparedHandoffs.length === operation.preparations.filter((item) => item.raw && item.state === "bound").length && preparedHandoffs.every(Boolean) &&
    operation.preparations.filter((item) => !(item.raw && item.state === "bound")).every((item) => state.preparationObservations.some((observation) => observation.runId === item.runId && observation.packageId === item.packageId && !!observation.cancelledAt)) &&
    (!operation.frozenClaim || !!claimHandoff);

  function reconcile(command: Pending, current: OwnerState, page: History) {
    const exact = command.action === "take-begin" || command.action === "return"
      ? page.operations.find((item) => item.idempotencyKey === command.body.idempotencyKey)
      : command.action === "program-stop" ? null : page.operations.find((item) => item.id === (command.body as CommitBody | { operationId: string; reason: string }).operationId);
    if (command.action === "program-stop") return;
    if (exact) {
      const matched = command.action === "take-begin" || command.action === "return"
        ? exact.action === (command.action === "take-begin" ? "take" : "return") && exact.fromVersion === command.body.expectedVersion &&
          exact.beforeOwnerUserId === command.body.expectedOwnerUserId && exact.reason === command.body.reason
        : command.action === "take-commit" ? exact.status === "committed" && exact.toVersion === command.body.expectedVersion + 1 &&
          sameHandoffs(exact.handoffs, command.body.handoffs) && samePrepared(exact.preparedHandoffs, command.body.preparedHandoffs) &&
          JSON.stringify(exact.claimHandoff) === JSON.stringify(command.body.claimHandoff)
          : exact.status === "cancelled" && exact.cancelReason === command.body.reason && !!exact.cancelActorUserId;
      if (matched) { finishPending(command); setMessage(`${text("已观察到原责任操作，实际记录者", "Original owner action observed; actual actor")}: ${command.action === "take-cancel" ? exact.cancelActorUserId : exact.actorUserId} · ${exact.status}`); onChanged(); }
      else if ((command.action === "take-commit" || command.action === "take-cancel") && exact.status === "pending" &&
        current.pending?.id === exact.id && (command.action === "take-cancel" || current.version === command.body.expectedVersion)) setRetryReady(true);
      else { setError(text("原身份对应不同责任操作，保持冻结。", "Different node owner action has the original identity; controls remain frozen.")); }
    } else if (!page.hasMore && (command.action === "take-begin" || command.action === "return" ? current.version === command.body.expectedVersion && current.humanOwnerUserId === command.body.expectedOwnerUserId
      : current.pending?.id === (command.body as CommitBody | { operationId: string; reason: string }).operationId)) setRetryReady(true);
  }
  function reconcileProgramStop(command: Extract<Pending, { action: "program-stop" }>, dispatch: DispatchStatus) {
    const body = command.body;
    if (dispatch.admission?.id !== body.admissionId || dispatch.admission.runId !== body.runId) {
      setError(text("原程序准入身份已变，保持原请求冻结。", "Original program admission identity changed; request remains frozen.")); return;
    }
    if (dispatch.stopConfirmation) {
      if (dispatch.stopConfirmation.note !== body.note || dispatch.stopConfirmation.programAttemptId !== body.attemptId ||
        !dispatch.stopConfirmation.actor || !dispatch.stopConfirmation.confirmedAt) {
        setError(text("原程序已有不同停止记录，保持原请求冻结。", "Original program has a different stop record; request remains frozen.")); return;
      }
      finishPending(command);
      setMessage(`${text("已观察到原程序停止记录，实际记录者", "Original program stop observed; actual actor")}: ${dispatch.stopConfirmation.actor} · ${dispatch.stopConfirmation.confirmedAt}`);
      onChanged(); return;
    }
    setRetryReady(true);
  }

  async function readHistory(more = false) {
    if (inFlight.current || more && !history?.nextCursor) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false);
    try {
      const page = checkedHistory(await get(`${endpoint}/history${more ? `?cursor=${encodeURIComponent(history!.nextCursor!)}` : ""}`));
      const combined = more && history ? { ...page, operations: [...history.operations, ...page.operations] } : page;
      setHistory(combined); if (pendingWrite && state) reconcile(pendingWrite, state, combined);
    } catch (cause) { setState(null); setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function send(command: Pending, retry = false) {
    if (inFlight.current || recovery.error || foreignRecovery || (retry ? pendingWrite !== command || !retryReady : !!pendingWrite)) return;
    const saved: Recovery = { project, taskSlug, pending: command };
    try { keepRecovery(localStorage, saved); setRecovery({ record: saved, error: "" }); }
    catch (cause) { setError(`${text("恢复记录不能保存；未发送请求", "Recovery record could not be saved; request was not sent")}: ${String(cause)}`); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage(""); setPendingWrite(command); setRetryReady(false);
    const url = command.action === "program-stop" ? `/workbench-api/loop/program-runs/${encodeURIComponent(command.body.runId)}/confirm-stopped`
      : `/workbench-api/loop/node-ownership/${command.action}`;
    try {
      const response = await request(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(command.body) });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) { if (response.status < 500) { finishPending(command); setState(null); } throw new Error(`HTTP ${response.status}`); }
      const result = await response.json() as Operation | { admission?: { id: string; runId: string }; stopConfirmation?: { actor: string; note: string; confirmedAt: string; programAttemptId?: string }; resolution?: { kind: string } };
      const valid = command.action === "program-stop" ? "stopConfirmation" in result && result.admission?.id === command.body.admissionId && result.admission.runId === command.body.runId &&
        result.stopConfirmation?.note === command.body.note && result.stopConfirmation.programAttemptId === command.body.attemptId && !!result.stopConfirmation.actor && !!result.stopConfirmation.confirmedAt
        : "taskSlug" in result && result.taskSlug === taskSlug && result.actorUserId &&
          (command.action === "take-begin" || command.action === "return" ? result.idempotencyKey === command.body.idempotencyKey && result.fromVersion === command.body.expectedVersion &&
            result.beforeOwnerUserId === command.body.expectedOwnerUserId && result.reason === command.body.reason && result.action === (command.action === "take-begin" ? "take" : "return") &&
            (command.action === "return" ? result.status === "committed" && result.afterOwnerUserId === null : result.status === "pending" || result.status === "committed")
            : result.id === (command.body as CommitBody | { operationId: string; reason: string }).operationId && (command.action === "take-commit" ?
              result.status === "committed" && result.toVersion === command.body.expectedVersion + 1 && sameHandoffs(result.handoffs, command.body.handoffs) &&
              samePrepared(result.preparedHandoffs, command.body.preparedHandoffs) && JSON.stringify(result.claimHandoff) === JSON.stringify(command.body.claimHandoff) :
              result.status === "cancelled" && result.cancelReason === command.body.reason && !!result.cancelActorUserId));
      if (!valid) throw new Error("Node owner operation receipt mismatch");
      finishPending(command); setState(null); setHistory(null); setMessage(command.action === "program-stop"
        ? text("已记录人类对确切程序attempt的停止观察；保留原责任释放历史，不是后端进程树证明。", "Human stop observation recorded for the exact program attempt; original responsibility release history is preserved, not backend proof of process-tree shutdown.")
        : command.action === "return" ? text("人工owner已清除；不会启动AI或恢复旧run。", "Human owner cleared; no AI was started or old run resumed.")
          : command.action === "take-begin" && "status" in result && result.status === "pending" ? text("接手准备已记录，owner尚未变更；逐项完成原责任交接后再提交。", "Take preparation recorded; owner has not changed. Complete each original handoff before commit.")
            : text("原责任操作已记录；重读当前owner状态。", "Original owner action recorded; reread the current owner state.")); onChanged();
    } catch (cause) { setError(text("原责任操作结果未确认或被拒绝；先读原owner/历史核对：", "Original owner action unconfirmed or rejected; read owner and history: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function login() {
    if (inFlight.current || !key) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`); setNeedsLogin(false); setKey("");
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const progress = (agent: string) => events.filter((event) => event.type === "progress" && event.agent === agent);
  const summaryInput = (id: string, agent: string, executor: string, attemptId?: string, result?: Observation["programResult"]) => {
    const draft = drafts[id] ?? blankDraft();
    return <div className="space-y-1 border-t pt-2">
      <label>{text("交接总结来源", "Handoff summary source")}<select aria-label={`Owner summary kind ${id}`} disabled={locked} value={draft.kind} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, kind: event.target.value as Draft["kind"], eventId: "" } })}>
        <option value="">{text("明确选择", "Select explicitly")}</option>{progress(agent).length > 0 && <option value="progress">{text("原进展事件", "Original progress event")}</option>}
        {executor === "program" && attemptId && result && <option value="program_result">{text("确切程序结果", "Exact program result")}</option>}
        <option value="human_substitute">{text("人工据现有记录补录（标明缺失）", "Human substitute from available records (name missing information)")}</option>
      </select></label>
      {draft.kind === "progress" && <label>{text("原进展事件（仅当前详情最近20条范围）", "Original progress event (only the latest 20 in this detail view)")}<select aria-label={`Owner progress event ${id}`} disabled={locked} value={draft.eventId} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, eventId: event.target.value } })}><option value="">{text("选择事件", "Select event")}</option>{progress(agent).map((event) => <option key={event.id} value={event.id}>{event.id} · {event.message ?? ""}</option>)}</select></label>}
      {draft.kind === "program_result" && <p>{text("本轮已登记结果（不是停止证明）", "Recorded attempt result (not stop proof)")}: {attemptId} · {result?.outcome} · {result?.exitCode ?? "?"}</p>}
      {draft.kind === "human_substitute" && <>
        <label>{text("人工总结", "Human summary")}<textarea aria-label={`Owner substitute statement ${id}`} disabled={locked} maxLength={4000} value={draft.statement} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, statement: event.target.value } })} /></label>
        <label>{text("已见原来源引用（每行一条）", "Observed original source refs (one per line)")}<textarea aria-label={`Owner substitute sources ${id}`} disabled={locked} value={draft.sources} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, sources: event.target.value } })} /></label>
        <label>{text("缺失信息（每行一条）", "Missing information (one per line)")}<textarea aria-label={`Owner substitute missing ${id}`} disabled={locked} value={draft.missing} onChange={(event) => setDrafts({ ...drafts, [id]: { ...draft, missing: event.target.value } })} /></label>
      </>}
    </div>;
  };

  return <section aria-label="Human node ownership" className="wb-panel space-y-3">
    <h3>{text("人工节点负责人", "Human node owner")} · {taskSlug}</h3>
    <p>{text("人工owner与依赖图就绪分开；接手不隔离仍运行进程，交回不启动AI或恢复旧run。", "Human ownership is separate from graph readiness. Taking over does not isolate a running process; returning does not start AI or resume an old run.")}</p>
    {foreignRecovery && <p role="alert">{text("先恢复另一节点原请求", "Resolve the original request for another node first")}: {foreignRecovery.project} / {foreignRecovery.taskSlug}</p>}
    {recovery.error && <p role="alert">{text("原恢复记录不可读取，未发新请求", "Recovery record unreadable; no new request sent")}: {recovery.error}</p>}
    <button type="button" className="wb-button" disabled={busy} onClick={() => void read()}><RefreshCw size={14} />{text("读取原owner及交接观察", "Read original owner and handoff observations")}</button>
    {needsLogin && <div><input aria-label="Node owner access key" type="password" value={key} onChange={(event) => setKey(event.target.value)} /><button type="button" className="wb-button" disabled={busy || !key} onClick={() => void login()}>{text("登录", "Sign in")}</button></div>}
    {state && <>
      <p>{text("当前人工负责人", "Current human owner")}: {state.humanOwnerUserId ?? text("未指定", "none")} · v{state.version}</p>
      {state.currentClaim && <p>{text("当前原claim（租约到期不证明停止）", "Current original claim (lease expiry is not stop proof)")}: {state.currentClaim.agent} · {state.currentClaim.claimedAt} · {state.currentClaim.leaseExpires}</p>}
      {!state.pending && <div className="space-y-1">
        {!terminal && <>
        <label>{text("接手原因", "Takeover reason")}<textarea aria-label="Node owner take reason" disabled={locked} maxLength={4000} value={takeReason} onChange={(event) => setTakeReason(event.target.value)} /></label>
        <label className="flex items-start gap-2"><input aria-label="Confirm node owner take" type="checkbox" disabled={locked} checked={confirmTake} onChange={(event) => setConfirmTake(event.target.checked)} />{text("明确由本人准备接手；若有旧执行，begin不会立即改owner", "Explicitly prepare my takeover; begin does not change the owner while old work remains")}</label>
        <button type="button" className="wb-button" disabled={locked || !confirmTake || !takeReason.trim()} onClick={() => void send({ action: "take-begin", body: { taskSlug, expectedVersion: state.version, expectedOwnerUserId: state.humanOwnerUserId, idempotencyKey: newKey(), reason: takeReason.trim() } })}><Check size={14} />{text("我来处理：开始具名接手", "I will handle this: begin named takeover")}</button>
        </>}
        {state.humanOwnerUserId && <>
          <label>{text("交回AI待派原因", "Reason to return for later AI dispatch")}<textarea aria-label="Node owner return reason" disabled={locked} maxLength={4000} value={returnReason} onChange={(event) => setReturnReason(event.target.value)} /></label>
          <label className="flex items-start gap-2"><input aria-label="Confirm node owner return" type="checkbox" disabled={locked} checked={confirmReturn} onChange={(event) => setConfirmReturn(event.target.checked)} />{text("明确清除当前人工owner；不会启动AI或旧run", "Explicitly clear the human owner; this starts no AI or old run")}</label>
          <button type="button" className="wb-button" disabled={locked || !confirmReturn || !returnReason.trim()} onClick={() => void send({ action: "return", body: { taskSlug, expectedVersion: state.version, expectedOwnerUserId: state.humanOwnerUserId, idempotencyKey: newKey(), reason: returnReason.trim() } })}><Check size={14} />{text("交回AI待派", "Return for later AI dispatch")}</button>
        </>}
      </div>}
      {operation && <div aria-label="Pending node takeover" className="space-y-2 border-t pt-2">
        <p>{text("接手操作", "Take operation")}: {operation.id} · {operation.status} · {text("原负责人", "Previous owner")}: {operation.beforeOwnerUserId ?? "none"} · {text("发起人", "Initiator")}: {operation.actorUserId}</p>
        {operation.dispatches.map((frozen) => {
          const observation = state.dispatchObservations.find((item) => item.runId === frozen.runId && item.admissionId === frozen.admissionId);
          const id = `dispatch:${frozen.runId}`;
          const stop = programStop[frozen.runId] ?? { note: "", confirmed: false };
          return <div key={frozen.runId} className="space-y-1 border-t py-2">
            <p>{text("原已准入执行", "Original admitted run")}: {frozen.runId} / {frozen.admissionId} · {frozen.executorKind} · {frozen.attemptId ?? ""}</p>
            <p>{text("实际停止确认", "Observed stop confirmation")}: {observation?.stopConfirmedAt ?? text("未记录", "not recorded")} · {text("责任释放", "Responsibility release")}: {observation?.releaseKind ?? text("未记录", "not recorded")}</p>
            <button type="button" className="wb-button" onClick={() => onOpenRun(frozen.runId)}>{text("查看原执行", "Open original run")}: {frozen.runId}</button>
            {frozen.executorKind === "program" && !observation?.stopConfirmedAt && frozen.attemptId && frozen.nativeProjectId && observation?.currentAttemptId === frozen.attemptId && <div className="space-y-1">
              <p>{text("先核对进程树确已停止；程序取消、超时或结果均不能代替停止证明。", "Verify the process tree has actually stopped; cancellation, timeout and result are not stop proof.")}</p>
              <label>{text("停止核实依据", "Stop verification note")}<textarea aria-label={`Program stop note ${frozen.runId}`} disabled={locked} maxLength={4000} value={stop.note} onChange={(event) => setProgramStop({ ...programStop, [frozen.runId]: { ...stop, note: event.target.value } })} /></label>
              <label className="flex items-start gap-2"><input aria-label={`Confirm program stopped ${frozen.runId}`} type="checkbox" disabled={locked} checked={stop.confirmed} onChange={(event) => setProgramStop({ ...programStop, [frozen.runId]: { ...stop, confirmed: event.target.checked } })} />{text("我已核实确切程序attempt及其进程树停止", "I verified the exact program attempt and its process tree stopped")}</label>
              <button type="button" className="wb-button" disabled={locked || !stop.confirmed || !stop.note.trim()} onClick={() => void send({ action: "program-stop", body: { runId: frozen.runId, admissionId: frozen.admissionId, attemptId: frozen.attemptId!, environmentId: frozen.environmentId, nativeProjectId: frozen.nativeProjectId!, note: stop.note.trim() } })}><Square size={14} />{text("具名确认原程序停止", "Record named original program stop")}</button>
            </div>}
            {summaryInput(id, frozen.runId, frozen.executorKind, frozen.attemptId, observation?.programResult)}
          </div>;
        })}
        {operation.preparations.map((item) => {
          const draft = drafts[`prepared:${item.runId}`] ?? blankDraft();
          const observation = state.preparationObservations.find((entry) => entry.runId === item.runId && entry.packageId === item.packageId);
          return <div key={item.runId} className="space-y-1 border-t py-2">
            <p>{text("原未准入准备", "Original unadmitted preparation")}: {item.runId} / {item.packageId} · {item.state} · {item.raw ? "raw" : "formal"}</p>
            {item.raw && item.state === "bound" ? <>
              <p>{text("原raw绑定须先核实实际停止并据事实补总结；commit将原子取消该准备。", "The original raw binding needs an observed stop and named summary; commit atomically cancels that preparation.")}</p>
              {summaryInput(`prepared:${item.runId}`, item.runId, item.executorKind)}
              <label>{text("已核停止依据", "Observed stop note")}<textarea aria-label={`Raw stop note ${item.runId}`} disabled={locked} maxLength={4000} value={draft.stopNote} onChange={(event) => setDrafts({ ...drafts, [`prepared:${item.runId}`]: { ...draft, stopNote: event.target.value } })} /></label>
              <label className="flex items-start gap-2"><input aria-label={`Confirm raw stopped ${item.runId}`} type="checkbox" disabled={locked} checked={draft.confirmedStop} onChange={(event) => setDrafts({ ...drafts, [`prepared:${item.runId}`]: { ...draft, confirmedStop: event.target.checked } })} />{text("我已核实原raw执行停止", "I verified the original raw execution stopped")}</label>
            </> : <p>{text("原准备取消记录", "Original preparation cancellation")}: {observation?.cancelledAt ?? text("未记录；使用原准备取消入口", "not recorded; use original cancellation control")}</p>}
            <button type="button" className="wb-button" onClick={() => onOpenRun(item.runId)}>{text("查看原执行", "Open original run")}: {item.runId}</button>
          </div>;
        })}
        {operation.frozenClaim && <div className="space-y-1 border-t py-2">
          <p>{text("原独立claim", "Original claim")}: {operation.frozenClaim.agent} · {operation.frozenClaim.claimedAt} · {text("租约到期不证明停止", "lease expiry is not stop proof")}</p>
          {summaryInput("claim", operation.frozenClaim.agent, "agent")}
          <label>{text("原claim停止核实依据", "Original claim stop note")}<textarea aria-label="Claim stop note" disabled={locked} maxLength={4000} value={claimDraft.stopNote} onChange={(event) => setDrafts({ ...drafts, claim: { ...claimDraft, stopNote: event.target.value } })} /></label>
          <label className="flex items-start gap-2"><input aria-label="Confirm claim stopped" type="checkbox" disabled={locked} checked={claimDraft.confirmedStop} onChange={(event) => setDrafts({ ...drafts, claim: { ...claimDraft, confirmedStop: event.target.checked } })} />{text("我已核实原claim主体停止", "I verified the original claim actor stopped")}</label>
        </div>}
        <button type="button" className="wb-button" disabled={locked || !canCommit} onClick={() => void send({ action: "take-commit", body: { operationId: operation.id, expectedVersion: state.version, handoffs: handoffs.filter((item): item is Handoff => !!item), preparedHandoffs: preparedHandoffs.filter((item): item is PreparedHandoff => !!item), claimHandoff: claimHandoff || null } })}><Check size={14} />{text("按原事实提交接手", "Commit takeover using original facts")}</button>
        <label>{text("取消本次待接手原因", "Reason to cancel pending takeover")}<textarea aria-label="Node owner cancel reason" disabled={locked} maxLength={4000} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
        <label className="flex items-start gap-2"><input aria-label="Confirm node owner cancel" type="checkbox" disabled={locked} checked={confirmCancel} onChange={(event) => setConfirmCancel(event.target.checked)} />{text("明确取消待接手，现owner不变", "Explicitly cancel pending takeover; current owner remains unchanged")}</label>
        <button type="button" className="wb-button" disabled={locked || !confirmCancel || !cancelReason.trim()} onClick={() => void send({ action: "take-cancel", body: { operationId: operation.id, reason: cancelReason.trim() } })}><Square size={14} />{text("取消待接手", "Cancel pending takeover")}</button>
      </div>}
      <button type="button" className="wb-button" disabled={busy} onClick={() => void readHistory()}><RefreshCw size={14} />{text("读取owner历史", "Read owner history")}</button>
      {history && <div aria-label="Node owner history">{history.operations.map((item) => <p key={item.id}>{item.id} · {item.action} · {item.status} · {item.actorUserId} · {item.reason}</p>)}
        {history.hasMore && <button type="button" className="wb-button" disabled={busy} onClick={() => void readHistory(true)}>{text("读取更多原历史", "Read more original history")}</button>}
      </div>}
    </>}
    {pendingWrite && <p role="status">{text("原责任请求冻结，先读取owner/原历史核对", "Original owner request frozen; read owner and original history before retry")}: {pendingWrite.action}</p>}
    {pendingWrite && retryReady && <button type="button" className="wb-button" disabled={busy} onClick={() => void send(pendingWrite, true)}>{text("明确重试原请求", "Explicitly retry original request")}</button>}
    {message && <p role="status">{message}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
