import { useEffect, useRef, useState } from "react";
import { Check, RefreshCw, Square } from "lucide-react";
import type { CompletionHookSummary, WorkbenchRequest, WorkbenchRun } from "./workbenchModel";

type Fact = { kind: "execution" | "manual" | "summary"; id: string };
type Hook = { id: string; project: string; sourceTaskSlug: string; sourceSpecId: string; sourceRole: string; targetRunId: string; targetPackageId: string;
  configuredByUserId: string; hostConsumerUserId: string; idempotencyKey: string; requestedFact: Fact | null; fact: Fact | null;
  state: string; createdAt: string; triggeredAt: string | null; cancelledAt: string | null; cancelledByUserId: string | null; cancellationReason: string | null;
  dispatchStatus: string | null; dispatchDetail: string | null; retriedAt: string | null; programAdmissionId: string | null; admission?: unknown };
type Preview = { runId: string; packageId: string; taskSlug: string; target: Record<string, unknown>; dispatch: { admission: unknown; cancellation: unknown } };
type ArmBody = { sourceTaskSlug: string; sourceSpecId: string; targetRunId: string; targetPackageId: string; idempotencyKey: string; confirmTrigger: true; fact?: Fact };
type FixedHook = Pick<Hook, "id" | "sourceSpecId" | "targetRunId" | "targetPackageId" | "idempotencyKey" | "requestedFact">;
type Pending = { action: "arm"; body: ArmBody } | { action: "cancel"; body: { hookId: string; reason: string }; fixed: FixedHook } |
  { action: "retry"; body: { hookId: string }; fixed: FixedHook };
type Recovery = { project: string; sourceSlug: string; sourceSpecId: string; pending: Pending };
const STORAGE_KEY = "workbench.pending-completion-hook.v1";
const MAX_RECOVERY_BYTES = 32 * 1024;
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
const sameFact = (left: Fact | null | undefined, right: Fact | null | undefined) => (left == null && right == null) || !!left && !!right && left.kind === right.kind && left.id === right.id;
const validFact = (value: unknown) => value == null || !!value && typeof value === "object" &&
  ((value as Fact).kind === "execution" || (value as Fact).kind === "manual" || (value as Fact).kind === "summary") &&
  typeof (value as Fact).id === "string" && !!(value as Fact).id;
const fixedHook = (hook: Hook): FixedHook => ({ id: hook.id, sourceSpecId: hook.sourceSpecId, targetRunId: hook.targetRunId,
  targetPackageId: hook.targetPackageId, idempotencyKey: hook.idempotencyKey, requestedFact: hook.requestedFact });
function readRecovery(storage: Storage): Recovery | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) throw new Error("Completion hook recovery record is too large");
  const value = JSON.parse(raw) as Recovery;
  const body = value?.pending?.body as Record<string, unknown> | undefined;
  if (!value || typeof value.project !== "string" || !value.project || typeof value.sourceSlug !== "string" || !value.sourceSlug ||
    typeof value.sourceSpecId !== "string" || !value.sourceSpecId || !body ||
    (value.pending.action !== "arm" && value.pending.action !== "cancel" && value.pending.action !== "retry")) throw new Error("Invalid completion hook recovery record");
  if (value.pending.action === "arm" ? body.sourceTaskSlug !== value.sourceSlug || body.sourceSpecId !== value.sourceSpecId ||
    typeof body.targetRunId !== "string" || !body.targetRunId || typeof body.targetPackageId !== "string" || !body.targetPackageId ||
    typeof body.idempotencyKey !== "string" || !body.idempotencyKey || body.confirmTrigger !== true || !validFact(body.fact)
    : typeof body.hookId !== "string" || !body.hookId || !value.pending.fixed || value.pending.fixed.id !== body.hookId ||
      value.pending.fixed.sourceSpecId !== value.sourceSpecId || !value.pending.fixed.targetRunId || !value.pending.fixed.targetPackageId ||
      !value.pending.fixed.idempotencyKey || !validFact(value.pending.fixed.requestedFact) ||
      (value.pending.action === "cancel" && (typeof body.reason !== "string" || !body.reason.trim()))) throw new Error("Invalid completion hook recovery request");
  return value;
}
function keepRecovery(storage: Storage, record: Recovery) {
  const prior = readRecovery(storage);
  if (prior && JSON.stringify(prior) !== JSON.stringify(record)) throw new Error("Resolve the original completion hook request first");
  const raw = JSON.stringify(record);
  if (new TextEncoder().encode(raw).length > MAX_RECOVERY_BYTES) throw new Error("Completion hook recovery request exceeds its limit");
  if (!prior) storage.setItem(STORAGE_KEY, raw);
}
function clearRecovery(storage: Storage, record: Recovery) {
  if (JSON.stringify(readRecovery(storage)) !== JSON.stringify(record)) throw new Error("Completion hook recovery identity changed; record was not cleared");
  storage.removeItem(STORAGE_KEY);
}

export function CompletionHookPanel({ project, source, runs, events, manualCompletions, hooks, language, request, onChanged }: {
  project: string; source: { id: string; slug: string; role: "work" | "summary"; stage: string }; runs: WorkbenchRun[];
  events: Array<{ id: string; agent?: string; type?: string; createdAt?: string }>;
  manualCompletions: Array<{ id: string; actor: string; createdAt: string }>;
  hooks: CompletionHookSummary[] | undefined; language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [targetId, setTargetId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [factKey, setFactKey] = useState("");
  const [summaryFact, setSummaryFact] = useState<string | null>(null);
  const [confirmedIdentity, setConfirmedIdentity] = useState<string | null>(null);
  const [hookList, setHookList] = useState<CompletionHookSummary[] | null>(hooks ?? null);
  const [selectedHook, setSelectedHook] = useState<Hook | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [recovery, setRecovery] = useState(() => {
    try { return { record: readRecovery(localStorage), error: "" }; }
    catch (cause) { return { record: null, error: String(cause) }; }
  });
  const ownRecovery = recovery.record?.project === project && recovery.record.sourceSlug === source.slug && recovery.record.sourceSpecId === source.id ? recovery.record : null;
  const foreignRecovery = recovery.record && !ownRecovery ? recovery.record : null;
  const [pending, setPending] = useState<Pending | null>(ownRecovery?.pending ?? null);
  const [retryReady, setRetryReady] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const inFlight = useRef(false);
  const pendingRef = useRef<Pending | null>(ownRecovery?.pending ?? null);
  const target = runs.find((run) => run.id === targetId);
  const targetIdentity = runs.filter((run) => run.executorKind === "program").map((run) => `${run.id}:${run.packageId}:${run.state}:${run.nativeProjectId}`).join("|");
  useEffect(() => { setPreview(null); setConfirmedIdentity(null); }, [source.id, targetIdentity]);
  useEffect(() => { if (!pendingRef.current) setHookList(hooks ?? null); }, [hooks]);
  const facts: Array<{ key: string; fact: Fact; label: string }> = source.role === "summary"
    ? summaryFact ? [{ key: `summary:${summaryFact}`, fact: { kind: "summary", id: summaryFact }, label: `${text("当前已接受汇总", "Current accepted summary")} · ${summaryFact}` }] : []
    : source.stage === "done" ? [
      ...events.filter((event) => event.type === "completion" && !!event.id).map((event) => ({ key: `execution:${event.id}`, fact: { kind: "execution" as const, id: event.id }, label: `${text("原执行完成事件", "Original execution completion")} · ${event.id} · ${event.agent ?? ""}` })),
      ...manualCompletions.map((event) => ({ key: `manual:${event.id}`, fact: { kind: "manual" as const, id: event.id }, label: `${text("原人工完成记录", "Original manual completion")} · ${event.id} · ${event.actor}` })),
    ] : [];
  const selectedFact = facts.find((item) => item.key === factKey)?.fact;
  const reviewIdentity = JSON.stringify([project, source.id, source.slug, targetId, target?.packageId, target?.state, preview, factKey, selectedFact]);
  const confirmed = confirmedIdentity === reviewIdentity;
  const ready = hookList !== null && !!source.id && !!target && target.executorKind === "program" && target.state === "prepared" && !!preview && preview.runId === target.id &&
    preview.packageId === target.packageId && preview.dispatch.admission === null && preview.dispatch.cancellation === null &&
    (!factKey || !!selectedFact);
  const locked = busy || !!pending || !!foreignRecovery || !!recovery.error;
  function finishPending(command: Pending) {
    clearRecovery(localStorage, { project, sourceSlug: source.slug, sourceSpecId: source.id, pending: command });
    pendingRef.current = null; setPending(null); setRecovery({ record: null, error: "" });
  }

  async function get(url: string) {
    const response = await request(url, { headers: { "X-Specgraph-Project": project }, cache: "no-store" });
    if (response.status === 401) setNeedsLogin(true);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  }

  function checkHook(value: unknown, expectedId?: string): Hook {
    const hook = (value as { hook?: Hook })?.hook ?? value as Hook;
    if (!hook || hook.project !== project || hook.sourceTaskSlug !== source.slug || (expectedId && hook.id !== expectedId) ||
      !hook.id || !hook.sourceSpecId || !hook.sourceRole || !hook.targetRunId || !hook.targetPackageId || !hook.configuredByUserId ||
      !hook.hostConsumerUserId || !hook.idempotencyKey || !hook.state || !(hook.requestedFact === null ||
        typeof hook.requestedFact?.kind === "string" && typeof hook.requestedFact.id === "string")) throw new Error("Completion hook scope or receipt mismatch");
    return hook;
  }

  async function inspectTarget() {
    if (inFlight.current || !target || target.executorKind !== "program" || target.state !== "prepared") return;
    inFlight.current = true; setBusy(true); setPreview(null); setConfirmedIdentity(null); setError("");
    try {
      const [contextValue, dispatchValue] = await Promise.all([
        get(`/workbench-api/loop/runs/${encodeURIComponent(target.id)}/context`),
        get(`/workbench-api/loop/runs/${encodeURIComponent(target.id)}/dispatch`),
      ]);
      const context = contextValue as { runId: string; taskSlug: string; packageId: string; body: { program_target?: Record<string, unknown> } };
      const dispatch = dispatchValue as Preview["dispatch"];
      const program = context?.body?.program_target;
      if (context.runId !== target.id || context.taskSlug !== target.taskSlug || context.packageId !== target.packageId || !program ||
        typeof program.executable !== "string" || !Array.isArray(program.args) || typeof program.cwd !== "string" ||
        program.environmentId !== target.environmentId || program.nativeProjectId !== target.nativeProjectId ||
        !dispatch || dispatch.admission !== null || dispatch.cancellation !== null) throw new Error("Original prepared program target or dispatch changed");
      setPreview({ runId: context.runId, taskSlug: context.taskSlug, packageId: context.packageId, target: program, dispatch });
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function readSummaryFact() {
    if (inFlight.current || source.role !== "summary") return;
    inFlight.current = true; setBusy(true); setSummaryFact(null); setFactKey(""); setConfirmedIdentity(null); setError("");
    try {
      const state = (await get(`/workbench-api/loop/summaries/${encodeURIComponent(source.slug)}`) as { summary?: { goalSlug: string; accepted: boolean; latestAcceptance?: { id: string; current: boolean; revokedAt: string | null } | null } })?.summary;
      if (state?.goalSlug !== source.slug) throw new Error("Summary fact scope mismatch");
      if (state.accepted && state.latestAcceptance?.current && !state.latestAcceptance.revokedAt) setSummaryFact(state.latestAcceptance.id);
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function readHook(id: string) {
    const hook = checkHook(await get(`/workbench-api/loop/completion-hooks/${encodeURIComponent(id)}`), id);
    const listed = hookList?.find((item) => item.id === id);
    if (listed && (hook.sourceSpecId !== listed.sourceSpecId || hook.targetRunId !== listed.targetRunId || hook.targetPackageId !== listed.targetPackageId)) throw new Error("Completion hook list and detail differ");
    setSelectedHook(hook); setCancelConfirmed(false);
    return hook;
  }

  async function inspectHook(id: string) {
    if (inFlight.current || pendingRef.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSelectedHook(null); setCancelConfirmed(false);
    try { await readHook(id); }
    catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function inspectSource() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setRetryReady(false); setSelectedHook(null); setCancelConfirmed(false);
    try {
      const value = await get(`/workbench-api/wb/specs/${encodeURIComponent(source.slug)}`) as { spec?: { id: string; slug: string }; completionHooks?: CompletionHookSummary[] };
      if (value.spec?.id !== source.id || value.spec.slug !== source.slug || !Array.isArray(value.completionHooks) ||
        !value.completionHooks.every((item) => item.sourceTaskSlug === source.slug && !!item.id && !!item.idempotencyKey && "requestedFact" in item)) throw new Error("Original source node or hook list changed; reselect it");
      setHookList(value.completionHooks);
      const original = pendingRef.current;
      if (original?.action === "arm") {
        const body = original.body as ArmBody;
        const candidates = value.completionHooks.filter((item) => item.idempotencyKey === body.idempotencyKey);
        const details = await Promise.all(candidates.map((item) => get(`/workbench-api/loop/completion-hooks/${encodeURIComponent(item.id)}`).then((record) => {
          const hook = checkHook(record, item.id);
          if (hook.sourceSpecId !== item.sourceSpecId || hook.targetRunId !== item.targetRunId || hook.targetPackageId !== item.targetPackageId ||
            hook.idempotencyKey !== item.idempotencyKey || !sameFact(hook.requestedFact, item.requestedFact)) throw new Error("Completion hook list and detail differ");
          return hook;
        })));
        const matching = details.filter((hook) => hook.sourceSpecId === body.sourceSpecId && hook.targetRunId === body.targetRunId && hook.targetPackageId === body.targetPackageId && sameFact(hook.requestedFact, body.fact));
        if (matching.length === 1) {
          finishPending(original); setSelectedHook(matching[0]!); setPreview(null); setConfirmedIdentity(null); setConflict(false); setRetryReady(false);
          setMessage(`${text("已观察到原配置；实际记录者", "Original configuration observed; actual recorder")}: ${matching[0]!.configuredByUserId} · ${matching[0]!.state}`); onChanged();
        } else if (candidates.length > 0) {
          setConflict(true); setError(text("原配置身份冲突，保持冻结。", "Original configuration identity conflicts; controls remain frozen."));
        } else setRetryReady(true);
      } else if (original) {
        const hook = await readHook((original.body as { hookId: string }).hookId);
        const fixed = original.fixed;
        if (hook.sourceSpecId !== fixed.sourceSpecId || hook.targetRunId !== fixed.targetRunId || hook.targetPackageId !== fixed.targetPackageId ||
          hook.idempotencyKey !== fixed.idempotencyKey || !sameFact(hook.requestedFact, fixed.requestedFact)) throw new Error("Original hook identity changed");
        const matches = original.action === "cancel" ? !!hook.cancelledAt && hook.cancellationReason === (original.body as { reason: string }).reason && !!hook.cancelledByUserId
          : !!hook.retriedAt && hook.state !== "blocked" && hook.state !== "unconfirmed";
        if (matches) { finishPending(original); setRetryReady(false); setConflict(false); setMessage(text("已观察到原hook的对应状态。", "Matching original hook state observed.")); onChanged(); }
        else setRetryReady(true);
      }
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function send(command: Pending) {
    if (inFlight.current || recovery.error || foreignRecovery) return;
    const record: Recovery = { project, sourceSlug: source.slug, sourceSpecId: source.id, pending: command };
    try { keepRecovery(localStorage, record); setRecovery({ record, error: "" }); }
    catch (cause) { setError(`${text("恢复记录不能保存；未发送新请求", "Recovery record could not be saved; no new request was sent")}: ${String(cause)}`); return; }
    inFlight.current = true; setBusy(true); setError(""); setMessage(""); setRetryReady(false);
    pendingRef.current = command; setPending(command);
    try {
      const response = await request(`/workbench-api/loop/completion-hooks/${command.action}`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify(command.body),
      });
      if (response.status === 401) setNeedsLogin(true);
      if (!response.ok) {
        if (response.status < 500) { finishPending(command); setPreview(null); setConfirmedIdentity(null); setSelectedHook(null); setCancelConfirmed(false); }
        throw new Error(`HTTP ${response.status}`);
      }
      const hook = checkHook(await response.json());
      const valid = command.action === "arm" ? hook.sourceSpecId === (command.body as ArmBody).sourceSpecId && hook.targetRunId === (command.body as ArmBody).targetRunId &&
        hook.targetPackageId === (command.body as ArmBody).targetPackageId && hook.idempotencyKey === (command.body as ArmBody).idempotencyKey && sameFact(hook.requestedFact, (command.body as ArmBody).fact)
        : hook.id === command.body.hookId && hook.sourceSpecId === command.fixed.sourceSpecId && hook.targetRunId === command.fixed.targetRunId &&
          hook.targetPackageId === command.fixed.targetPackageId && hook.idempotencyKey === command.fixed.idempotencyKey && sameFact(hook.requestedFact, command.fixed.requestedFact) && (command.action === "cancel" ? !!hook.cancelledAt && hook.cancellationReason === command.body.reason && !hook.admission && !hook.programAdmissionId
          : !!hook.retriedAt && hook.state !== "blocked" && hook.state !== "unconfirmed");
      if (!valid) throw new Error("Completion hook operation receipt mismatch");
      finishPending(command); setRetryReady(false); setConflict(false); setSelectedHook(hook); setPreview(null); setConfirmedIdentity(null);
      setMessage(command.action === "cancel" ? text("已取消未准入hook；不是已运行程序停止证明。", "Unadmitted hook cancelled; this is not proof that a running program stopped.")
        : command.action === "retry" ? text("原hook就绪重核；没有创建新目标或重启程序。", "Original hook readiness rechecked; no new target or program restart was created.")
          : text("原完成触发配置已记录；前端不会另行启动程序。", "Original completion trigger recorded; the UI does not start the program.")); onChanged();
    } catch (cause) { setError(text("操作结果未确认或被拒绝；先读取原source/hook核对：", "Outcome unconfirmed or rejected; read the original source and hook: ") + String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function login() {
    if (inFlight.current || !key) return;
    inFlight.current = true; setBusy(true); setError("");
    try { const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setKey(""); setNeedsLogin(false);
    } catch (cause) { setError(String(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  const canCancel = !!selectedHook && !selectedHook.cancelledAt && !selectedHook.programAdmissionId && !selectedHook.admission &&
    !hookList?.find((item) => item.id === selectedHook.id)?.programAdmissionId;
  const canRetry = !!selectedHook && (selectedHook.state === "blocked" || selectedHook.state === "unconfirmed") && !selectedHook.programAdmissionId && !selectedHook.admission && !selectedHook.cancelledAt &&
    !hookList?.find((item) => item.id === selectedHook.id)?.programAdmissionId;
  return <section aria-label={text("完成触发程序配置", "Completion-triggered program hook")} className="wb-panel space-y-3">
    <h3>{text("完成触发程序配置", "Completion-triggered program hook")}</h3>
    <p>{text("仅人工明确授权保存固定触发。后台宿主可能消费，前端不启动程序；配置不证明来源仍适用或程序已执行。", "Only an explicit human grant saves a fixed trigger. The host may consume it; this UI does not start a program or prove the source remains applicable.")}</p>
    <p>{text("原来源节点", "Original source node")}: {source.slug} · {source.id} · {source.role}</p>
    {foreignRecovery && <p role="alert">{text("先核对另一来源的未决原请求", "Resolve the original pending request for another source first")}: {foreignRecovery.project} / {foreignRecovery.sourceSlug} / {foreignRecovery.sourceSpecId}</p>}
    {recovery.error && <p role="alert">{text("恢复记录不可读取；未创建新请求", "Recovery record cannot be read; no new request was created")}: {recovery.error}</p>}
    {source.role === "work" && <p>{text("这里只列详情返回的最近20条执行事件及原人工完成记录，非完整历史；后端仍核对事实当前性。", "Only the last 20 returned execution events and original manual completions are listed, not the full history; the backend still checks current applicability.")}</p>}
    {source.role === "summary" && <button type="button" className="wb-button" disabled={locked} onClick={() => void readSummaryFact()}><RefreshCw size={14} />{text("读取当前汇总接受", "Read current summary acceptance")}</button>}
    {needsLogin && <div><input aria-label="Completion hook access key" type="password" value={key} onChange={(event) => setKey(event.target.value)} /><button type="button" className="wb-button" disabled={!key || busy} onClick={() => void login()}>{text("登录", "Sign in")}</button></div>}
    <fieldset disabled={locked || needsLogin} className="space-y-2">
      <label>{text("已准备程序执行", "Prepared program run")}<select aria-label="Completion hook target" value={targetId} onChange={(event) => { setTargetId(event.target.value); setPreview(null); setConfirmedIdentity(null); }}>
        <option value="">{text("选择原程序", "Select original program")}</option>{runs.filter((run) => run.executorKind === "program" && run.state === "prepared").map((run) => <option key={run.id} value={run.id}>{run.taskSlug} · {run.id} · {run.packageId}</option>)}
      </select></label>
      <button type="button" className="wb-button" disabled={!target} onClick={() => void inspectTarget()}><RefreshCw size={14} />{text("读取原程序准备与准入", "Read original program preparation and admission")}</button>
      {preview && <div aria-label="Completion hook program preview" className="space-y-1 break-all border-y py-2">
        <p>{preview.taskSlug} · {preview.runId} · {preview.packageId}</p>
        <p>{text("固定命令", "Fixed command")}: {String(preview.target.executable)} {JSON.stringify(preview.target.args)}</p>
        <p>{text("工作目录", "Working directory")}: {String(preview.target.cwd)} · {text("超时", "Timeout")}: {String(preview.target.timeoutMs)} ms · {text("目的", "Purpose")}: {String(preview.target.workPurpose)}</p>
        <p>{text("准备与工作依据", "Preparation and QA basis")}: {JSON.stringify(preview.target.qaBasis ?? null)}</p>
      </div>}
      <label>{text("触发事实", "Trigger fact")}<select aria-label="Completion hook fact" value={factKey} onChange={(event) => { setFactKey(event.target.value); setConfirmedIdentity(null); }}>
        <option value="">{text("等待后续原完成事实", "Wait for a later original completion fact")}</option>{facts.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
      </select></label>
      <label className="flex items-start gap-2"><input aria-label="Confirm completion hook" type="checkbox" checked={confirmed} disabled={!ready} onChange={(event) => setConfirmedIdentity(event.target.checked ? reviewIdentity : null)} />{text("确认确切来源、固定目标和事实选择；宿主可在事实成立后消费，不在此手动启动。", "Confirm the exact source, fixed target and fact choice. The host may consume the trigger; this does not manually start it.")}</label>
      <button type="button" className="wb-button" disabled={!ready || !confirmed} onClick={() => void send({ action: "arm", body: { sourceTaskSlug: source.slug, sourceSpecId: source.id, targetRunId: target!.id, targetPackageId: target!.packageId, idempotencyKey: newKey(), confirmTrigger: true, ...(selectedFact ? { fact: selectedFact } : {}) } })}><Check size={14} />{text("保存人工完成触发", "Arm human completion trigger")}</button>
    </fieldset>
    <div aria-label="Completion hook records" className="space-y-1"><h4>{text("原hook记录", "Original hook records")}</h4>
      <button type="button" className="wb-button" disabled={busy || !!foreignRecovery || !!recovery.error} onClick={() => void inspectSource()}><RefreshCw size={14} />{text("读取原来源hook列表", "Read original source hooks")}</button>
      {hookList === null && <p role="status">{text("原hook列表未返回；先读取来源，不能推断没有hook。", "Original hook list unavailable; read the source rather than assuming no hook exists.")}</p>}
      {hookList?.map((item) => <button key={item.id} type="button" className="wb-button block" disabled={busy || !!pending || !!foreignRecovery || !!recovery.error} onClick={() => void inspectHook(item.id)}>{item.id} · {item.targetRunId} · {item.state}</button>)}
      {selectedHook && <div aria-label="Completion hook detail" className="space-y-1 break-all border-t py-2">
        <p>{selectedHook.id} · {selectedHook.state} · {selectedHook.sourceSpecId} → {selectedHook.targetRunId} / {selectedHook.targetPackageId}</p>
        <p>{text("配置人/宿主消费者", "Configurator / host consumer")}: {selectedHook.configuredByUserId} / {selectedHook.hostConsumerUserId}</p>
        <p>{text("原请求事实", "Original requested fact")}: {selectedHook.requestedFact ? `${selectedHook.requestedFact.kind} / ${selectedHook.requestedFact.id}` : text("等待后续", "waiting for later fact")} · {text("已记录触发事实", "Recorded trigger fact")}: {selectedHook.fact ? `${selectedHook.fact.kind} / ${selectedHook.fact.id}` : text("未触发", "not triggered")}</p>
        <p>{text("准入", "Admission")}: {selectedHook.programAdmissionId ?? text("无", "none")} · {text("取消", "Cancelled")}: {selectedHook.cancelledAt ?? text("否", "no")}</p>
        {selectedHook.dispatchStatus && <p>{text("宿主结果", "Host result")}: {selectedHook.dispatchStatus} · {selectedHook.dispatchDetail ?? ""}</p>}
        {canCancel && <div className="space-y-1"><label>{text("取消未准入hook的原因", "Reason to cancel unadmitted hook")}<textarea aria-label="Completion hook cancel reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
          <label className="flex items-start gap-2"><input aria-label="Confirm completion hook cancellation" type="checkbox" checked={cancelConfirmed} onChange={(event) => setCancelConfirmed(event.target.checked)} />{text("仅取消尚未准入的hook，不停止已运行程序", "Cancel only an unadmitted hook; this does not stop an already running program")}</label>
          <button type="button" className="wb-button" disabled={locked || !cancelConfirmed || !cancelReason.trim()} onClick={() => void send({ action: "cancel", body: { hookId: selectedHook.id, reason: cancelReason.trim() }, fixed: fixedHook(selectedHook) })}><Square size={14} />{text("取消未准入hook", "Cancel unadmitted hook")}</button>
          {cancelConfirmed && <button type="button" className="wb-button" onClick={() => setCancelConfirmed(false)}>{text("取消确认", "Cancel confirmation")}</button>}
        </div>}
        {canRetry && <button type="button" className="wb-button" disabled={locked} onClick={() => void send({ action: "retry", body: { hookId: selectedHook.id }, fixed: fixedHook(selectedHook) })}><RefreshCw size={14} />{text("重核原hook就绪（不重启）", "Retry original hook readiness (no restart)")}</button>}
      </div>}
    </div>
    {pending && <p role="status">{text("原请求冻结，先读取来源hook列表及原hook核对", "Original request frozen; read source hooks and the original hook before retry")}: {pending.action}</p>}
    {pending && retryReady && !conflict && <button type="button" className="wb-button" disabled={busy} onClick={() => void send(pending)}>{text("明确重试原请求", "Explicitly retry original request")}</button>}
    {conflict && <p role="alert">{text("原hook身份冲突，未视为配置成功。", "Original hook identity conflicts; no configuration success was claimed.")}</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
