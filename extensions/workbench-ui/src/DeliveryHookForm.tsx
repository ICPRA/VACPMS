import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, RefreshCw } from "lucide-react";
import { validateDeliveryHookReceipt, type CurrentView, type DeliveryTestHook, type WorkbenchRequest } from "./workbenchModel";

export function DeliveryHookForm({ operation, hook, data, language, request, onChanged, onClose }: {
  operation: "arm" | "cancel" | "retry"; hook?: DeliveryTestHook;
  data: Pick<CurrentView, "project" | "runs" | "deliveries">; language: "zh" | "en";
  request: WorkbenchRequest; onChanged: () => void; onClose: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [deliveryId, setDeliveryId] = useState("");
  const [reason, setReason] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState("");
  const [completed, setCompleted] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ body: Record<string, string>; sourceTaskSlug?: string; targetTaskSlug?: string; targetPackageId?: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, []);
  const sources = data.runs.filter((run) => run.executorKind !== "program" && run.workPurpose === "implementation");
  const targets = data.runs.filter((run) => run.executorKind !== "program" && run.state === "prepared" && run.workPurpose === "test_execution" &&
    run.gitBaseline?.isRepo === true && typeof run.gitBaseline.commitSha === "string" && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(run.gitBaseline.commitSha));
  const source = sources.find((run) => run.id === sourceId);
  const target = targets.find((run) => run.id === targetId);
  const deliveries = data.deliveries.filter((delivery) => delivery.runBindingId === sourceId);
  const frozen = busy || uncertain || needsLogin;
  const valid = operation === "arm" ? !!source && !!target && (!deliveryId || deliveries.some((delivery) => delivery.id === deliveryId))
    : operation === "cancel" ? !!reason.trim() : true;
  const label = operation === "arm" ? text("启用测试触发", "Enable test trigger")
    : operation === "cancel" ? text("取消触发", "Cancel trigger") : text("恢复原派发", "Resume original dispatch");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || completed || (!attempt.current && !valid)) return;
    const controller = lifetime.current!;
    attempt.current ??= operation === "arm" ? {
      body: { sourceRunId: source!.id, targetRunId: target!.id, commitSha: target!.gitBaseline!.commitSha!,
        idempotencyKey: Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""), ...(deliveryId ? { deliveryId } : {}) },
      sourceTaskSlug: source!.taskSlug, targetTaskSlug: target!.taskSlug, targetPackageId: target!.packageId,
    } : { body: { hookId: hook!.id, ...(operation === "cancel" ? { reason: reason.trim() } : {}) } };
    const command = attempt.current;
    let sent = false;
    inFlight.current = true; setBusy(true); setError("");
    try {
      if (needsLogin) {
        const login = await request("/workbench-api/api/auth/login", { method: "POST", signal: controller.signal,
          headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
        controller.signal.throwIfAborted();
        if (!login.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + login.status);
        const identity = await login.json();
        controller.signal.throwIfAborted();
        if (typeof identity.identity?.subject !== "string") throw new Error("Invalid identity response");
        setNeedsLogin(false);
      }
      sent = true;
      const response = await request(`/workbench-api/wb/delivery-hooks/${operation}`, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": data.project }, body: JSON.stringify(command.body) });
      controller.signal.throwIfAborted();
      if (!response.ok) {
        if (response.status >= 500) throw new Error(`HTTP ${response.status}`);
        setUncertain(false);
        if (response.status === 401) { setNeedsLogin(true); return; }
        const result = await response.json(); controller.signal.throwIfAborted();
        attempt.current = null; setError(result.error || `HTTP ${response.status}`); return;
      }
      const result: unknown = await response.json();
      controller.signal.throwIfAborted();
      validateDeliveryHookReceipt(result, data.project);
      if (operation === "arm") {
        if (result.sourceRunId !== command.body.sourceRunId || result.targetRunId !== command.body.targetRunId || result.commitSha !== command.body.commitSha ||
          result.targetPackageId !== command.targetPackageId ||
          result.configuredByRunId !== null || (command.body.deliveryId && result.deliveryId !== command.body.deliveryId)) throw new Error("Invalid hook arm receipt");
      } else if (result.id !== hook!.id || result.sourceRunId !== hook!.sourceRunId || result.targetRunId !== hook!.targetRunId || result.commitSha !== hook!.commitSha ||
        result.targetPackageId !== hook!.targetPackageId || result.hostConsumerUserId !== hook!.hostConsumerUserId ||
        result.configuredByRunId !== hook!.configuredByRunId || result.configuredByUserId !== hook!.configuredByUserId ||
        (operation === "cancel" && (result.state !== "cancelled" || !result.cancelledAt || result.cancellationReason !== command.body.reason || result.cancelledByRunId !== null || !result.cancelledByUserId)) ||
        (operation === "retry" && (!result.retriedAt || result.retriedByRunId !== null || !result.retriedByUserId))) throw new Error("Invalid hook operation receipt");
      attempt.current = null; setUncertain(false); setCompleted(true); onChanged();
    } catch (cause) {
      if (!controller.signal.aborted) { setUncertain(sent); setError((sent ? text("结果尚未确认，重试保持同一请求：", "Outcome unconfirmed; retry preserves the same request: ") : "") + String(cause)); }
    } finally {
      if (!controller.signal.aborted) { setKey(""); setBusy(false); inFlight.current = false; }
    }
  }

  if (collapsed) return <div className="wb-mail-toolbar">
    <button type="button" className="wb-button" onClick={() => setCollapsed(false)}>{text("未确认的 hook 请求", "Unconfirmed hook request")}</button>
    <button type="button" className="wb-button" onClick={onChanged}><RefreshCw size={14} />{text("刷新记录", "Refresh records")}</button>
  </div>;
  return <form className="min-w-0 space-y-2 [overflow-wrap:anywhere]" aria-label={label} onSubmit={(event) => void submit(event)}>
    <strong>{label}</strong>
    {operation === "arm" && <>
      <label className="block">{text("实现运行", "Implementation run")}<select className="block w-full" aria-label={text("实现运行", "Implementation run")} value={sourceId} required disabled={frozen || completed} onChange={(event) => { setSourceId(event.target.value); setDeliveryId(""); }}>
        <option value="">{text("选择原实现运行", "Select the original implementation run")}</option>{sources.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.taskSlug}</option>)}
        {!source && attempt.current?.body.sourceRunId === sourceId && <option value={sourceId}>{sourceId} · {attempt.current.sourceTaskSlug}</option>}
      </select></label>
      <label className="block">{text("已准备的测试运行", "Prepared test run")}<select className="block w-full" aria-label={text("已准备的测试运行", "Prepared test run")} value={targetId} required disabled={frozen || completed} onChange={(event) => setTargetId(event.target.value)}>
        <option value="">{text("选择原测试准备", "Select the original test preparation")}</option>{targets.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.taskSlug}</option>)}
        {!target && attempt.current?.body.targetRunId === targetId && <option value={targetId}>{targetId} · {attempt.current.targetTaskSlug}</option>}
      </select></label>
      {!sources.length && <p role="status">{text("没有已登记的实现运行。", "No recorded implementation run is available.")}</p>}
      {!targets.length && <p role="status">{text("没有带固定 Git 提交的测试准备。", "No prepared test run with a recorded Git commit is available.")}</p>}
      {target && <p>{text("目标工作包", "Target package")}: {target.packageId}<br />{text("固定提交", "Fixed commit")}: <code className="break-all">{target.gitBaseline!.commitSha}</code></p>}
      {!target && attempt.current?.body.commitSha && <p>{text("目标工作包", "Target package")}: {attempt.current.targetPackageId}<br />{text("固定提交", "Fixed commit")}: <code className="break-all">{attempt.current.body.commitSha}</code></p>}
      <label className="block">{text("已有源交付", "Existing source delivery")}<select className="block w-full" aria-label={text("已有源交付", "Existing source delivery")} value={deliveryId} disabled={frozen || completed || !source} onChange={(event) => setDeliveryId(event.target.value)}>
        <option value="">{text("等待下一次匹配交付", "Wait for a matching delivery")}</option>{deliveries.map((delivery) => <option key={delivery.id} value={delivery.id}>{delivery.id} · {delivery.submittedAt}</option>)}
        {deliveryId && !deliveries.some((delivery) => delivery.id === deliveryId) && attempt.current?.body.deliveryId === deliveryId && <option value={deliveryId}>{deliveryId}</option>}
      </select></label>
    </>}
    {operation === "cancel" && <label className="block">{text("取消原因", "Cancellation reason")}<textarea className="block w-full" aria-label={text("取消原因", "Cancellation reason")} value={reason} required disabled={frozen || completed} onChange={(event) => setReason(event.target.value)} /></label>}
    {operation !== "arm" && <p>{hook!.id} · {hook!.targetRunId} · <code className="break-all">{hook!.commitSha}</code></p>}
    {needsLogin && <label className="block">{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" value={key} disabled={busy} required onChange={(event) => setKey(event.target.value)} /></label>}
    {error && <p role="alert">{error}</p>}
    {uncertain && <button type="button" className="wb-button" disabled={busy} onClick={onChanged}><RefreshCw size={14} />{text("刷新记录", "Refresh records")}</button>}
    {completed ? <p role="status">{text("已记录操作。", "Operation recorded.")}</p> : <button type="submit" className="wb-button" disabled={busy || (needsLogin && !key) || (!attempt.current && !valid)}><Check size={14} />{needsLogin ? text("登录并提交同一请求", "Sign in and submit same request") : uncertain ? text("重试同一请求", "Retry same request") : label}</button>}
    <button type="button" className="wb-button" disabled={busy} onClick={() => uncertain ? setCollapsed(true) : onClose()}>{uncertain ? text("收起", "Collapse") : text("关闭", "Close")}</button>
  </form>;
}
