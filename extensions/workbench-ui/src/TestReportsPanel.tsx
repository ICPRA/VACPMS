import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, ClipboardCheck, RefreshCw } from "lucide-react";
import type { ReviewSource, TestReport, TestReports, WorkbenchRequest, WorkbenchRun } from "./workbenchModel";

type RunContext = {
  runId: string;
  body: { dispatch_target?: { workPurpose?: string; gitBaseline?: { isRepo: boolean; commitSha: string | null }; qaBasis?: { testPlanSources: ReviewSource[] } } };
};
type Delivery = { id: string; runBindingId: string; snapshot: { git?: { head?: { isRepo: boolean; commitSha: string | null } } } };

function sourceLabel(source: ReviewSource) {
  return source.kind === "specgraph" ? `SpecGraph: ${source.specSlug} / ${source.field} / ${source.changeId}`
    : `Git: ${source.environmentId} / ${source.repositoryRoot} / ${source.commitSha} / ${source.path}${source.entry ? ` / ${source.entry}` : ""}`;
}

export function TestReportsPanel({ project, deliveryId, runs, language, request, onChanged, onOpenNode, renderGitRange }: {
  project: string; deliveryId: string; runs: WorkbenchRun[]; language: "zh" | "en";
  request: WorkbenchRequest; onChanged: () => void; onOpenNode?: (slug: string) => void;
  renderGitRange?: (snapshot: unknown) => ReactNode;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [targetPlans, setTargetPlans] = useState<ReviewSource[]>([]);
  const [tester, setTester] = useState<RunContext | null>(null);
  const [mode, setMode] = useState<"" | "manual" | "run">("");
  const [testRunId, setTestRunId] = useState("");
  const [selectedPlans, setSelectedPlans] = useState<number[]>([]);
  const [status, setStatus] = useState<TestReport["status"] | "">("");
  const [command, setCommand] = useState("");
  const [exitCode, setExitCode] = useState("");
  const [summary, setSummary] = useState("");
  const [outputRefs, setOutputRefs] = useState("");
  const [reports, setReports] = useState<TestReports | null>(null);
  const [cursors, setCursors] = useState([""]);
  const [revision, setRevision] = useState(0);
  const [loadingTarget, setLoadingTarget] = useState(false);
  const [loadingTester, setLoadingTester] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [testerError, setTesterError] = useState("");
  const [listError, setListError] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [completedTask, setCompletedTask] = useState("");
  const [completionError, setCompletionError] = useState("");
  const [completionUncertain, setCompletionUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const inFlight = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const endpoint = `/workbench-api/loop/deliveries/${encodeURIComponent(deliveryId)}`;
  const cursor = cursors.at(-1)!;
  const commitSha = delivery?.snapshot.git?.head?.isRepo === true ? delivery.snapshot.git.head.commitSha : null;
  const authorRun = runs.find((run) => run.id === delivery?.runBindingId);
  const implementationRun = authorRun?.workPurpose === "implementation" ? authorRun : undefined;
  const taskCompleted = implementationRun?.state === "completed" || completedTask === implementationRun?.taskSlug;
  const eligibleRuns = runs.filter((run) => (run.id === delivery?.runBindingId && run.workPurpose === "implementation") ||
    (run.workPurpose === "test_execution" && run.gitBaseline?.isRepo === true && !!commitSha && run.gitBaseline.commitSha === commitSha));
  const testerTarget = tester?.body.dispatch_target;
  const testerReady = mode === "manual" || (mode === "run" && tester?.runId === testRunId && eligibleRuns.some((run) => run.id === testRunId) &&
    ((testerTarget?.workPurpose === "implementation" && testRunId === delivery?.runBindingId) ||
      (testerTarget?.workPurpose === "test_execution" && testerTarget.gitBaseline?.isRepo === true && testerTarget.gitBaseline.commitSha === commitSha)));
  const availablePlans = targetPlans.map((source, index) => ({ source, index })).filter(({ source }) => mode === "manual" || (testerReady && testerTarget?.qaBasis?.testPlanSources.some((assigned) =>
    source.kind === "specgraph" ? assigned.kind === "specgraph" && source.specSlug === assigned.specSlug && source.field === assigned.field && source.changeId === assigned.changeId
      : assigned.kind === "git" && source.environmentId === assigned.environmentId && source.repositoryRoot === assigned.repositoryRoot && source.commitSha === assigned.commitSha && source.path === assigned.path && (source.entry ?? "") === (assigned.entry ?? ""))));
  const planSources = availablePlans.filter(({ index }) => selectedPlans.includes(index)).map(({ source }) => source);
  const parsedExitCode = exitCode.trim() ? Number(exitCode) : null;
  const outputs = outputRefs.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const canSubmit = !!commitSha && testerReady && !!status && !!summary.trim() && planSources.length > 0 && !loadingTarget && !loadingTester && !loadingReports && !uncertain && !needsLogin &&
    (parsedExitCode === null || Number.isSafeInteger(parsedExitCode)) && (status !== "passed" || (!!command.trim() && outputs.length > 0 && (parsedExitCode === null || parsedExitCode === 0)));
  const statusLabel = (value: TestReport["status"]) => ({
    passed: text("测试通过", "Passed"), failed: text("测试失败", "Failed"), not_run: text("未运行", "Not run"), environment_blocked: text("环境阻断", "Environment blocked"),
  })[value];

  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => controller.abort();
  }, [project, deliveryId]);

  useEffect(() => {
    const controller = new AbortController();
    setDelivery(null); setTargetPlans([]); setSelectedPlans([]); setTargetError(""); setLoadingTarget(true);
    void (async () => {
      const response = await request(endpoint, { headers: { "X-Specgraph-Project": project }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.status === 401) { setNeedsLogin(true); return; }
      if (!response.ok) throw new Error(`Delivery read failed: ${response.status}`);
      const result = await response.json() as Delivery;
      if (controller.signal.aborted) return;
      if (result.id !== deliveryId || !result.runBindingId || !result.snapshot) throw new Error("Invalid delivery response");
      setDelivery(result);
      const contextResponse = await request(`/workbench-api/loop/runs/${encodeURIComponent(result.runBindingId)}/context`, { headers: { "X-Specgraph-Project": project }, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (contextResponse.status === 401) { setNeedsLogin(true); return; }
      if (!contextResponse.ok) throw new Error(`Delivery run context read failed: ${contextResponse.status}`);
      const context = await contextResponse.json() as RunContext;
      if (controller.signal.aborted) return;
      if (context.runId !== result.runBindingId || !context.body) throw new Error("Delivery run context mismatch");
      setTargetPlans(context.body.dispatch_target?.qaBasis?.testPlanSources ?? []);
    })().catch((cause) => { if (!controller.signal.aborted) setTargetError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingTarget(false); });
    return () => controller.abort();
  }, [endpoint, project, deliveryId, request, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setTester(null); setTesterError(""); setSelectedPlans([]); setLoadingTester(false);
    if (mode !== "run" || !testRunId) return () => controller.abort();
    setLoadingTester(true);
    void request(`/workbench-api/loop/runs/${encodeURIComponent(testRunId)}/context`, { headers: { "X-Specgraph-Project": project }, signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setNeedsLogin(true); return; }
        if (!response.ok) throw new Error(`Test run context read failed: ${response.status}`);
        const context = await response.json() as RunContext;
        if (controller.signal.aborted) return;
        if (context.runId !== testRunId || !context.body) throw new Error("Test run context mismatch");
        setTester(context);
      }).catch((cause) => { if (!controller.signal.aborted) setTesterError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingTester(false); });
    return () => controller.abort();
  }, [mode, testRunId, project, request, revision]);

  useEffect(() => {
    const controller = new AbortController();
    setReports(null); setListError(""); setLoadingReports(true);
    void request(`${endpoint}/tests${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { "X-Specgraph-Project": project }, signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setNeedsLogin(true); return; }
        if (!response.ok) throw new Error(`Test reports read failed: ${response.status}`);
        const result = await response.json() as TestReports;
        if (controller.signal.aborted) return;
        if (result.deliveryId !== deliveryId || !Array.isArray(result.reports) || typeof result.hasMore !== "boolean" || (result.hasMore && !result.nextCursor)) throw new Error("Invalid test reports response");
        setReports(result); setUncertain(false);
      }).catch((cause) => { if (!controller.signal.aborted) setListError(String(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingReports(false); });
    return () => controller.abort();
  }, [endpoint, deliveryId, project, request, cursor, revision]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }), signal: lifetime.current!.signal });
      if (lifetime.current!.signal.aborted) return;
      if (!response.ok) throw new Error(`Sign-in failed: ${response.status}`);
      setNeedsLogin(false); setRevision((value) => value + 1);
    } catch (cause) { if (!lifetime.current!.signal.aborted) setError(String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true; setBusy(true); setError(""); setSaved("");
    const signal = lifetime.current!.signal;
    try {
      const response = await request(`${endpoint}/tests`, { method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, signal,
        body: JSON.stringify({ deliveryId, ...(mode === "run" ? { testRunId } : {}), commitSha, planSources, status, command: command.trim(), exitCode: parsedExitCode, summary: summary.trim(), outputRefs: outputs }) });
      if (signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        if (response.status >= 500) setUncertain(true);
        const result = await response.json();
        setError(result.error || `Test report not saved: ${response.status}`); return;
      }
      const result = await response.json() as TestReport;
      if (signal.aborted) return;
      if (!result.id || result.deliveryId !== deliveryId || result.commitSha !== commitSha || result.status !== status || result.testRunId !== (mode === "run" ? testRunId : null)) throw new Error("Invalid test report receipt");
      setSaved(result.id); setStatus(""); setSummary(""); setCommand(""); setExitCode(""); setOutputRefs("");
      setCursors([""]); setRevision((value) => value + 1); onChanged();
    } catch (cause) { if (!signal.aborted) { setUncertain(true); setError(text("测试报告保存结果未确认，请刷新：", "Test report save unconfirmed; refresh: ") + String(cause)); } }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function completeTask() {
    if (inFlight.current || !implementationRun || taskCompleted || completionUncertain || needsLogin) return;
    inFlight.current = true; setBusy(true); setCompletionError("");
    const signal = lifetime.current!.signal;
    try {
      const response = await request(`/workbench-api/loop/runs/${encodeURIComponent(implementationRun.id)}/complete`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: "{}", signal,
      });
      if (signal.aborted) return;
      const result = await response.json();
      if (signal.aborted) return;
      if (!response.ok) {
        if (response.status === 401) setNeedsLogin(true);
        if (response.status >= 500) setCompletionUncertain(true);
        setCompletionError((response.status >= 500 ? text("任务完成结果未确认，测试报告保留：", "Task completion unconfirmed; test reports retained: ")
          : text("任务未完成，测试报告保留：", "Task not completed; test reports retained: ")) + (result.error || response.status));
        return;
      }
      if (result.completed !== implementationRun.taskSlug) throw new Error("Implementation completion target mismatch");
      setCompletedTask(result.completed); onChanged();
    } catch (cause) { if (!signal.aborted) { setCompletionUncertain(true); setCompletionError(text("任务完成结果未确认，测试报告保留；请刷新：", "Task completion unconfirmed; test reports retained; refresh: ") + String(cause)); } }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <section aria-label={text("测试报告", "Test reports")} className="wb-panel space-y-2">
    <h4>{text("测试报告", "Test reports")}</h4>
    {needsLogin && <form onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy}>{text("登录", "Sign in")}</button>
    </form>}
    <p>{text("固定交付提交", "Fixed delivery commit")}: {commitSha || text("未记录", "Not recorded")}</p>
    {delivery && renderGitRange?.(delivery.snapshot)}
    {implementationRun && <div aria-label="Implementation completion" className="space-y-1">
      <p>{text("代码实现任务", "Implementation task")}: {implementationRun.taskSlug}</p>
      {taskCompleted ? <p role="status">{text("代码实现任务已完成。", "Implementation task completed.")}</p>
        : <button type="button" className="wb-button" disabled={busy || needsLogin || completionUncertain} onClick={() => void completeTask()}><ClipboardCheck size={14} />{text("按测试结果完成任务", "Complete task based on test results")}</button>}
      {completionError && <p role="alert">{completionError}</p>}
    </div>}
    {loadingTarget && <p role="status">{text("读取交付及冻结测试计划", "Loading delivery and frozen test plans")}</p>}
    {targetError && <p role="alert">{targetError}</p>}
    {!loadingTarget && !targetError && !targetPlans.length && <p>{text("交付执行没有已记录的测试计划", "No recorded test plans for the delivery run")}</p>}
    <form aria-label="Record test report" className="space-y-2" onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy || uncertain || needsLogin || loadingTarget} className="min-w-0 space-y-2">
        <label className="block">{text("测试方式", "Testing mode")}<select className="w-full min-w-0" aria-label="Testing mode" value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); setTestRunId(""); setSelectedPlans([]); }}>
          <option value="">{text("选择测试方式", "Select testing mode")}</option><option value="manual">{text("人工测试（无模型执行）", "Manual testing (no model run)")}</option><option value="run">{text("已有执行", "Existing run")}</option>
        </select></label>
        {mode === "run" && <label className="block">{text("测试执行", "Test run")}<select className="w-full min-w-0" aria-label="Test run" value={testRunId} onChange={(event) => { setTestRunId(event.target.value); setSelectedPlans([]); }}>
          <option value="">{text("选择执行", "Select run")}</option>{eligibleRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.taskSlug} · {run.workPurpose}</option>)}
        </select></label>}
        {loadingTester && <p role="status">{text("读取测试执行依据", "Loading test run basis")}</p>}
        {testerError && <p role="alert">{testerError}</p>}
        {tester && !testerReady && <p role="alert">{text("测试执行的目的或固定提交与交付不符", "Test run purpose or fixed commit does not match the delivery")}</p>}
        <fieldset className="min-w-0 space-y-1"><legend>{text("本报告覆盖的计划", "Plans covered by this report")}</legend>
          {availablePlans.map(({ source, index }) => <label key={index} className="block"><input type="checkbox" aria-label={`Test plan ${index + 1}`} checked={selectedPlans.includes(index)} onChange={(event) => setSelectedPlans(event.target.checked ? [...selectedPlans, index] : selectedPlans.filter((value) => value !== index))} />{sourceLabel(source)}</label>)}
          {testerReady && !loadingTarget && !loadingTester && !availablePlans.length && <p>{text("没有与该交付对应的已指派计划", "No assigned plans match this delivery")}</p>}
        </fieldset>
        <label className="block">{text("测试结果", "Test result")}<select className="w-full min-w-0" aria-label="Test result" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="">{text("选择真实结果", "Select actual result")}</option>{(["passed", "failed", "not_run", "environment_blocked"] as const).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
        </select></label>
        <label className="block">{text("执行命令", "Command")}<input className="w-full min-w-0" aria-label="Test command" maxLength={4000} value={command} onChange={(event) => setCommand(event.target.value)} /></label>
        <label className="block">{text("退出码（未知留空）", "Exit code (blank if unknown)")}<input type="number" step={1} aria-label="Test exit code" value={exitCode} onChange={(event) => setExitCode(event.target.value)} /></label>
        <label className="block">{text("结果与覆盖说明", "Result and coverage summary")}<textarea className="w-full min-w-0" aria-label="Test summary" required maxLength={8000} value={summary} onChange={(event) => setSummary(event.target.value)} /></label>
        <label className="block">{text("原始输出引用（每行一项）", "Original output references (one per line)")}<textarea className="w-full min-w-0" aria-label="Test output references" maxLength={16000} value={outputRefs} onChange={(event) => setOutputRefs(event.target.value)} /></label>
        {status === "passed" && parsedExitCode !== null && parsedExitCode !== 0 && <p role="alert">{text("非零退出码不能登记为通过", "A nonzero exit code cannot be recorded as passed")}</p>}
        <button className="wb-button" type="submit" disabled={busy || !canSubmit}><ClipboardCheck size={14} />{text("记录测试报告", "Record test report")}</button>
      </fieldset>
    </form>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">{text("测试报告已记录", "Test report recorded")}: {saved}</p>}
    {loadingReports && <p role="status">{text("读取测试报告", "Loading test reports")}</p>}
    {listError && <p role="alert">{listError}</p>}
    {reports && <>
      {!reports.reports.length && <p>{text("暂无测试报告", "No test reports")}</p>}
      <ol aria-label="Test report history" className="space-y-2">
        {reports.reports.map((report) => {
          const run = runs.find((entry) => entry.id === report.testRunId);
          return <li key={report.id} className="border-t py-2 space-y-1">
            <p>{statusLabel(report.status)} · {report.id} · {report.createdAt}</p>
            <p>{text("受测提交", "Tested commit")}: {report.commitSha}</p>
            <p>{text("报告登记者", "Reporter")}: {report.reporter}</p>
            <p>{text("测试执行", "Test run")}: {report.testRunId ?? text("人工测试（无执行关联）", "Manual testing (no run association)")}
              {run && onOpenNode && <> · <button type="button" className="underline" onClick={() => onOpenNode(run.taskSlug)}>{run.taskSlug}</button></>}
            </p>
            <ul>{report.planSources.map((source, index) => <li key={index}>{sourceLabel(source)}</li>)}</ul>
            <p className="whitespace-pre-wrap font-mono text-xs">{report.command}</p>
            <p>{text("退出码", "Exit code")}: {report.exitCode === null ? text("未知", "Unknown") : report.exitCode}</p>
            <p className="whitespace-pre-wrap">{report.summary}</p>
            <ul>{report.outputRefs.map((reference, index) => <li key={index}>{reference}</li>)}</ul>
          </li>;
        })}
      </ol>
    </>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="wb-button" title={text("上一页", "Previous page")} aria-label="Previous test report page" disabled={busy || loadingReports || cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}><ArrowLeft size={14} /></button>
      <button type="button" className="wb-button" title={text("下一页", "Next page")} aria-label="Next test report page" disabled={busy || loadingReports || !reports?.hasMore} onClick={() => setCursors([...cursors, reports!.nextCursor!])}><ArrowRight size={14} /></button>
      <button type="button" className="wb-button" disabled={busy} onClick={() => { setCursors([""]); setRevision((value) => value + 1); setCompletionUncertain(false); onChanged(); }}><RefreshCw size={14} />{text("刷新测试报告", "Refresh test reports")}</button>
    </div>
  </section>;
}
