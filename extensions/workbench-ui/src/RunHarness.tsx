import { useEffect, useRef, useState } from "react";
import type { RecordedRunContext } from "./runPrompt";
import type { WorkbenchRequest, WorkbenchRun } from "./workbenchModel";

export function RunHarness({ project, run, language, request }: {
  project: string; run: WorkbenchRun; language: "zh" | "en"; request?: WorkbenchRequest;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const identity = JSON.stringify([project, run.id, run.taskSlug, run.packageId]);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<RecordedRunContext | null>(null);
  const [loadedIdentity, setLoadedIdentity] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    setOpen(false); setContext(null); setLoadedIdentity(""); setBusy(false); setError("");
    return () => { pending.current?.abort(); };
  }, [identity]);

  async function inspect(expanded: boolean) {
    pending.current?.abort();
    setOpen(expanded); setContext(null); setLoadedIdentity(identity); setError(""); setBusy(false);
    if (!expanded || !request) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true);
    try {
      const response = await request(`/workbench-api/loop/runs/${encodeURIComponent(run.id)}/context`, {
        method: "GET", headers: { "X-Specgraph-Project": project }, cache: "no-store", signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (response.status === 401) throw new Error(text("请在现有工作台界面登录后重新展开。", "Sign in through the existing workbench UI, then reopen this record."));
      if (!response.ok) throw new Error(text("准备记录读取失败：", "Preparation record read failed: ") + response.status);
      const stored: RecordedRunContext = await response.json();
      controller.signal.throwIfAborted();
      if (!stored || typeof stored !== "object" || Array.isArray(stored) ||
        stored.runId !== run.id || stored.taskSlug !== run.taskSlug || stored.packageId !== run.packageId ||
        typeof stored.createdAt !== "string" || !stored.body || typeof stored.body !== "object" || Array.isArray(stored.body)) {
        throw new Error(text("准备记录格式或执行身份不匹配。", "Preparation record format or run identity mismatch."));
      }
      setContext(stored);
    } catch (cause) {
      if (!controller.signal.aborted) setError(String(cause));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const recorded = open && loadedIdentity === identity ? context : null;
  const body = recorded?.body as Record<string, unknown> | undefined;
  const target = body?.dispatch_target && typeof body.dispatch_target === "object" && !Array.isArray(body.dispatch_target)
    ? body.dispatch_target as Record<string, unknown> : undefined;
  const value = (saved: unknown) => saved === undefined || saved === null
    ? text("未记录", "Not recorded") : typeof saved === "string" ? saved : JSON.stringify(saved, null, 2);
  const fields: Array<[string, unknown]> = [
    [text("工作目的指引", "Purpose guidance"), target?.purposeGuidance],
    [text("派单职责指引", "Role guidance"), target?.roleGuidance],
    [text("检索指引", "Retrieval guidance"), target?.retrievalGuidance],
    [text("质量保障依据与来源", "QA basis and sources"), target?.qaBasis],
    [text("继承范围与来源", "Inherited scope and sources"), body?.scope_context],
  ];
  return <details key={identity} className="min-w-0 text-xs" onToggle={(event) => void inspect(event.currentTarget.open)}>
    <summary>{text("本次执行的准备记录", "Run preparation record")}</summary>
    {open && loadedIdentity === identity && <div className="min-w-0 space-y-2 py-2">
      <p>{text("这是保存的准备记录，不证明模型收到、遵循这些内容或规则被强制执行。", "This is the saved preparation record, not proof that the model received or followed it, or that rules were enforced.")}</p>
      {!request && <p role="status">{text("现有工作台读取通道不可用。", "The existing workbench read transport is unavailable.")}</p>}
      {busy && <p role="status">{text("正在读取准备记录…", "Loading preparation record...")}</p>}
      {error && <p role="alert">{error}</p>}
      {recorded && <>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 break-words [overflow-wrap:anywhere]">
          <dt>{text("执行 ID", "Run ID")}</dt><dd>{recorded.runId}</dd>
          <dt>{text("节点", "Task")}</dt><dd>{recorded.taskSlug}</dd>
          <dt>{text("上下文包 ID", "Context package ID")}</dt><dd>{recorded.packageId}</dd>
          <dt>{text("记录时间", "Recorded at")}</dt><dd>{recorded.createdAt}</dd>
          <dt>{text("派单准备时间", "Dispatch prepared at")}</dt><dd>{value(target?.createdAt)}</dd>
          <dt>{text("工作目录", "Workspace")}</dt><dd>{value(body?.workspace)}</dd>
          <dt>{text("工作目的", "Work purpose")}</dt><dd>{value(target?.workPurpose)}</dd>
          <dt>{text("派单职责", "Assignment role")}</dt><dd>{value(target?.assignmentRole)}</dd>
          <dt>{text("提示词格式版本", "Prompt format version")}</dt><dd>{value(target?.promptFormatVersion)}</dd>
        </dl>
        {fields.map(([label, saved]) => <div key={label}>
          <h4>{label}</h4>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value(saved)}</pre>
        </div>)}
        {!target && body?.dispatch_target !== undefined && <div>
          <h4>{text("原始派单目标记录", "Original dispatch target record")}</h4>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{value(body.dispatch_target)}</pre>
        </div>}
      </>}
    </div>}
  </details>;
}
