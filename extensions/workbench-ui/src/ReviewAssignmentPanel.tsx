import { useEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardCheck, FileSearch, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { CurrentView, ReviewAuthor, ReviewKind, ReviewSource, ReviewStatus, SourceReviewResult, WorkbenchRequest } from "./workbenchModel";
import { ReviewSourceFields } from "./ReviewSourceFields";

export function ReviewAssignmentPanel({ project, slug, runs, language, request, onChanged, onOpenNode }: {
  project: string; slug: string; runs: CurrentView["runs"];
  language: "zh" | "en"; request: WorkbenchRequest; onChanged: () => void;
  onOpenNode?: (slug: string) => void;
}) {
  const text = (zh: string, en: string) => language === "zh" ? zh : en;
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [kind, setKind] = useState<ReviewKind>("requirements");
  const [sources, setSources] = useState<ReviewSource[]>([{ kind: "specgraph", specSlug: slug, field: "", changeId: "" }]);
  const [authorKind, setAuthorKind] = useState<"" | ReviewAuthor["kind"]>("");
  const [authorId, setAuthorId] = useState("");
  const [completeAuthoring, setCompleteAuthoring] = useState(false);
  const [completion, setCompletion] = useState<(NonNullable<SourceReviewResult["authoringCompletion"]> & { requestId: string }) | null>(null);
  const [requirementIds, setRequirementIds] = useState<string[]>([]);
  const [otherRequirementIds, setOtherRequirementIds] = useState("");
  const [reviewerRunId, setReviewerRunId] = useState("");
  const [maxReviewRounds, setMaxReviewRounds] = useState("3");
  const [verdict, setVerdict] = useState<"accepted" | "rejected">("rejected");
  const [basis, setBasis] = useState("");
  const [sourceRecord, setSourceRecord] = useState<{ id: string; record: unknown } | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [revision, setRevision] = useState(0);
  const inFlight = useRef(false);
  const endpoint = `/workbench-api/loop/specs/${encodeURIComponent(slug)}`;
  const state = status?.reviews.find((review) => review.kind === kind);
  const reviewRequest = state?.request;
  const writer = authorKind === "agent" ? runs.find((run) => run.id === authorId) : undefined;
  const canMapCompletion = writer?.workPurpose === kind;
  const completionRunId = completeAuthoring && canMapCompletion ? writer.id : undefined;
  const completionRun = runs.find((run) => run.id === reviewRequest?.completionRunId);
  const completionReceipt = completion?.requestId === reviewRequest?.id ? completion : null;
  const authoringCompleted = completionRun?.state === "completed" || completionReceipt?.status === "completed";
  const canRetryCompletion = !!completionRun && !!reviewRequest?.completionRunId && reviewRequest.decisions.at(-1)?.verdict === "accepted" && !authoringCompleted;
  const authorReady = authorKind === "human" ? !!authorId.trim() : !!writer?.environmentId && !!writer.threadRef;
  const eligibleRuns = runs.filter((run) => authorReady && run.state === "bound" && run.environmentId && run.threadRef &&
    (!writer || (run.id !== writer.id && (run.environmentId !== writer.environmentId || run.threadRef !== writer.threadRef))));
  const rounds = Number(maxReviewRounds);
  const requirementDecisions = status?.reviews.find((review) => review.kind === "requirements")?.request?.decisions ?? [];
  const approvedRequirements = requirementDecisions.slice(requirementDecisions.findLastIndex((decision) => decision.verdict === "rejected") + 1)
    .filter((decision) => decision.verdict === "accepted");
  const requirementDecisionIds = kind === "design" ? [...new Set([
    ...requirementIds.filter((id) => approvedRequirements.some((decision) => decision.id === id)),
    ...otherRequirementIds.split(/[\s,]+/).filter(Boolean),
  ])] : [];
  const sourcesReady = sources.length > 0 && sources.every((source) => source.kind === "specgraph"
    ? !!source.specSlug.trim() && !!source.field.trim() && !!source.changeId.trim()
    : !!source.environmentId.trim() && !!source.repositoryRoot.trim() && !!source.commitSha.trim() && !!source.path.trim());
  const canAssign = !!status && !uncertain && authorReady && sourcesReady && eligibleRuns.some((run) => run.id === reviewerRunId) &&
    Number.isSafeInteger(rounds) && rounds >= 1 && (kind !== "design" || requirementDecisionIds.length > 0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus(null); setError("");
    void request(`${endpoint}/review-status`, { headers: { "X-Specgraph-Project": project }, signal: controller.signal })
      .then(async (response) => {
        if (controller.signal.aborted) return;
        if (response.status === 401) { setNeedsLogin(true); return; }
        if (!response.ok) throw new Error(text("无法读取审核状态：", "Cannot read review status: ") + response.status);
        const result = await response.json() as ReviewStatus;
        if (controller.signal.aborted) return;
        if (result.taskSlug !== slug || !Array.isArray(result.reviews)) throw new Error("Invalid review status");
        setStatus(result); setNeedsLogin(false); setUncertain(false);
      }).catch((cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [endpoint, project, slug, request, revision]);

  useEffect(() => {
    setMaxReviewRounds(String(state?.maxReviewRounds ?? 3));
    setBasis(""); setVerdict("rejected");
  }, [kind, state?.maxReviewRounds, reviewRequest?.id]);

  async function login(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request("/workbench-api/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      if (!response.ok) throw new Error(text("登录失败：", "Sign-in failed: ") + response.status);
      setRevision((value) => value + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setKey(""); setBusy(false); inFlight.current = false; }
  }

  async function readSource(source: Extract<ReviewSource, { kind: "specgraph" }>, draftIndex?: number) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setSourceRecord(null);
    const current = draftIndex !== undefined;
    try {
      const response = await request(`/workbench-api/knowledge/${current ? "spec" : "change"}/${encodeURIComponent(current ? source.specSlug : source.changeId)}`, { headers: { "X-Specgraph-Project": project } });
      if (response.status === 401) { setStatus(null); setNeedsLogin(true); return; }
      if (!response.ok) throw new Error(text("原文读取失败：", "Source read failed: ") + response.status);
      const body = await response.json();
      if (body.kind !== (current ? "spec" : "change") || body.slug !== source.specSlug) throw new Error("Invalid source response");
      if (current) {
        const changeId = body.sourceRefs?.[source.field];
        if (typeof changeId !== "string" || !changeId) throw new Error(text("该字段没有已记录的来源变更 ID", "No recorded source change ID for this field"));
        setSources((rows) => rows.map((row, i) => i === draftIndex ? { ...source, changeId } : row));
      } else {
        if (body.id !== source.changeId || !("record" in body)) throw new Error("Invalid original change response");
        setSourceRecord({ id: body.id, record: body.record });
      }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !canAssign || !authorKind) return;
    inFlight.current = true; setBusy(true); setError("");
    const authorResponsibility: ReviewAuthor = authorKind === "agent" ? { kind: "agent", runId: authorId } : { kind: "human", userId: authorId.trim() };
    try {
      const response = await request(`${endpoint}/assign-review`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify({ kind, sources, authorResponsibility, requirementDecisionIds, reviewerRunId, maxReviewRounds: rounds, ...(completionRunId ? { completionRunId } : {}) }) });
      if (!response.ok) {
        if (response.status === 401) { setStatus(null); setNeedsLogin(true); }
        if (response.status >= 500) setUncertain(true);
        const result = await response.json();
        setError(result.error || text("分配失败：", "Assignment failed: ") + response.status);
        return;
      }
      const result = await response.json() as ReviewStatus;
      const assigned = result.reviews.find((review) => review.kind === kind)?.request;
      if (result.taskSlug !== slug || assigned?.kind !== kind || assigned.reviewerRunId !== reviewerRunId || assigned.completionRunId !== (completionRunId ?? null)) throw new Error("Invalid review assignment receipt");
      setStatus(result); setReviewerRunId(""); onChanged();
    } catch (cause) { setUncertain(true); setError(text("分配结果未确认，请刷新：", "Assignment unconfirmed; refresh: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function decide(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !reviewRequest || uncertain || !basis.trim()) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request(`${endpoint}/review-source`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project },
        body: JSON.stringify({ requestId: reviewRequest.id, verdict, basis: basis.trim() }) });
      if (!response.ok) {
        if (response.status === 401) { setStatus(null); setNeedsLogin(true); }
        if (response.status >= 500) setUncertain(true);
        const result = await response.json();
        setError(result.error || text("判定未保存：", "Decision not saved: ") + response.status);
        return;
      }
      const result = await response.json() as SourceReviewResult;
      if (result.recorded !== true || result.decision.requestId !== reviewRequest.id || result.decision.verdict !== verdict || result.status.taskSlug !== slug) throw new Error("Invalid source review receipt");
      setStatus(result.status); setBasis(""); setCompletion(null);
      if (result.authoringCompletion) {
        if (result.authoringCompletion.runId !== reviewRequest.completionRunId || (completionRun && result.authoringCompletion.taskSlug !== completionRun.taskSlug)) {
          setUncertain(true); setError(text("审核判定已保存，但编写节点完成回执未确认，请刷新。", "Review decision recorded, but authoring completion receipt is unconfirmed; refresh."));
        } else setCompletion({ ...result.authoringCompletion, requestId: reviewRequest.id });
      }
      onChanged();
    } catch (cause) { setUncertain(true); setError(text("判定结果未确认，请刷新：", "Decision unconfirmed; refresh: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  async function retryCompletion() {
    if (inFlight.current || uncertain || !canRetryCompletion || !completionRun || !reviewRequest) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await request(`/workbench-api/loop/runs/${encodeURIComponent(completionRun.id)}/complete`, { method: "POST",
        headers: { "Content-Type": "application/json", "X-Specgraph-Project": project }, body: JSON.stringify({}) });
      if (!response.ok) {
        if (response.status === 401) { setStatus(null); setNeedsLogin(true); }
        if (response.status >= 500) setUncertain(true);
        const result = await response.json();
        setError(text("批准保留；编写节点未确认完成：", "Approval retained; authoring node completion unconfirmed: ") + (result.error || response.status));
        return;
      }
      const result = await response.json() as { completed: string };
      if (result.completed !== completionRun.taskSlug) throw new Error("Authoring completion target mismatch");
      setCompletion({ requestId: reviewRequest.id, runId: completionRun.id, taskSlug: completionRun.taskSlug, status: "completed" });
      onChanged();
    } catch (cause) { setUncertain(true); setError(text("批准保留；编写节点完成结果未确认，请刷新：", "Approval retained; authoring completion unconfirmed; refresh: ") + String(cause)); }
    finally { setBusy(false); inFlight.current = false; }
  }

  return <section aria-label={text("需求与设计审核", "Requirements and design review")} className="wb-panel space-y-2">
    <h3>{text("需求与设计审核", "Requirements and design review")}</h3>
    {needsLogin && <form onSubmit={(event) => void login(event)}>
      <label>{text("SpecGraph 操作凭据", "SpecGraph operator credential")}<input type="password" autoComplete="off" required value={key} disabled={busy} onChange={(event) => setKey(event.target.value)} /></label>
      <button className="wb-button" type="submit" disabled={busy}>{text("登录", "Sign in")}</button>
    </form>}
    {status && <>
      <label>{text("审核对象", "Review kind")}<select aria-label="Review kind" value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as ReviewKind); setCompleteAuthoring(false); }}>
        <option value="requirements">{text("需求", "Requirements")}</option><option value="design">{text("设计", "Design")}</option>
      </select></label>
      {state && <>
        <p>{text("Agent 退回轮数", "Agent rejection rounds")}: {state.agentRejections} / {state.maxReviewRounds}</p>
        <p>{text("人工介入状态", "Human hold")}: {state.humanHold ? text("待人工处理", "Awaiting human intervention") : text("未挂起", "Not held")}</p>
        <p>{text("负责人", "Responsible human")}: {state.responsibleUserId ?? text("未指定", "Not assigned")}</p>
      </>}
      {reviewRequest ? <div className="space-y-2">
        <dl>
          <dt>{text("审核请求", "Review request")}</dt><dd>{reviewRequest.id}</dd>
          <dt>{text("作者责任声明", "Declared author responsibility")}</dt><dd>{reviewRequest.authorResponsibility.kind}: {reviewRequest.authorResponsibility.kind === "agent" ? reviewRequest.authorResponsibility.runId : reviewRequest.authorResponsibility.userId}</dd>
          <dt>{text("声明者", "Declared by")}</dt><dd>{reviewRequest.createdBy}</dd>
          <dt>{text("审核执行", "Reviewer run")}</dt><dd>{reviewRequest.reviewerRunId}</dd>
          <dt>{text("请求状态", "Request status")}</dt><dd>{reviewRequest.decidedAt ? `${text("已判定", "Decided")}: ${reviewRequest.decidedAt}` : text("待判定", "Pending")}</dd>
          <dt>{text("需求批准决定", "Requirement approval decisions")}</dt><dd>{reviewRequest.requirementDecisionIds.join(", ") || text("无", "None")}</dd>
          <dt>{text("编写完成目标", "Authoring completion target")}</dt><dd>{reviewRequest.completionRunId ?? text("无，仅记录审核事实", "None; review facts only")}
            {completionRun && <> · {onOpenNode ? <button type="button" className="underline" onClick={() => onOpenNode(completionRun.taskSlug)}>{completionRun.taskSlug}</button> : completionRun.taskSlug}</>}
          </dd>
        </dl>
        {reviewRequest.completionRunId && <div aria-label="Authoring completion">
          {authoringCompleted ? <p role="status">{text("编写节点已完成。", "Authoring node completed.")}</p>
            : completionReceipt?.status === "failed" ? <p role="alert">{text("批准已保留；编写节点未完成：", "Approval retained; authoring node not completed: ")}{completionReceipt.message}</p>
            : <p>{reviewRequest.decisions.at(-1)?.verdict === "accepted" ? text("已批准；编写节点完成尚未确认。", "Approved; authoring node completion not yet confirmed.") : text("编写节点待审核。", "Authoring node awaiting review.")}</p>}
          {canRetryCompletion && <button type="button" className="wb-button" disabled={busy || uncertain} onClick={() => void retryCompletion()}><RefreshCw size={14} />{text("重试完成编写节点", "Retry authoring completion")}</button>}
        </div>}
        <ul aria-label={text("审核来源", "Review sources")}>
          {reviewRequest.sources.map((source, index) => <li key={index}>{source.kind === "specgraph"
            ? `SpecGraph: ${source.specSlug} / ${source.field} / ${source.changeId}`
            : `Git: ${source.environmentId} / ${source.repositoryRoot} / ${source.commitSha} / ${source.path}${source.entry ? ` / ${source.entry}` : ""}`}
            {source.kind === "specgraph" && <button type="button" className="wb-button" disabled={busy} onClick={() => void readSource(source)}><FileSearch size={14} />{text("读取原始变更", "Read original change")}</button>}
          </li>)}
        </ul>
        <h4>{text("审核决定历史（非测试结果）", "Review decisions (not test results)")}</h4>
        <ul aria-label={text("审核决定历史", "Review decisions")}>
          {reviewRequest.decisions.map((decision) => <li key={decision.id} className="border-b py-2">
            <p>{decision.verdict === "accepted" ? text("已批准", "Approved") : text("已退回", "Rejected")} · {decision.id}</p>
            <p>{decision.actorKind}: {decision.actor} · {decision.createdAt}</p><p className="whitespace-pre-wrap">{decision.basis}</p>
          </li>)}
        </ul>
        <form aria-label="Human source decision" className="space-y-2" onSubmit={(event) => void decide(event)}>
          <label>{text("人工判定", "Human verdict")}<select aria-label="Human verdict" value={verdict} disabled={busy || uncertain} onChange={(event) => setVerdict(event.target.value as typeof verdict)}>
            <option value="rejected">{text("退回", "Reject")}</option><option value="accepted">{text("批准", "Approve")}</option>
          </select></label>
          <label>{text("审核依据", "Review basis")}<textarea aria-label="Review basis" required maxLength={4000} value={basis} disabled={busy || uncertain} onChange={(event) => setBasis(event.target.value)} /></label>
          <button className="wb-button" type="submit" disabled={busy || uncertain || !basis.trim()}><ClipboardCheck size={14} />{text("记录人工判定", "Record human decision")}</button>
        </form>
      </div> : <p>{text("尚未分配审核", "No review assigned")}</p>}
      <form aria-label="Assign source review" className="space-y-2" onSubmit={(event) => void assign(event)}>
        <fieldset disabled={busy || uncertain} className="min-w-0 space-y-2">
          <legend>{text("待审来源", "Sources to review")}</legend>
          {sources.map((source, index) => <div key={index} className="space-y-1 border-b py-2">
            <ReviewSourceFields source={source} slug={slug} labelPrefix={`Source ${index + 1}`} language={language}
              onChange={(value) => setSources(sources.map((row, i) => i === index ? value : row))} />
            {source.kind === "specgraph" && <>
              <button type="button" className="wb-button" disabled={!source.specSlug.trim() || !source.field.trim()} onClick={() => void readSource(source, index)}><RefreshCw size={14} />{text("采用当前已记录来源", "Use recorded current source")}</button>
              <button type="button" className="wb-button" disabled={!source.changeId.trim()} onClick={() => void readSource(source)}><FileSearch size={14} />{text("读取原始变更", "Read original change")}</button>
            </>}
            <button type="button" className="wb-button" aria-label={`${text("删除来源", "Remove source")} ${index + 1}`} title={text("删除来源", "Remove source")} onClick={() => setSources(sources.filter((_, i) => i !== index))}><Trash2 size={14} /></button>
          </div>)}
          <button type="button" className="wb-button" aria-label={text("添加来源", "Add source")} title={text("添加来源", "Add source")} onClick={() => setSources([...sources, { kind: "specgraph", specSlug: slug, field: "", changeId: "" }])}><Plus size={14} /></button>
          <label>{text("作者责任声明", "Declared author responsibility")}<select aria-label="Author kind" value={authorKind} onChange={(event) => { setAuthorKind(event.target.value as typeof authorKind); setAuthorId(""); setReviewerRunId(""); setCompleteAuthoring(false); }}>
            <option value="">{text("选择责任主体", "Select responsible author")}</option><option value="agent">Agent</option><option value="human">{text("人类账号", "Human account")}</option>
          </select></label>
          {authorKind === "agent" && <label>{text("作者执行（含历史）", "Author run (including historical)")}<select aria-label="Author run" value={authorId} onChange={(event) => { setAuthorId(event.target.value); setReviewerRunId(""); setCompleteAuthoring(false); }}>
            <option value="">{text("选择作者执行", "Select author run")}</option>{runs.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.environmentId} / {run.threadRef} · {run.state}</option>)}
          </select></label>}
          {canMapCompletion && <label className="block"><input aria-label="Complete authoring node after approval" type="checkbox" checked={completeAuthoring} onChange={(event) => setCompleteAuthoring(event.target.checked)} />{text("审核通过后完成该编写节点", "Complete authoring node after approval")} · {writer.taskSlug}
            <span className="block">{text("整组来源声明为该次编写的完整提交成果", "Declare all sources as the complete submitted output of this authoring run")}</span>
          </label>}
          {authorKind === "human" && <label>{text("作者账号 ID", "Author account ID")}<input aria-label="Author account ID" required maxLength={200} value={authorId} onChange={(event) => { setAuthorId(event.target.value); setReviewerRunId(""); }} /></label>}
          {kind === "design" && <fieldset className="min-w-0">
            <legend>{text("适用需求批准决定", "Applicable requirement approval decisions")}</legend>
            {approvedRequirements.map((decision) => <label key={decision.id} className="block"><input type="checkbox" checked={requirementIds.includes(decision.id)} onChange={(event) => setRequirementIds(event.target.checked ? [...requirementIds, decision.id] : requirementIds.filter((id) => id !== decision.id))} />{decision.id} · {decision.basis}</label>)}
            <label>{text("其他节点批准 ID（逗号分隔）", "Other node approval IDs (comma-separated)")}<input aria-label="Other requirement approval IDs" maxLength={4000} value={otherRequirementIds} onChange={(event) => setOtherRequirementIds(event.target.value)} /></label>
          </fieldset>}
          <label>{text("审核执行", "Reviewer run")}<select aria-label="Reviewer run" value={reviewerRunId} onChange={(event) => setReviewerRunId(event.target.value)}>
            <option value="">{text("选择独立执行", "Select independent run")}</option>
            {eligibleRuns.map((run) => <option key={run.id} value={run.id}>{run.id} · {run.taskSlug} · {run.assignmentRole ?? text("未记录角色", "Role not recorded")} · {run.environmentId} / {run.threadRef}</option>)}
          </select></label>
          <label>{text("最多退回轮数", "Maximum rejection rounds")}<input aria-label="Maximum rejection rounds" type="number" min={1} step={1} required value={maxReviewRounds} onChange={(event) => setMaxReviewRounds(event.target.value)} /></label>
          <button className="wb-button" type="submit" disabled={busy || !canAssign}><ClipboardCheck size={14} />{text("分配审核", "Assign review")}</button>
        </fieldset>
      </form>
    </>}
    {sourceRecord && <section aria-label={text("原始来源记录", "Original source record")}>
      <h4>{sourceRecord.id}</h4><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(sourceRecord.record, null, 2)}</pre>
    </section>}
    {error && <p role="alert">{error}</p>}
    <button className="wb-button" type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}><RefreshCw size={14} />{text("刷新审核状态", "Refresh review status")}</button>
  </section>;
}
