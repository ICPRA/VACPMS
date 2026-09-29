import { Fragment, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { PanelSeparator } from "./PanelSeparator";
import { NodeCompletion } from "./NodeCompletion";
import { NodeApproval } from "./NodeApproval";
import { NodeMarksPanel } from "./NodeMarksPanel";
import { NodeEventsPanel } from "./NodeEventsPanel";
import { AbandonNodePanel } from "./AbandonNodePanel";
import { DeliveryReview } from "./DeliveryReview";
import { TestReportsPanel } from "./TestReportsPanel";
import { ReviewAssignmentPanel } from "./ReviewAssignmentPanel";
import { KnowledgeSearch } from "./KnowledgeSearch";
import { ChangeImpactPreview } from "./ChangeImpactPreview";
import { DependencyEditor } from "./DependencyEditor";
import { SubdivisionPanel } from "./SubdivisionPanel";
import { CreateNodeForm } from "./CreateNodeForm";
import { MailWorkspace, type MailReader } from "./MailWorkspace";
import { DependencyGraph } from "./DependencyGraph";
import { DeliveryHooksPanel } from "./DeliveryHooksPanel";
import { CandidateLoopPanel } from "./CandidateLoopPanel";
import { SummaryPanel } from "./SummaryPanel";
import { CompletionHookPanel } from "./CompletionHookPanel";
import { NodeOwnershipPanel } from "./NodeOwnershipPanel";
import { MergePanel } from "./MergePanel";
import { dependencyNeighbors } from "./workbenchGraph";
import {
  ArrowRight,
  ClipboardCheck,
  GitBranch,
  LayoutDashboard,
  Columns3,
  Table2,
  ListTodo,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Terminal,
  X,
} from "lucide-react";
import {
  dependencyDirection,
  evidenceResult,
  latestAcceptance,
  taskRecords,
  specColumns,
  workProgress,
  validateDeliveryHooks,
  validateProjectBinding,
  type CurrentView,
  type ProjectBinding,
  type WorkbenchSearch,
  type WorkbenchRun,
  type CompletionHookSummary,
  type WorkbenchRequest,
} from "./workbenchModel";

type SpecDetail = {
  slug: string;
  spec: {
    id: string;
    slug: string;
    intent: string;
    stage: string;
    role?: "work" | "summary";
    priority: string;
    complexity?: string;
    version: number;
    createdAt: string;
    updatedAt: string;
    provenanceType?: string;
    contentHash?: string;
    notes?: string;
    shape?: {
      scope_in?: string[];
      scope_out?: string[];
    } | null;
    specify?: {
      verify_criteria?: Array<{ category: string; description: string }>;
      invariants?: string[];
      interfaces?: Array<{ name: string; body: string }>;
      touches?: Array<{ path: string; purpose: string; change_type: string }>;
    } | null;
  } | null;
  dependencies: Array<{ slug?: string; nodeId?: string; title?: string }>;
  impactedBy: Array<{ slug?: string; title?: string }>;
  changes: Array<{ version?: number; summary?: string; reason?: string; createdAt?: string }>;
  events: Array<{ id: string; agent?: string; type?: string; message?: string; createdAt: string }>;
  manualCompletions?: Array<{ id: string; actor: string; sourceVersion: number; resultVersion: number; note: string; createdAt: string }>;
  completionHooks?: CompletionHookSummary[];
  changeError?: string;
  eventError?: string;
};

const tabs = [
  { id: "overview", zh: "概览", en: "Overview", icon: LayoutDashboard },
  { id: "tasks", zh: "任务与依赖", en: "Tasks & dependencies", icon: GitBranch },
  { id: "sessions", zh: "执行会话", en: "Sessions", icon: Terminal },
  { id: "collaboration", zh: "协作", en: "Collaboration", icon: Mail },
  { id: "pending", zh: "待处理", en: "Pending", icon: ListTodo },
  { id: "acceptance", zh: "验收", en: "Acceptance", icon: ClipboardCheck },
  { id: "knowledge", zh: "资料", en: "Knowledge", icon: Search },
] as const;

export type PageProps = {
  readMail?: MailReader;
  requestOperation?: WorkbenchRequest;
  readData?: (request: { resource: "projects" | "current-view" | "spec"; project?: string; slug?: string }, signal: AbortSignal) => Promise<unknown>;
  search: WorkbenchSearch;
  onSearchChange: (search: WorkbenchSearch) => void;
  language: "zh" | "en";
  languageControl: ReactNode;
  renderSessions: (runs: WorkbenchRun[], selected: string | null, project: string, onChanged: () => void, selectedRunId?: string,
    nodeOwners?: Array<{ taskSlug: string; humanOwnerUserId: string | null; pendingOperationId: string | null }>) => ReactNode;
  renderRepositorySearch?: (query: string, specgraphProject: string, question: string) => ReactNode;
  renderDeliveryGit?: (run: WorkbenchRun, snapshot: unknown) => ReactNode;
  renderDispatch?: (input: { project: string; taskSlug: string; title: string; runs: readonly WorkbenchRun[]; ownerHold: boolean; binding: ProjectBinding | null | undefined; onChanged: () => void }) => ReactNode;
  renderTooltip: (label: string, trigger: ReactElement) => ReactNode;
};

async function readBrowserData(request: Parameters<NonNullable<PageProps["readData"]>>[0], signal: AbortSignal) {
  const path = request.resource === "spec" ? `specs/${encodeURIComponent(request.slug!)}` : request.resource;
  const response = await fetch(`/workbench-api/wb/${path}`, { signal, ...(request.project ? { headers: { "X-Specgraph-Project": request.project } } : {}) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export function Page({
  readMail,
  requestOperation,
  readData = readBrowserData,
  search,
  onSearchChange,
  language,
  languageControl,
  renderSessions,
  renderRepositorySearch,
  renderDeliveryGit,
  renderDispatch,
  renderTooltip,
}: PageProps) {
  const text = (zh: string, en: string) => (language === "zh" ? zh : en);
  const [projects, setProjects] = useState<Array<{ slug: string; managed: boolean }> | null>(null);
  const project = search.project ?? projects?.[0]?.slug ?? "";
  const projectExists = projects?.some((entry) => entry.slug === project) ?? false;
  const [projectError, setProjectError] = useState<string | null>(null);
  const [snapshot, setData] = useState<CurrentView | null>(null);
  const data = snapshot?.project === project && projectExists ? snapshot : null;
  const [requestError, setError] = useState<{ project: string; message: string } | null>(null);
  const error = projectExists && requestError?.project === project ? requestError.message : null;
  const [loadingProject, setLoading] = useState<string | null>(null);
  const loading = projectExists && loadingProject === project;
  const [refresh, setRefresh] = useState(0);
  const [createInProject, setCreateInProject] = useState<string | null>(null);
  const tab = search.tab ?? "overview";
  const selected = search.selected ?? null;
  const selectedRun = tab === "sessions" && search.runId ? data?.runs.find((run) => run.id === search.runId && run.taskSlug === selected) : undefined;
  const workspace = tab === "overview" || tab === "tasks";
  const [directoryWidth, setDirectoryWidth] = useState(224);
  const [inspectorWidth, setInspectorWidth] = useState(340);
  const layout =
    tab === "overview"
      ? search.layout === "table"
        ? "table"
        : "board"
      : (search.layout ?? "graph");
  const [taskFilter, setTaskFilter] = useState<{
    project: string;
    value: "all" | "ready" | "related";
  }>({ project: "", value: "all" });
  const filter =
    taskFilter.project === project && (taskFilter.value !== "related" || selected)
      ? taskFilter.value
      : "all";
  const [taskQuery, setTaskQuery] = useState({ project: "", value: "" });
  const query = taskQuery.project === project ? taskQuery.value : "";
  const [evidenceSelection, setEvidenceSelection] = useState<{
    project: string;
    task: string | null;
    delivery: string;
  } | null>(null);
  const [hookSelection, setHookSelection] = useState<{ project: string; id: string } | null>(null);
  const [detailState, setDetailState] = useState<{
    project: string;
    selected: string;
    snapshot: CurrentView;
    value: SpecDetail | null;
    error: string | null;
  } | null>(null);
  const scopedDetail =
    detailState?.project === project && detailState.selected === selected ? detailState : null;
  const detail = scopedDetail?.value ?? null;
  const detailError = scopedDetail?.error ?? null;
  const detailPending = !!data && scopedDetail?.snapshot !== data;

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const result = (await readData({ resource: "projects" }, controller.signal)) as {
          projects: Array<{ slug: string; managed: boolean }>;
        };
        if (controller.signal.aborted) return;
        setProjects(result.projects);
        setProjectError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setProjectError(String(cause));
      }
    })();
    return () => controller.abort();
  }, [refresh, readData]);

  useEffect(() => {
    if (!project || !projectExists) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let inFlight = false;
    const load = async () => {
      if (inFlight || controller.signal.aborted) return;
      clearTimeout(timer);
      if (document.hidden) return;
      inFlight = true;
      setLoading(project);
      try {
        const result = (await readData({ resource: "current-view", project }, controller.signal)) as CurrentView;
        if (result.project !== project) throw new Error("Project response mismatch");
        validateDeliveryHooks(result.deliveryHooks, project);
        validateProjectBinding(result.projectBinding, project);
        if (!controller.signal.aborted) {
          setData(result);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError({ project, message: String(cause) });
      } finally {
        inFlight = false;
        if (!controller.signal.aborted) {
          setLoading(null);
          timer = setTimeout(load, 15_000);
        }
      }
    };
    const visible = () => {
      if (!document.hidden) void load();
    };
    void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [project, projectExists, refresh, readData]);

  useEffect(() => {
    if (!data || !selected || !data.specs.some((spec) => spec.slug === selected)) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const result = (await readData({ resource: "spec", project, slug: selected }, controller.signal)) as SpecDetail;
        if (!controller.signal.aborted) {
          setDetailState({ project, selected, snapshot: data, value: result, error: null });
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setDetailState((previous) => ({
            project,
            selected,
            snapshot: data,
            value:
              previous?.project === project && previous.selected === selected
                ? previous.value
                : null,
            error: String(cause),
          }));
      }
    })();
    return () => controller.abort();
  }, [selected, project, data, readData]);

  const selectTask = (slug: string | null) => {
    if (slug === selected) return;
    onSearchChange({
      project,
      tab,
      layout: search.layout ?? "graph",
      ...(slug ? { selected: slug } : {}),
    });
  };
  const records = data ? taskRecords(data, selected) : null;
  const commandEvidence = records?.evidence.filter((entry) => !(requestOperation && data?.capabilities.testReports && entry.kind === "test_report")) ?? [];
  const unbound =
    data?.specs.filter((spec) => !data.runs.some((run) => run.taskSlug === spec.slug)) ?? [];
  const runById = new Map(data?.runs.map((run) => [run.id, run]) ?? []);
  const opinionPending = data?.deliveries.filter((delivery) =>
    !(data.capabilities.testReports && runById.get(delivery.runBindingId)?.workPurpose === "implementation") &&
    !latestAcceptance(data.acceptances, delivery.id)) ?? [];
  const undecided = opinionPending.filter((delivery) => !selected || runById.get(delivery.runBindingId)?.taskSlug === selected);
  // The backend supplies ascending submitted_at/id order, including sub-millisecond ties.
  const latestDeliveryByRun = new Map(data?.deliveries.map((delivery) => [delivery.runBindingId, delivery]) ?? []);
  const retiredTasks = new Set(data?.specs.filter((spec) => ["done", "abandoned", "superseded"].includes(spec.stage)).map((spec) => spec.slug) ?? []);
  const codeCompletionPending = data?.capabilities.testReports ? data.runs.flatMap((run) => {
    const delivery = latestDeliveryByRun.get(run.id);
    if (run.workPurpose !== "implementation" || ["completed", "preparation_cancelled", "handed_off"].includes(run.state) || retiredTasks.has(run.taskSlug) || !delivery) return [];
    return [{ run, delivery }];
  }) : [];
  const selectedCodePending = codeCompletionPending.filter(({ run }) => !selected || run.taskSlug === selected);
  const failures =
    commandEvidence.filter((entry) => evidenceResult(entry.exitCode) === "command-failed");
  const openDeliveryReview = (deliveryId: string, task = selected) => {
    setEvidenceSelection({ project, task, delivery: deliveryId });
    onSearchChange({ ...search, project, tab: "acceptance", ...(task ? { selected: task } : {}) });
  };
  const neighbors = data ? dependencyNeighbors(data.graph, selected) : null;
  const progress = data ? workProgress(data.specs) : null;
  const selectedSpec = data?.specs.find((spec) => spec.slug === selected);
  const visibleSpecs =
    data?.specs.filter((spec) => {
      const included =
        filter === "all" ||
        (filter === "ready" && data.readySpecSlugs?.includes(spec.slug)) ||
        (filter === "related" &&
          (spec.slug === selected ||
            neighbors?.prerequisites.has(spec.slug) ||
            neighbors?.dependents.has(spec.slug)));
      return (
        included &&
        `${spec.title} ${spec.slug}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())
      );
    }) ?? [];
  const selectedDelivery =
    evidenceSelection?.project === project && evidenceSelection.task === selected
      ? records?.deliveries.find((entry) => entry.id === evidenceSelection.delivery)
      : undefined;
  const deliveryEvidence =
    commandEvidence.filter((entry) => entry.deliveryId === selectedDelivery?.id);
  const stageLabel = (stage: string) => {
    const names: Record<string, [string, string]> = {
      summary: ["汇总节点", "Summary node"],
      spark: ["想法", "Spark"],
      shape: ["塑形", "Shape"],
      specify: ["规格定义", "Specify"],
      decompose: ["任务拆分", "Decompose"],
      approved: ["已批准", "Approved"],
      in_progress: ["实施阶段", "Implementation"],
      review: ["评审阶段", "Review"],
      done: ["已完成", "Done"],
      superseded: ["已被替代", "Superseded"],
      abandoned: ["已放弃", "Abandoned"],
      draft: ["草稿", "Draft"],
    };
    const name = names[stage.toLowerCase()];
    return name ? text(...name) : stage;
  };
  const taskButton = (slug: string, title?: string) => {
    const spec = data?.specs.find((entry) => entry.slug === slug);
    if (!spec) {
      const node = data?.graph.nodes.find((entry) => entry.slug === slug);
      return (
        <span className="break-words">
          {node?.title && node.title !== node.label ? node.title : slug} (
          {node?.label ?? text("未知节点", "Unknown node")})
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => selectTask(slug)}
        className="wb-link"
      >
        {spec.title || (title !== "Spec" ? title : undefined) || slug}
      </button>
    );
  };
  const empty = (
    <p className="wb-empty">{text("暂无记录", "No records")}</p>
  );
  // Presentation-only summary of the states the status strip already distinguishes.
  const freshness = error || projectError ? (data ? "stale" : "error") : loading ? "loading" : data ? "fresh" : "idle";
  const contractUnavailable = text("后端未提供契约数据", "Contract data not provided by backend");
  const contractUnrecorded = text("未记录", "Not recorded");
  const attentionMarks = data?.nodeMarks?.filter((mark) => mark.kind === "risk" && mark.value !== "cleared" &&
    (tab !== "pending" || !selected || mark.taskSlug === selected))
    .sort((a, b) => Number(b.value === "high") - Number(a.value === "high") || a.taskSlug.localeCompare(b.taskSlug));
  const attention = (limit?: number) => data?.capabilities.nodeMarks && <section aria-label={text("已标记关注节点", "Flagged nodes")} className="wb-attention">
    <h2 className="wb-section-title">{text("已标记关注节点", "Flagged nodes")} · {attentionMarks?.length ?? "?"}</h2>
    {attentionMarks === undefined ? <p role="status">{text("标记数据不可用", "Mark data unavailable")}</p>
      : !attentionMarks.length ? <p className="wb-empty">{text("没有已记录的关注标记", "No recorded attention flags")}</p>
      : <ul>{attentionMarks.slice(0, limit).map((mark) => <li key={mark.id}>
        <span className="flex flex-wrap items-center gap-2">
          <button type="button" className="wb-link font-medium"
            aria-label={`${text("查看关注节点", "Open flagged node")}: ${mark.taskSlug}`}
            onClick={() => onSearchChange({ project, tab: "tasks", selected: mark.taskSlug })}>
            {data.specs.find((spec) => spec.slug === mark.taskSlug)?.title || mark.taskSlug}
          </button>
          <span className="wb-chip" data-tone={mark.value === "high" ? "danger" : "warning"}>{mark.value === "high" ? text("高风险标记", "High-risk flag") : text("关注标记", "Watch flag")}</span>
        </span>
        <p className="whitespace-pre-wrap text-xs">{mark.reason}</p>
        <p className="wb-meta">{mark.actor} · {mark.createdAt}</p>
      </li>)}</ul>}
    {limit !== undefined && attentionMarks && attentionMarks.length > limit && <button type="button" className="wb-button"
      onClick={() => onSearchChange({ project, tab: "pending" })}>{text("查看全部关注节点", "All flagged nodes")}</button>}
  </section>;
  const deliveries = (limit?: number) => (
    <div>
      {records?.deliveries
        .slice()
        .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))
        .slice(0, limit)
        .map((delivery) => {
          const verdict = latestAcceptance(data!.acceptances, delivery.id);
          const deliveryRun = data!.runs.find((run) => run.id === delivery.runBindingId);
          const implementationTests = data!.capabilities.testReports && deliveryRun?.workPurpose === "implementation";
          return (
            <div key={delivery.id} className="wb-delivery-item">
              <div className="wb-delivery-head">
                <button
                  type="button"
                  className="wb-delivery-link"
                  aria-label={`${text("查看交付证据", "Inspect delivery evidence")}: ${delivery.id}`}
                  aria-pressed={selectedDelivery?.id === delivery.id}
                  onClick={() =>
                    setEvidenceSelection({ project, task: selected, delivery: delivery.id })
                  }
                >
                  <ClipboardCheck size={14} aria-hidden="true" />
                  {text("查看交付证据", "Inspect delivery evidence")} · {delivery.submittedAt}
                </button>
                {/* Acceptance is a record, not a test verdict, so it is never shown in the success tone. */}
                <span className="wb-chip" data-tone={verdict?.verdict === "rejected" ? "danger" : verdict ? "info" : undefined}>
                  {verdict
                    ? verdict.verdict === "accepted"
                      ? text("记录接受（非测试结论）", "Recorded acceptance (not a test result)")
                      : verdict.verdict === "rejected"
                        ? text("记录拒绝", "Recorded rejection")
                        : verdict.verdict
                    : implementationTests ? text("尚无人工交付意见", "No manual delivery opinion") : text("尚无验收判定", "No acceptance decision")}
                </span>
              </div>
              <p className="wb-meta">
                {delivery.submittedBy} · {delivery.submittedAt} · {text("执行绑定", "Run binding")}:{" "}
                {delivery.runBindingId}
              </p>
              {verdict && (
                <p className="wb-meta">
                  {verdict.approver} · {verdict.createdAt}
                </p>
              )}
              {selectedDelivery?.id === delivery.id && (
                <div
                  className="wb-evidence-detail"
                  aria-label={text("所选交付证据", "Selected delivery evidence")}
                >
                  <p className="wb-meta">{delivery.id}</p>
                  {requestOperation && data!.capabilities.testReports && <TestReportsPanel key={`tests:${project}:${delivery.id}`}
                    project={project} deliveryId={delivery.id} runs={data!.runs} language={language} request={requestOperation}
                    {...(implementationTests ? { renderGitRange: (snapshot: unknown) => renderDeliveryGit?.(deliveryRun, snapshot) } : {})}
                    onChanged={() => setRefresh((value) => value + 1)} onOpenNode={selectTask} />}
                  {requestOperation && data!.capabilities.deliveryReview && !implementationTests && <DeliveryReview key={`${project}:${delivery.id}`}
                    project={project} deliveryId={delivery.id} language={language} request={requestOperation}
                    renderGitRange={(snapshot) => {
                      const run = data!.runs.find((entry) => entry.id === delivery.runBindingId);
                      return run ? renderDeliveryGit?.(run, snapshot) : null;
                    }}
                    onChanged={() => setRefresh((value) => value + 1)} />}
                  <h4>{implementationTests ? text("人工交付意见（非测试结果）", "Manual delivery opinions (not test results)") : text("判定历史", "Decision history")}</h4>
                  <ol aria-label={text("交付判定历史", "Delivery decision history")}>
                    {data!.acceptances.filter((entry) => entry.deliveryId === delivery.id).slice().reverse().map((entry) => (
                      <li key={entry.id} className="border-t py-2 space-y-1">
                        <p>{entry.verdict === "accepted" ? text("记录接受", "Recorded acceptance") : entry.verdict === "rejected" ? text("记录拒绝", "Recorded rejection") : entry.verdict}</p>
                        <p className="wb-meta">{entry.approver} · {entry.createdAt}</p>
                        <p className="break-all">{text("登记依据标识（未核对适用性）", "Recorded basis identifier (applicability unverified)")}: {entry.requirementsFingerprint || text("未记录", "Not recorded")}</p>
                        <p>{text("附带条件", "Conditions")}</p>
                        <pre className="whitespace-pre-wrap break-words text-xs">{entry.conditions === undefined ? text("后端未提供", "Not provided by backend") : JSON.stringify(entry.conditions, null, 2)}</pre>
                      </li>
                    ))}
                  </ol>
                  {!verdict && <p>{implementationTests ? text("尚无人工交付意见", "No manual delivery opinion") : text("尚无验收判定", "No acceptance decision")}</p>}
                  {deliveryEvidence.map((entry) => (
                    <div key={entry.id} className="border-t py-2">
                      <p className="whitespace-pre-wrap break-words font-mono text-xs">
                        {entry.command || entry.kind}
                      </p>
                      <p>
                        {entry.exitCode === null
                          ? text("结果未知（无退出码）", "Unknown result (no exit code)")
                          : entry.exitCode === 0
                            ? text("仅该条命令成功", "This command succeeded only")
                            : `${text("命令失败，退出码", "Command failed, exit code")} ${entry.exitCode}`}
                      </p>
                      <p className="wb-meta">
                        {entry.verifier} · {entry.createdAt}
                      </p>
                    </div>
                  ))}
                  {!deliveryEvidence.length && (
                    <p>{text("此交付未返回证据记录", "No evidence returned for this delivery")}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      {!records?.deliveries.length && empty}
    </div>
  );

  const graphView = data && (
    <DependencyGraph
      key={project}
      data={data}
      selected={selected}
      onSelect={selectTask}
      language={language}
      stageLabel={stageLabel}
      {...(readMail ? { readMail } : {})}
      onOpenMail={(mailThread) => onSearchChange({ project, tab: "collaboration", ...(mailThread ? { mailThread } : {}) })}
      onOpenHook={(id) => setHookSelection({ project, id })}
      onOpenDelivery={openDeliveryReview}
      {...(requestOperation ? { requestOperation } : {})}
      onChanged={() => setRefresh((value) => value + 1)}
    />
  );

  return (
    <main data-i18n-skip className="wb-root" data-freshness={freshness}>
      <header className="wb-header">
        <div className="wb-title-block">
          <p className="wb-eyebrow">{text("项目工作台", "Project workbench")}</p>
          <h1 className="wb-title">
            {project || text("项目", "Project")}
          </h1>
        </div>
        <div className="wb-toolbar">
          <select
            aria-label={text("项目", "Project")}
            value={project}
            onChange={(event) => {
              setCreateInProject(null);
              onSearchChange({
                project: event.target.value,
                tab,
                layout: search.layout ?? "graph",
              });
              setData(null);
              setError(null);
            }}
            className="wb-select"
          >
            {!projects?.length && (
              <option value="">
                {projects
                  ? text("没有项目", "No projects")
                  : text("加载项目…", "Loading projects…")}
              </option>
            )}
            {projects?.map((entry) => (
              <option key={entry.slug} value={entry.slug}>
                {entry.slug}
                {!entry.managed ? text("（未托管）", " (unmanaged)") : ""}
              </option>
            ))}
            {projects && project && !projectExists && (
              <option value={project} disabled>
                {project} ({text("项目不存在", "Project unavailable")})
              </option>
            )}
          </select>
          {renderTooltip(
            text("刷新", "Refresh"),
            <button
              type="button"
              aria-label={text("刷新", "Refresh")}
              disabled={loading}
              onClick={() => {
                setRefresh((value) => value + 1);
              }}
              className="wb-icon-button"
            >
              <RefreshCw size={16} />
            </button>,
          )}
          {languageControl}
          {renderTooltip(text("新建需求节点", "New requirement node"), <button type="button"
            aria-label={text("新建需求节点", "New requirement node")}
            disabled={!projectExists || !data || (data.readOnlyTransport && !data.capabilities.createNode)} className="wb-icon-button"
            onClick={() => setCreateInProject(project)}><Plus size={16} /></button>)}
        </div>
      </header>
      {projectExists && (!data?.readOnlyTransport || data.capabilities.createNode) && createInProject === project && <CreateNodeForm key={project} project={project} language={language}
        {...(requestOperation ? { request: requestOperation } : {})}
        onClose={() => setCreateInProject(null)} onRefresh={() => setRefresh((value) => value + 1)}
        onCreated={(slug) => {
          setCreateInProject(null);
          setData(null);
          setRefresh((value) => value + 1);
          onSearchChange({ project, selected: slug, tab: "tasks", layout: "graph" });
        }} />}
      <div
        className="wb-status"
        aria-live="polite"
        data-state={freshness}
      >
        {projects && project && !projectExists && (
          <span role="alert" className="wb-chip" data-tone="danger">
            {text(
              "所选项目不在后端项目列表中，请重新选择。",
              "The selected project is not in the backend project list. Choose a project.",
            )}
          </span>
        )}
        {/* Loading, no snapshot, stale and failed stay four visibly different states. */}
        <span
          className="wb-chip"
          data-tone={loading ? "info" : (error || projectError) && data ? "warning" : undefined}
          {...(loading ? { "data-busy": "" } : {})}
        >
          {loading
            ? text("刷新中…", "Refreshing…")
            : data
              ? `${text("快照时间", "Snapshot time")}: ${data.generatedAt}`
              : text("尚无快照", "No snapshot")}
        </span>
        {(error || projectError) && (
          <span role="alert" className="wb-chip" data-tone="danger">
            {data
              ? text("刷新失败，所示数据已陈旧", "Refresh failed; displayed data is stale")
              : text("读取失败", "Read failed")}
            : {error || projectError}
          </span>
        )}
      </div>
      <nav
        aria-label={text("工作台视图", "Workbench views")}
        className="wb-tabs"
        data-freshness={freshness}
        {...(freshness === "stale" ? { "data-freshness-label": text("数据已陈旧", "Data stale") } : freshness === "error" ? { "data-freshness-label": text("读取失败", "Read failed") } : {})}
      >
        {tabs.map(({ id, zh, en, icon: Icon }) => (
          <button
            type="button"
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() =>
              onSearchChange({
                project,
                tab: id,
                layout: search.layout ?? "graph",
                ...(selected ? { selected } : {}),
              })
            }
            className="wb-tab"
          >
            <Icon size={15} />
            {text(zh, en)}
          </button>
        ))}
      </nav>
      {selected && !workspace && (
        <div className="wb-selected-bar">
          <span>
            {text("当前任务", "Selected task")}: {selected}
          </span>
          {renderTooltip(
            text("清除任务筛选", "Clear task filter"),
            <button
              type="button"
              onClick={() => selectTask(null)}
              aria-label={text("清除任务筛选", "Clear task filter")}
              className="wb-icon-button shrink-0"
            >
              <X size={15} />
            </button>,
          )}
        </div>
      )}
      {data && records ? (
        <>
          {workspace && progress && (<>
            <dl className="wb-project-stats">
              {[
                [text("已完成／当前工作节点", "Completed / current work nodes"), `${progress.completed} / ${progress.current}`],
                [
                  text("可领取规格", "Claimable specs"),
                  data.readySpecSlugs === undefined
                    ? text("未提供", "Not available")
                    : data.readySpecSlugs.length,
                ],
                [text("已登记执行", "Registered runs"), data.runs.length],
                [
                  text("交付意见待记录", "Delivery opinions pending"),
                  opinionPending.length,
                ],
                ...(data.capabilities.testReports ? [[text("代码测试与完成", "Code testing and completion"), codeCompletionPending.length]] : []),
              ].map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            <p className="wb-stat-note">{text("汇总节点", "Summary nodes")}: {progress.summaries} · {text("已失效工作节点", "Withdrawn work nodes")}: {progress.withdrawn}</p>
          </>)}
          <div
            style={{ "--wb-directory-width": `${directoryWidth}px`, "--wb-inspector-width": `${inspectorWidth}px` } as CSSProperties}
            className={
              workspace ? `wb-workspace ${selected ? "wb-has-selection" : ""}` : `wb-secondary-view ${tab === "collaboration" ? "wb-mail-view" : ""}`
            }
          >
            {workspace && (
              <section
                className="wb-task-directory"
                aria-label={text("任务目录", "Task directory")}
              >
                <header className="wb-region-heading">
                  <h2>{text("任务", "Tasks")}</h2>
                  <span>
                    {visibleSpecs.length} / {data.specs.length}
                  </span>
                </header>
                <div
                  className="wb-task-filters wb-segmented"
                  role="group"
                  aria-label={text("任务筛选", "Task filters")}
                >
                  {(
                    [
                      { value: "all", label: text("全部", "All") },
                      { value: "ready", label: text("可领取规格", "Claimable specs") },
                      { value: "related", label: text("关联", "Related") },
                    ] as const
                  ).map(({ value, label }) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={filter === value}
                      disabled={
                        (value === "ready" && data.readySpecSlugs === undefined) ||
                        (value === "related" && !selected)
                      }
                      onClick={() => setTaskFilter({ project, value })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  type="search"
                  value={query}
                  aria-label={text("搜索任务", "Search tasks")}
                  placeholder={text("搜索任务", "Search tasks")}
                  className="wb-task-search"
                  onChange={(event) => setTaskQuery({ project, value: event.target.value })}
                />
                {filter === "ready" && data.readySpecSlugs === undefined ? (
                  <p className="wb-notice" data-tone="warning">
                    {text("后端未提供可领取规格", "Claimable specs not provided by backend")}
                  </p>
                ) : (
                  <ul className="wb-task-list">
                    {visibleSpecs.map((spec) => (
                      <li key={spec.slug}>
                        <button
                          type="button"
                          className="wb-task-row"
                          data-stage={spec.role === "summary" ? "summary" : spec.stage}
                          aria-label={spec.title || spec.slug}
                          aria-pressed={selected === spec.slug}
                          onClick={() => selectTask(spec.slug)}
                        >
                          <span className="wb-task-title">{spec.title || spec.slug}</span>
                          <span className="wb-task-meta">
                            <span className="wb-badge">{stageLabel(spec.role === "summary" ? "summary" : spec.stage)}</span>
                            <span>{spec.priority}</span>
                          </span>
                          {data.readySpecSlugs?.includes(spec.slug) && (
                            <span className="wb-ready-label">
                              {text("可领取规格", "Claimable spec")}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                    {!visibleSpecs.length && (
                      <li className="wb-empty">
                        {text("没有匹配的规格", "No matching specs")}
                      </li>
                    )}
                  </ul>
                )}
                <details className="wb-project-decisions">
                  <summary>
                    {text("项目决定", "Project decisions")} · {data.decisions.length}
                  </summary>
                  {data.decisions.map((decision) => (
                    <p key={decision.slug}>
                      {decision.title || decision.slug} · {decision.status}
                    </p>
                  ))}
                </details>
              </section>
            )}
            {workspace && <PanelSeparator label={text("调整任务目录宽度", "Resize task directory")} width={directoryWidth} min={190} max={320} direction={1} onChange={setDirectoryWidth} />}
            <div className={workspace ? "wb-primary-region" : "wb-secondary-main"}>
              {workspace && (
                <>
                  {tab === "overview" && (
                    <div className="wb-overview-graph">
                      {attention(3)}
                      <h2 className="wb-section-title">
                        {text("项目依赖图", "Project dependency graph")}
                      </h2>
                      {graphView}
                    </div>
                  )}
                  <div className="wb-graph-toolbar">
                    <h2 className="wb-section-title">
                      {tab === "overview"
                        ? text("任务阶段", "Task stages")
                        : text("任务与依赖", "Tasks & dependencies")}{" "}
                      · {data.specs.length}
                    </h2>
                    <div
                      role="group"
                      aria-label={text("任务布局", "Task layout")}
                      className="wb-segmented"
                    >
                      {(
                        [
                          {
                            value: "graph",
                            icon: GitBranch,
                            label: text("依赖图", "Dependency graph"),
                          },
                          { value: "board", icon: Columns3, label: text("看板", "Board") },
                          { value: "table", icon: Table2, label: text("表格", "Table") },
                        ] as const
                      )
                        .filter(({ value }) => tab !== "overview" || value !== "graph")
                        .map(({ value, icon: Icon, label }) => (
                          <Fragment key={value}>
                            {renderTooltip(
                              label,
                              <button
                                type="button"
                                aria-label={label}
                                aria-pressed={layout === value}
                                onClick={() =>
                                  onSearchChange({
                                    project,
                                    tab,
                                    layout: value,
                                    ...(selected ? { selected } : {}),
                                  })
                                }
                              >
                                <Icon size={16} aria-hidden="true" />
                              </button>,
                            )}
                          </Fragment>
                        ))}
                    </div>
                  </div>
                  {layout === "graph" ? (
                    graphView
                  ) : (
                    <div
                      className={tab === "overview" ? "wb-auxiliary-tasks" : "wb-task-layout"}
                      aria-label={text("辅助任务区", "Auxiliary tasks")}
                    >
                      {layout === "board" ? (
                        <div className="wb-board">
                          {specColumns(visibleSpecs).map(([stage, specs]) => (
                            <section key={stage} className="wb-board-column" data-stage={stage}>
                              <h3 className="wb-board-heading">
                                <span className="min-w-0">{stageLabel(stage)}</span>
                                <span>
                                  {specs.length}
                                </span>
                              </h3>
                              <ul>
                                {specs.map((spec) => (
                                  <li
                                    key={spec.slug}
                                    className="wb-board-card"
                                    data-selected={selected === spec.slug ? "true" : undefined}
                                  >
                                    <div>
                                      {taskButton(spec.slug, spec.title)}
                                    </div>
                                    <p className="wb-meta">
                                      {spec.slug}
                                    </p>
                                    <div className="wb-card-foot">
                                      <span>{spec.priority}</span>
                                      <span>v{spec.version ?? "—"}</span>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </section>
                          ))}
                          {visibleSpecs.length === 0 ? empty : null}
                        </div>
                      ) : (
                        <div className="wb-table-wrap">
                          <table className="wb-table">
                            <thead>
                              <tr>
                                <th>{text("任务", "Task")}</th>
                                <th>{text("业务阶段", "Business stage")}</th>
                                <th>{text("优先级", "Priority")}</th>
                                <th>{text("版本", "Version")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleSpecs.map((spec) => (
                                <tr
                                  key={spec.slug}
                                  data-selected={selected === spec.slug ? "true" : undefined}
                                >
                                  <td>
                                    {taskButton(spec.slug, spec.title)}
                                    <p className="wb-meta">
                                      {spec.slug}
                                    </p>
                                  </td>
                                  <td data-stage={spec.role === "summary" ? "summary" : spec.stage}>
                                    <span className="wb-badge">{stageLabel(spec.role === "summary" ? "summary" : spec.stage)}</span>
                                  </td>
                                  <td>{spec.priority}</td>
                                  <td>{spec.version ?? "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                  <details className="wb-relationship-records">
                    <summary>
                      {text("关系记录", "Relationship records")} · {data.graph.edges.length}
                    </summary>
                    {data.graph.edges
                      .filter((edge) => !selected || edge.from === selected || edge.to === selected)
                      .map((edge) => {
                        const direction = dependencyDirection(edge);
                        const from = direction?.prerequisite ?? edge.from;
                        const to = direction?.dependent ?? edge.to;
                        return (
                          <div
                            key={`${edge.from}-${edge.to}-${edge.type}`}
                            className="wb-relationship-row"
                          >
                            {taskButton(from)}
                            <ArrowRight size={14} aria-hidden />
                            <span className="wb-meta">
                              {direction ? text("前置于", "prerequisite for") : edge.type}
                            </span>
                            {taskButton(to)}
                          </div>
                        );
                      })}
                    <p className="wb-meta pt-2">
                      {text(
                        "仅展示后端已返回的关系；无关系记录不代表依赖完整。",
                        "Only returned relationships are shown; missing records do not establish completeness.",
                      )}
                    </p>
                  </details>
                </>
              )}
              {tab === "sessions" && (search.runId ? <section className="space-y-3">
                <button type="button" className="wb-button" onClick={() => onSearchChange({ project, tab: "sessions", ...(selected ? { selected } : {}) })}>{text("显示本节点全部执行", "Show all runs for node")}</button>
                {selectedRun ? <>
                  <p className="break-all text-sm">{text("原执行", "Original run")}: {selectedRun.id}</p>
                  {requestOperation && (selectedRun.candidateLoop || (selectedRun.executorKind === "agent" && selectedRun.workPurpose === "implementation" && ["prepared", "bound"].includes(selectedRun.state)))
                    ? <CandidateLoopPanel key={`${project}:${selectedRun.id}`} project={project} run={selectedRun} language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)} /> : null}
                  {renderSessions(data.runs, selected, project, () => setRefresh((value) => value + 1), selectedRun.id, data.nodeOwners)}
                </> : <p role="alert">{text("原执行不在此节点中；未选择其他执行。", "Original run is unavailable in this task; no other run was selected.")}</p>}
              </section> : renderSessions(data.runs, selected, project, () => setRefresh((value) => value + 1), undefined, data.nodeOwners))}
              {tab === "pending" && (
                <>
                  {attention()}
                  <section aria-label={text("循环待人工判断", "Program loops needing human judgment")}>
                    <h2 className="wb-section-title">{text("循环待人工判断", "Program loops needing human judgment")} · {data.runs.filter((run) => run.programLoop?.status === "needs_human" && (!selected || run.taskSlug === selected)).length}</h2>
                    {data.runs.filter((run) => run.programLoop?.status === "needs_human" && (!selected || run.taskSlug === selected)).map((run) => <div key={run.id} className="wb-list-item">
                      <button type="button" className="wb-delivery-link" onClick={() => onSearchChange({ project, selected: run.taskSlug, tab: "sessions", runId: run.id })}>{run.taskSlug} · {run.id}</button>
                      <p>{text("次数耗尽，需要人工判断", "Attempts exhausted; human judgment required")}</p>
                      <p>{text("已准入次数", "Admitted attempts")}: {run.programLoop!.attemptOrdinal ?? 0} / {run.programLoop!.maxAttempts} · {text("原授权人", "Original authorizer")}: {run.programLoop!.authorizedByUserId}</p>
                    </div>)}
                  </section>
                  <section aria-label={text("候选循环待人工处置", "Candidate loops needing human action")}>
                    <h2 className="wb-section-title">{text("候选循环待人工处置", "Candidate loops needing human action")} · {data.runs.filter((run) => run.candidateLoop?.status === "needs_human" && (!selected || run.taskSlug === selected)).length}</h2>
                    {data.runs.filter((run) => run.candidateLoop?.status === "needs_human" && (!selected || run.taskSlug === selected)).map((run) => <div key={run.id} className="wb-list-item">
                      <button type="button" className="wb-delivery-link" onClick={() => onSearchChange({ project, selected: run.taskSlug, tab: "sessions", runId: run.id })}>{run.taskSlug} · {run.id}</button>
                      <p>{text("固定候选次数耗尽，需要人工处置", "Formal candidate budget exhausted; human action required")}</p>
                      <p>{text("已准入候选", "Admitted candidates")}: {run.candidateLoop!.attemptOrdinal ?? 0} / {run.candidateLoop!.maxAttempts} · {text("原配置人", "Original configurator")}: {run.candidateLoop!.configuredBy}</p>
                    </div>)}
                  </section>
                  {data.capabilities.independentReview && <section aria-label={text("待人工审核", "Human review holds")}>
                    <h2 className="wb-section-title">{text("待人工审核", "Human review holds")}</h2>
                    {(data.reviewStates ?? []).flatMap(({ taskSlug, reviews }) => reviews.map((review) => ({ ...review, taskSlug }))).filter((status) => status.humanHold && (!selected || status.taskSlug === selected)).map((status) => <div key={`${status.taskSlug}:${status.kind}`} className="wb-list-item">
                      <p>{taskButton(status.taskSlug)} · {text("Agent 退回轮数", "Agent rejection rounds")}: {status.agentRejections} / {status.maxReviewRounds}</p>
                      <p>{status.kind === "requirements" ? text("需求审核", "Requirements review") : text("设计审核", "Design review")}</p>
                      <p>{text("负责人", "Responsible human")}: {status.responsibleUserId ?? text("未指定", "Not assigned")}</p>
                      <p>{text("审核请求", "Review request")}: {status.request?.id ?? text("无", "None")}</p>
                    </div>)}
                  </section>}
                  {data.capabilities.mailInspection && <section>
                    <h2 className="wb-section-title">{text("未关闭协作", "Open collaboration")}</h2>
                    <MailWorkspace key={`pending:${project}:${selected ?? "all"}`} project={project} task={selected}
                      runs={data.runs} language={language} revision={data.generatedAt}
                      {...(readMail ? { readMail } : {})}
                      onClearTask={() => selectTask(null)}
                      onOpenNode={(slug) => onSearchChange({ project, tab: "tasks", selected: slug })}
                      onOpenPendingThread={(mailThread) => onSearchChange({ project, tab: "collaboration", mailThread })} />
                  </section>}
                  <section>
                    <h2 className="wb-section-title">
                      {text("未登记执行的规格", "Specs without registered runs")}
                    </h2>
                    {unbound
                      .filter((spec) => !selected || spec.slug === selected)
                      .map((spec) => (
                        <p key={spec.slug} className="wb-list-item">
                          {taskButton(spec.slug, spec.title)}
                        </p>
                      ))}
                    <p className="wb-meta">
                      {text(
                        "没有绑定记录不代表从未运行。",
                        "No binding record does not mean the task has never run.",
                      )}
                    </p>
                  </section>
                  {data.capabilities.testReports && <section aria-label={text("代码测试与完成", "Code testing and completion")}>
                    <h2 className="wb-section-title">{text("代码测试与完成", "Code testing and completion")}</h2>
                    {selectedCodePending.map(({ run, delivery }) => <div key={run.id} className="wb-list-item">
                      <p>{taskButton(run.taskSlug)} · {run.id}</p>
                      <button type="button" className="wb-delivery-link" aria-label={`${text("查看代码交付", "Open implementation delivery")}: ${delivery.id}`} onClick={() => openDeliveryReview(delivery.id, run.taskSlug)}>
                        <ClipboardCheck size={14} />{delivery.id} · {delivery.submittedAt}
                      </button>
                    </div>)}
                    {!selectedCodePending.length && empty}
                  </section>}
                  <section>
                    <h2 className="wb-section-title">
                      {text("交付意见待记录", "Delivery opinions pending")}
                    </h2>
                    {undecided.map((delivery) => (
                      <p key={delivery.id} className="wb-list-item">
                        <button type="button" className="wb-delivery-link" aria-label={`${text("查看待判定交付", "Review pending delivery")}: ${delivery.id}`} onClick={() => openDeliveryReview(delivery.id)}>
                          <ClipboardCheck size={14} />{delivery.id} · {delivery.submittedAt}
                        </button>
                      </p>
                    ))}
                    {!undecided.length && empty}
                  </section>
                  <section>
                    <h2 className="wb-section-title">
                      {text("已记录验证失败", "Recorded verification failures")}
                    </h2>
                    {failures.map((entry) => (
                      <p key={entry.id} className="wb-list-item">
                        <button type="button" className="wb-delivery-link" aria-label={`${text("查看失败证据", "Inspect failed evidence")}: ${entry.id}`} onClick={() => openDeliveryReview(entry.deliveryId)}>
                          <ClipboardCheck size={14} />{entry.command || entry.kind} · {text("退出码", "Exit code")}: {entry.exitCode} · {entry.createdAt}
                        </button>
                      </p>
                    ))}
                    {!failures.length && empty}
                  </section>
                  <p className="wb-notice">
                    {text(
                      "交接与授权数据尚未接入。",
                      "Handoff and authorization data are not connected.",
                    )}
                  </p>
                </>
              )}
              {tab === "acceptance" && (
                <>
                  <section>
                    <h2 className="wb-section-title">
                      {text("交付与最新验收记录", "Deliveries and latest acceptance records")}
                    </h2>
                    {deliveries()}
                  </section>
                  <section>
                    <h2 className="wb-section-title">
                      {text("证据记录", "Evidence records")}
                    </h2>
                    {commandEvidence.map((entry) => (
                      <div key={entry.id} className="wb-list-item">
                        <p className="break-all font-mono">{entry.command || entry.kind}</p>
                        <p>
                          {evidenceResult(entry.exitCode) === "unknown"
                            ? text("结果未知（无退出码）", "Unknown result (no exit code)")
                            : evidenceResult(entry.exitCode) === "command-succeeded"
                              ? text("仅该条命令成功", "This command succeeded only")
                              : `${text("命令失败，退出码", "Command failed, exit code")} ${entry.exitCode}`}
                        </p>
                        <p className="wb-meta">
                          {entry.kind} · {entry.verifier} · {entry.createdAt} ·{" "}
                          {text("交付", "Delivery")}: {entry.deliveryId}
                        </p>
                      </div>
                    ))}
                    {!commandEvidence.length && empty}
                  </section>
                </>
              )}
              {tab === "collaboration" && (data.capabilities.mailInspection ? (
                <MailWorkspace key={`${project}:${selected ?? "all"}:${search.mailThread ?? ""}`} project={project} task={selected}
                  runs={data.runs}
                  {...(search.mailThread ? { initialThread: search.mailThread } : {})}
                  {...(readMail ? { readMail } : {})}
                  {...(requestOperation ? { request: requestOperation } : {})}
                  language={language} revision={data.generatedAt} onClearTask={() => selectTask(null)}
                  onOpenNode={(slug) => onSearchChange({ project, tab: "tasks", selected: slug })} />
              ) : <p role="status">{text("当前后端尚未提供协作监督接口。", "The current backend does not provide mail inspection.")}</p>)}
              {tab === "knowledge" && <KnowledgeSearch key={project} project={project} language={language}
                {...(requestOperation ? { request: requestOperation } : {})} {...(renderRepositorySearch ? { renderRepositorySearch } : {})}
                onOpenNode={(slug) => onSearchChange({ project, tab: "tasks", selected: slug })} />}
              <details className="wb-capabilities">
                <summary>{text("连接状态", "Connections")}</summary>
                {!data.capabilities.independentVerification && (
                  <p>
                    {text(
                      "独立验证未接入；登记证据和人工接受不能替代独立验证。",
                      "Independent verification is not connected; recorded evidence and human acceptance do not replace it.",
                    )}
                  </p>
                )}
                {!data.capabilities.discussionAuthorization && (
                  <p>
                    {text(
                      "项目讨论与正式变更授权未接入。",
                      "Project discussion and formal change authorization are not connected.",
                    )}
                  </p>
                )}
              </details>
            </div>
            {selected && tab !== "sessions" && tab !== "collaboration" && (
              <PanelSeparator label={text("调整节点详情宽度", "Resize node inspector")} width={inspectorWidth} min={280} max={440} direction={-1} onChange={setInspectorWidth} />
            )}
            {selected && tab !== "sessions" && tab !== "collaboration" && (
              <aside className="wb-inspector" aria-label={text("节点详情", "Node inspector")}>
                <header className="wb-inspector-heading">
                  <div className="min-w-0">
                    <p>
                      {text("任务详情", "Task details")}
                    </p>
                    <h2>
                      {selectedSpec?.title || selected}
                    </h2>
                  </div>
                  {renderTooltip(
                    text("清除任务筛选", "Clear task filter"),
                    <button
                      type="button"
                      aria-label={text("清除任务筛选", "Clear task filter")}
                      onClick={() => selectTask(null)}
                      className="wb-icon-button shrink-0"
                    >
                      <X size={16} />
                    </button>,
                  )}
                  {selectedSpec && (
                    <div className="wb-inspector-chips" data-stage={selectedSpec.role === "summary" ? "summary" : selectedSpec.stage}>
                      <span className="wb-badge">{stageLabel(selectedSpec.role === "summary" ? "summary" : selectedSpec.stage)}</span>
                      <span className="wb-chip">{selectedSpec.priority}</span>
                      {selectedSpec.version !== undefined && <span className="wb-chip">v{selectedSpec.version}</span>}
                    </div>
                  )}
                </header>
                {detailPending && detail && (
                  <p className="wb-notice" data-tone="info">
                    {text(
                      "详情刷新中，当前显示上一份详情。",
                      "Refreshing details; showing the previous detail snapshot.",
                    )}
                  </p>
                )}
                {detailError && (
                  <p role="alert">
                    {detail
                      ? text(
                          "详情刷新失败，所示详情已陈旧：",
                          "Detail refresh failed; displayed details are stale: ",
                        )
                      : text("详情读取失败：", "Detail read failed: ")}
                    {detailError}
                  </p>
                )}
                {!data.specs.some((spec) => spec.slug === selected) ? (
                  <p className="wb-notice" data-tone="warning">
                    {text(
                      "当前项目未返回此规格，未请求规格详情。",
                      "This spec was not returned for the current project; no detail request was made.",
                    )}
                  </p>
                ) : !detail && !detailError ? (
                  <p className="wb-state" data-state="loading">{text("加载中…", "Loading…")}</p>
                ) : !detail ? null : !detail.spec ? (
                  <p className="wb-notice">{text("该任务没有规格详情。", "No spec details for this task.")}</p>
                ) : (
                  <>
                    <section className="wb-group">
                      <h3 className="wb-group-title">{text("定义", "Definition")}</h3>
                      {detail.spec.role === "summary" && <p>{text("汇总节点", "Summary node")} · {text("历史业务阶段", "Historical business stage")}: {stageLabel(detail.spec.stage)}</p>}
                      <section className="wb-goal wb-panel">
                        <h3>{text("目标", "Goal")}</h3>
                        <p className="whitespace-pre-wrap">{detail.spec.intent}</p>
                      </section>
                      <section className="wb-panel">
                        <h3>{text("范围", "Scope")}</h3>
                        {[
                          { label: text("范围内", "In scope"), entries: detail.spec.shape?.scope_in },
                          {
                            label: text("范围外", "Out of scope"),
                            entries: detail.spec.shape?.scope_out,
                          },
                        ].map(({ label, entries }) => (
                          <div key={label} className="wb-scope-block">
                            <h4>{label}</h4>
                            {entries?.length ? (
                              <ul className="wb-entries">
                                {entries.map((entry, index) => (
                                  <li key={index}>
                                    {entry}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className={detail.spec!.shape === undefined ? "wb-notice" : "wb-empty"} data-tone="warning">
                                {detail.spec!.shape === undefined
                                  ? contractUnavailable
                                  : contractUnrecorded}
                              </p>
                            )}
                          </div>
                        ))}
                      </section>
                      <section className="wb-panel">
                        <h3>
                          {text("验收标准（规格记录）", "Acceptance criteria (specification)")}
                        </h3>
                        {detail.spec.specify?.verify_criteria?.length ? (
                          <ul className="wb-entries">
                            {detail.spec.specify.verify_criteria.map((criterion, index) => (
                              <li key={index}>
                                <span className="wb-meta">
                                  {criterion.category}
                                </span>
                                <p className="whitespace-pre-wrap">{criterion.description}</p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={detail.spec.specify === undefined ? "wb-notice" : "wb-empty"} data-tone="warning">
                            {detail.spec.specify === undefined
                              ? contractUnavailable
                              : contractUnrecorded}
                          </p>
                        )}
                      </section>
                    </section>
                    <section className="wb-group">
                      <h3 className="wb-group-title">{text("操作与审核", "Actions & review")}</h3>
                      {detail.spec.role === "summary" && requestOperation && <SummaryPanel key={`${project}:${detail.spec.slug}`} project={project} goalSlug={detail.spec.slug} language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)} />}
                      {requestOperation && (detail.spec.role === "work" || detail.spec.role === "summary") && <NodeOwnershipPanel key={`${project}:${detail.spec.id}`} project={project} taskSlug={detail.spec.slug} role={detail.spec.role} stage={detail.spec.stage}
                        events={detail.events} language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)}
                        onOpenRun={(id) => onSearchChange({ project, tab: "sessions", selected: detail.spec!.slug, runId: id })} />}
                      {requestOperation && <MergePanel key={`merge:${project}:${detail.spec.slug}`} project={project} anchor={detail.spec.slug} specs={data.specs} {...(data.nodeOwners ? { owners: data.nodeOwners } : {})}
                        language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)} />}
                      {requestOperation && (detail.spec.role === "work" || detail.spec.role === "summary") && <CompletionHookPanel key={`${project}:${detail.spec.id}`} project={project} source={{ id: detail.spec.id, slug: detail.spec.slug, role: detail.spec.role, stage: detail.spec.stage }}
                        runs={data.runs} events={detail.events} manualCompletions={detail.manualCompletions ?? []} hooks={detail.completionHooks}
                        language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)} />}
                      <button className="wb-button" onClick={() => onSearchChange({ project, selected: detail.spec!.slug, tab: "collaboration" })}>
                        <Mail size={14} />{text("查看节点协作", "View node collaboration")}
                      </button>
                      <DeliveryHooksPanel key={`hooks:${project}:${selected}`} hooks={data.deliveryHooks?.filter((hook) => hook.sourceTaskSlug === detail.spec!.slug || hook.targetTaskSlug === detail.spec!.slug)}
                        available={data.capabilities.deliveryHooks === true && data.deliveryHooks !== undefined} data={data} language={language}
                        {...(hookSelection?.project === project ? { selectedId: hookSelection.id } : {})}
                        onOpenNode={selectTask} onOpenDelivery={openDeliveryReview} {...(requestOperation ? { request: requestOperation } : {})}
                        onChanged={() => setRefresh((value) => value + 1)} />
                      {data.capabilities.nodeMarks && <NodeMarksPanel key={`marks:${project}:${selected}`}
                        project={project} slug={detail.spec.slug} language={language} currentMarks={data.nodeMarks}
                        {...(requestOperation ? { request: requestOperation } : {})}
                        onChanged={() => setRefresh((value) => value + 1)} />}
                      {data.capabilities.nodeEvents && <NodeEventsPanel key={`events:${project}:${selected}`}
                        project={project} slug={detail.spec.slug} language={language} runs={records.runs} deliveries={records.deliveries} counts={data.nodeEventCounts}
                        {...(requestOperation ? { request: requestOperation } : {})}
                        onChanged={() => setRefresh((value) => value + 1)} />}
                      {data.capabilities.abandonNode && detail.spec.stage !== "abandoned" && <AbandonNodePanel key={`abandon:${project}:${selected}`}
                        project={project} slug={detail.spec.slug} language={language}
                        {...(requestOperation ? { request: requestOperation } : {})}
                        onChanged={() => setRefresh((value) => value + 1)}
                        onOpenSessions={() => onSearchChange({ project, selected: detail.spec!.slug, tab: "sessions" })} />}
                      {requestOperation && data.capabilities.nodeApproval && detail.spec.role !== "summary" && ["spark", "shape", "specify", "decompose"].includes(detail.spec.stage) && (
                        <NodeApproval key={`approval:${project}:${selected}:${detail.spec.version}`}
                          request={requestOperation} project={project} slug={detail.spec.slug} version={detail.spec.version}
                          language={language} onChanged={() => setRefresh((value) => value + 1)} />
                      )}
                      {requestOperation && data.capabilities.independentReview && detail.spec.role !== "summary" && <ReviewAssignmentPanel key={`review:${project}:${selected}`}
                        project={project} slug={detail.spec.slug} runs={data.runs}
                        language={language} request={requestOperation} onChanged={() => setRefresh((value) => value + 1)} onOpenNode={selectTask} />}
                      {detail.spec.role !== "summary" && !["done", "abandoned", "superseded"].includes(detail.spec.stage) && data.capabilities.manualCompletion && (
                        <NodeCompletion key={`${project}:${selected}:${detail.spec.version}`}
                          {...(requestOperation ? { request: requestOperation } : {})}
                          project={project} slug={detail.spec.slug} version={detail.spec.version}
                          language={language} onCompleted={() => setRefresh((value) => value + 1)} />
                      )}
                      {data.capabilities.dependencyEditing && <DependencyEditor key={`${project}:${selected}`} project={project} slug={detail.spec.slug}
                        {...(requestOperation ? { request: requestOperation } : {})}
                        allowRemoval={data.capabilities.dependencyRemoval === true} prerequisiteSlugs={neighbors!.prerequisites}
                        specs={data.specs} registeredRuns={records.runs}
                        acceptedRecords={data.acceptances.filter((entry) => entry.verdict === "accepted" && records.deliveries.some((delivery) => delivery.id === entry.deliveryId))}
                        language={language} onChanged={() => setRefresh((value) => value + 1)} />}
                      {data.capabilities.runDispatch && detail.spec.role !== "summary" && renderDispatch?.({project, taskSlug: detail.spec.slug, title: detail.spec.intent, runs: records.runs,
                        ownerHold: data.nodeOwners?.some((item) => item.taskSlug === detail.spec!.slug && (!!item.humanOwnerUserId || !!item.pendingOperationId)) ?? false,
                        binding: "projectBinding" in data ? (data.projectBinding ?? null) : undefined,
                        onChanged: () => setRefresh((value) => value + 1)})}
                      {data.capabilities.subdivision && <SubdivisionPanel key={`${project}:${selected}`} project={project} slug={detail.spec.slug}
                        {...(requestOperation ? { request: requestOperation } : {})}
                        language={language} onChanged={() => setRefresh((value) => value + 1)} />}
                      {data.capabilities.changePreview && <ChangeImpactPreview key={`change:${project}:${selected}`} project={project} slug={detail.spec.slug}
                        language={language} {...(requestOperation ? { request: requestOperation } : {})} onSelect={(selected) => onSearchChange({ ...search, project, selected })} />}
                    </section>
                    <section className="wb-group">
                      <h3 className="wb-group-title">{text("执行与交付", "Execution & delivery")}</h3>
                      {!!detail.manualCompletions?.length && <section className="wb-panel">
                        <h3>{text("人工完成记录", "Manual completion history")}</h3>
                        {detail.manualCompletions.map((entry) => <div key={entry.id} className="wb-list-item">
                          <p>{entry.actor} · v{entry.sourceVersion} → v{entry.resultVersion}</p>
                          <p>{entry.note}</p><time className="wb-meta">{entry.createdAt}</time>
                        </div>)}
                        <p className="wb-notice">{text("人工标记不代表技术验证通过。", "Human completion is not technical verification.")}</p>
                      </section>}
                      <section className="wb-node-execution">
                        <h3>
                          {text("执行与原生会话", "Runs & native sessions")} · {records.runs.length}
                        </h3>
                        {renderSessions(data.runs, selected, project, () => setRefresh((value) => value + 1), undefined, data.nodeOwners)}
                        {requestOperation && records.runs.filter((run) => !run.candidateLoop && run.executorKind === "agent" && run.workPurpose === "implementation" && ["prepared", "bound"].includes(run.state)).map((run) => <button key={run.id} type="button" className="wb-button" onClick={() => onSearchChange({ project, tab: "sessions", selected: run.taskSlug, runId: run.id })}>
                          {text("配置正式候选循环", "Configure formal candidate loop")}: {run.id}
                        </button>)}
                      </section>
                      <section className="wb-node-deliveries">
                        <h3>
                          {text("交付与证据", "Deliveries & evidence")} · {records.deliveries.length}
                        </h3>
                        {deliveries()}
                      </section>
                    </section>
                    <section className="wb-group">
                      <h3 className="wb-group-title">{text("关系", "Relationships")}</h3>
                      <section className="wb-node-neighbors">
                        {[
                          {
                            label: text("直接前置", "Direct prerequisites"),
                            ids: neighbors!.prerequisites,
                          },
                          {
                            label: text("直接后续", "Direct dependents"),
                            ids: neighbors!.dependents,
                          },
                        ].map(({ label, ids }) => (
                          <div key={label}>
                            <h3>
                              {label} · {ids.size}
                            </h3>
                            <ul>
                              {[...ids].map((slug) => (
                                <li key={slug} className="py-1">
                                  {taskButton(slug)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </section>
                    </section>
                    <section className="wb-group">
                      <h3 className="wb-group-title">{text("参考", "Reference")}</h3>
                      <details className="wb-fold">
                        <summary>
                          {text("不变量", "Invariants")}
                        </summary>
                        {detail.spec.specify?.invariants?.length ? (
                          <ul className="wb-entries">
                            {detail.spec.specify.invariants.map((entry, index) => (
                              <li key={index}>
                                {entry}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={detail.spec.specify === undefined ? "wb-notice" : "wb-empty"} data-tone="warning">
                            {detail.spec.specify === undefined
                              ? contractUnavailable
                              : contractUnrecorded}
                          </p>
                        )}
                      </details>
                      <details className="wb-fold">
                        <summary>
                          {text("接口", "Interfaces")}
                        </summary>
                        {detail.spec.specify?.interfaces?.length ? (
                          <dl className="wb-scope">
                            {detail.spec.specify.interfaces.map((entry, index) => (
                              <div key={index}>
                                <dt className="font-medium">{entry.name}</dt>
                                <dd className="whitespace-pre-wrap">{entry.body}</dd>
                              </div>
                            ))}
                          </dl>
                        ) : (
                          <p className={detail.spec.specify === undefined ? "wb-notice" : "wb-empty"} data-tone="warning">
                            {detail.spec.specify === undefined
                              ? contractUnavailable
                              : contractUnrecorded}
                          </p>
                        )}
                      </details>
                      <details className="wb-fold">
                        <summary>
                          {text("涉及文件", "Files in scope")}
                        </summary>
                        {detail.spec.specify?.touches?.length ? (
                          <ul className="wb-scope">
                            {detail.spec.specify.touches.map((entry, index) => (
                              <li key={index}>
                                <p className="font-mono text-xs">{entry.path}</p>
                                <p className="whitespace-pre-wrap">{entry.purpose}</p>
                                <p className="wb-meta">{entry.change_type}</p>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className={detail.spec.specify === undefined ? "wb-notice" : "wb-empty"} data-tone="warning">
                            {detail.spec.specify === undefined
                              ? contractUnavailable
                              : contractUnrecorded}
                          </p>
                        )}
                      </details>
                      <details className="wb-source-details wb-fold">
                        <summary>{text("来源与历史", "Source & history")}</summary>
                        <dl className="wb-facts">
                          {[
                            [text("标识", "Identifier"), selected],
                            [detail.spec.role === "summary" ? text("历史业务阶段", "Historical business stage") : text("业务阶段", "Business stage"), stageLabel(detail.spec.stage)],
                            [text("优先级", "Priority"), detail.spec.priority],
                            [text("复杂度", "Complexity"), detail.spec.complexity],
                            [text("版本", "Version"), detail.spec.version],
                            [text("创建时间", "Created"), detail.spec.createdAt],
                            [text("更新时间", "Updated"), detail.spec.updatedAt],
                            [text("来源类型", "Provenance"), detail.spec.provenanceType],
                            [text("内容哈希", "Content hash"), detail.spec.contentHash],
                          ].map(([label, value]) => (
                            <div key={label} className="contents">
                              <dt>{label}</dt>
                              <dd>{value ?? "—"}</dd>
                            </div>
                          ))}
                        </dl>
                        {detail.spec.notes && (
                          <p className="whitespace-pre-wrap break-words">{detail.spec.notes}</p>
                        )}
                        <section>
                          <h3>{text("依赖", "Dependencies")}</h3>
                          {detail.dependencies.map((entry) => (
                            <p
                              key={entry.slug ?? entry.nodeId ?? entry.title}
                              className="break-words py-1"
                            >
                              {entry.slug
                                ? taskButton(entry.slug, entry.title)
                                : entry.nodeId || entry.title}
                            </p>
                          ))}
                          {!detail.dependencies.length && empty}
                        </section>
                        <section>
                          <h3>
                            {text("影响关系（原始记录）", "Impact relationships (recorded)")}
                          </h3>
                          {detail.impactedBy.map((entry) => (
                            <p key={entry.slug ?? entry.title} className="break-words py-1">
                              {entry.slug ? taskButton(entry.slug, entry.title) : entry.title}
                            </p>
                          ))}
                          {!detail.impactedBy.length && empty}
                        </section>
                        <section>
                          <h3>{text("执行事件", "Execution events")}</h3>
                          {detail.eventError && (
                            <p className="wb-error-text">{detail.eventError}</p>
                          )}
                          {detail.events.map((event) => (
                            <div key={event.id} className="space-y-1 border-b py-2">
                              <p className="break-words">{event.message || event.type}</p>
                              <p className="wb-meta">
                                {event.createdAt} · {event.agent} · {event.type}
                              </p>
                            </div>
                          ))}
                          {!detail.events.length && (
                            <p className="wb-empty">
                              {text(
                                "没有事件记录，不代表没有运行。",
                                "No recorded events; this does not establish that no run occurred.",
                              )}
                            </p>
                          )}
                        </section>
                        <section>
                          <h3>{text("变更记录", "Changes")}</h3>
                          {detail.changeError && (
                            <p className="wb-error-text">{detail.changeError}</p>
                          )}
                          {detail.changes.map((change) => (
                            <p
                              key={`${change.version}-${change.createdAt}-${change.summary}`}
                              className="break-words border-b py-2 text-xs"
                            >
                              v{change.version} · {change.summary} · {change.createdAt}
                              {change.reason && <span className="block whitespace-pre-wrap">{change.reason}</span>}
                            </p>
                          ))}
                          {!detail.changes.length && empty}
                        </section>
                      </details>
                    </section>
                  </>
                )}
              </aside>
            )}
          </div>
        </>
      ) : (
        !error &&
        !projectError && (
          <p className="wb-state" data-state={project && projectExists ? "loading" : "idle"}>
            {project && projectExists
              ? text("加载工作台…", "Loading workbench…")
              : text("请选择后端项目。", "Select a backend project.")}
          </p>
        )
      )}
    </main>
  );
}
