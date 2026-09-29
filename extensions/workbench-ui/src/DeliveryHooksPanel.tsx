import { useState } from "react";
import { ClipboardCheck, GitBranch, Plus, RefreshCw, X } from "lucide-react";
import { DeliveryHookForm } from "./DeliveryHookForm";
import type { CurrentView, DeliveryTestHook, WorkbenchRequest } from "./workbenchModel";

export function DeliveryHooksPanel({ hooks, available, selectedId, data, language, onOpenNode, onOpenDelivery, request, onChanged }: {
  hooks: DeliveryTestHook[] | undefined; available: boolean; selectedId?: string;
  data: Pick<CurrentView, "project" | "specs" | "runs" | "deliveries">; language: "zh" | "en";
  onOpenNode: (slug: string) => void; onOpenDelivery?: (id: string, task: string) => void;
  request?: WorkbenchRequest; onChanged?: () => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [action, setAction] = useState<{ operation: "arm" | "cancel" | "retry"; hook?: DeliveryTestHook } | null>(null);
  const states = {
    armed: text("等待交付", "Waiting for delivery"), pending: text("待派发", "Pending dispatch"),
    commandAccepted: text("命令已接收", "Command accepted"), blocked: text("被阻挡", "Blocked"),
    unconfirmed: text("结果未知", "Outcome unknown"), rejected: text("明确拒绝", "Rejected"), cancelled: text("已取消", "Cancelled"),
  };
  return <section className="wb-panel" aria-label={text("交付测试 hook", "Delivery test hooks")}>
    <h3>{text("交付测试 hook", "Delivery test hooks")}</h3>
    {!available || hooks === undefined ? <p>{text("Hook 数据不可用。", "Hook data unavailable.")}</p> : <>
      {request && onChanged && !action && <button type="button" className="wb-button" onClick={() => setAction({ operation: "arm" })}><Plus size={14} />{text("配置交付测试 hook", "Configure delivery test hook")}</button>}
      {request && onChanged && action && <DeliveryHookForm key={`${data.project}:${action.operation}:${action.hook?.id ?? "new"}`} operation={action.operation} {...(action.hook ? { hook: action.hook } : {})}
        data={data} language={language} request={request} onChanged={onChanged} onClose={() => setAction(null)} />}
      {!hooks.length && <p>{text("没有交付测试 hook。", "No delivery test hooks.")}</p>}
      {hooks.map((hook) => {
        const configuringRun = data.runs.find((run) => run.id === hook.configuredByRunId);
        return <details key={hook.id} open={selectedId === hook.id || hooks.length === 1}>
          <summary>{hook.id} · {states[hook.state]}</summary>
          {[[text("实现节点", "Implementation node"), hook.sourceTaskSlug, hook.sourceRunId], [text("测试节点", "Test node"), hook.targetTaskSlug, hook.targetRunId]].map(([label, slug, runId]) => <p key={label}>
            {label}: {slug} · {runId}
            {data.specs.some((spec) => spec.slug === slug) && <button type="button" className="wb-button" onClick={() => onOpenNode(slug!)}><GitBranch size={14} />{slug}</button>}
          </p>)}
          <p>{text("目标工作包", "Target package")}: {hook.targetPackageId}</p>
          <p>{text("固定提交", "Fixed commit")}: <code className="break-all">{hook.commitSha}</code></p>
          <p>{text("配置者", "Configured by")}: {hook.configuredByRunId === null && `${text("人工", "Human")}: `}{hook.configuredByUserId}{hook.configuredByRunId && ` · ${hook.configuredByRunId}`}
            {configuringRun && data.specs.some((spec) => spec.slug === configuringRun.taskSlug) && <button type="button" className="wb-button" onClick={() => onOpenNode(configuringRun.taskSlug)}><GitBranch size={14} />{configuringRun.taskSlug}</button>}
            {" · "}<time>{hook.createdAt}</time></p>
          <p>{text("宿主服务主体", "Host service")}: {hook.hostConsumerUserId}</p>
          {hook.deliveryId && <p>{text("触发交付", "Triggering delivery")}: {hook.deliveryId}
            {onOpenDelivery && data.deliveries.some((delivery) => delivery.id === hook.deliveryId && delivery.runBindingId === hook.sourceRunId) && data.runs.some((run) => run.id === hook.sourceRunId && run.taskSlug === hook.sourceTaskSlug) && <button type="button" className="wb-button" onClick={() => onOpenDelivery(hook.deliveryId!, hook.sourceTaskSlug)}><ClipboardCheck size={14} />{text("查看交付", "Open delivery")}</button>}
          </p>}
          {hook.triggeredAt && <p>{text("触发时间", "Triggered at")}: <time>{hook.triggeredAt}</time></p>}
          {hook.dispatchPhase && <p>{text("派发阶段", "Dispatch phase")}: {hook.dispatchPhase}</p>}
          {hook.dispatchDetail && <p className="whitespace-pre-wrap break-words">{hook.dispatchDetail}</p>}
          {hook.dispatchRecordedAt && <p>{text("结果记录时间", "Result recorded at")}: <time>{hook.dispatchRecordedAt}</time></p>}
          {hook.cancelledAt && <p>{text("取消者", "Cancelled by")}: {hook.cancelledByRunId === null && `${text("人工", "Human")}: `}{hook.cancelledByUserId}{hook.cancelledByRunId && ` · ${hook.cancelledByRunId}`} · <time>{hook.cancelledAt}</time></p>}
          {hook.cancellationReason && <p className="whitespace-pre-wrap break-words">{hook.cancellationReason}</p>}
          {hook.retriedAt && <p>{text("恢复操作者", "Retried by")}: {hook.retriedByRunId === null && `${text("人工", "Human")}: `}{hook.retriedByUserId}{hook.retriedByRunId && ` · ${hook.retriedByRunId}`} · <time>{hook.retriedAt}</time></p>}
          {request && onChanged && !action && <div className="wb-mail-toolbar">
            {hook.state !== "cancelled" && hook.state !== "commandAccepted" && <button type="button" className="wb-button" onClick={() => setAction({ operation: "cancel", hook })}><X size={14} />{text("取消触发", "Cancel trigger")}</button>}
            {(hook.state === "blocked" || hook.state === "unconfirmed") && <button type="button" className="wb-button" onClick={() => setAction({ operation: "retry", hook })}><RefreshCw size={14} />{text("恢复原派发", "Resume original dispatch")}</button>}
          </div>}
        </details>;
      })}
    </>}
  </section>;
}
