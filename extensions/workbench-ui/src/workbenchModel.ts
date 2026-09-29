export type WorkbenchRequest = (url: string, init?: RequestInit) => Promise<Response>;

export type ReviewKind = "requirements" | "design";
export type ReviewSource =
  | { kind: "specgraph"; specSlug: string; field: string; changeId: string }
  | { kind: "git"; environmentId: string; repositoryRoot: string; commitSha: string; path: string; entry?: string };
export type ReviewAuthor = { kind: "agent"; runId: string } | { kind: "human"; userId: string };
export type ReviewDecision = {
  id: string;
  requestId: string;
  verdict: "accepted" | "rejected";
  basis: string;
  actorKind: "agent" | "human";
  actor: string;
  reviewerRunId: string | null;
  createdAt: string;
};
export type ReviewRequest = {
  id: string;
  taskSlug: string;
  kind: ReviewKind;
  sources: ReviewSource[];
  authorResponsibility: ReviewAuthor;
  completionRunId: string | null;
  requirementDecisionIds: string[];
  reviewerRunId: string;
  responsibleUserId: string;
  maxReviewRounds: number;
  createdBy: string;
  createdAt: string;
  decidedAt: string | null;
  decisions: ReviewDecision[];
};

export type ReviewState = {
  kind: ReviewKind;
  request: ReviewRequest | null;
  agentRejections: number;
  maxReviewRounds: number;
  humanHold: boolean;
  responsibleUserId: string | null;
};
export type ReviewStatus = { taskSlug: string; reviews: ReviewState[] };
export type SourceReviewResult = {
  recorded: boolean;
  decision: ReviewDecision;
  status: ReviewStatus;
  authoringCompletion?: { runId: string; taskSlug: string; status: "completed" | "failed"; message?: string };
};
export type TestReport = {
  id: string;
  deliveryId: string;
  testRunId: string | null;
  commitSha: string;
  planSources: ReviewSource[];
  status: "passed" | "failed" | "not_run" | "environment_blocked";
  command: string;
  exitCode: number | null;
  summary: string;
  outputRefs: string[];
  reporter: string;
  createdAt: string;
};
export type TestReports = { deliveryId: string; reports: TestReport[]; hasMore: boolean; nextCursor: string | null };

export type NodeMark = {
  id: string;
  taskSlug: string;
  kind: "risk" | "critical";
  value: "watch" | "high" | "marked" | "cleared";
  reason: string;
  actor: string;
  createdAt: string;
};

export type NodeEvent = {
  id: string;
  taskSlug: string;
  kind: "retry" | "rework" | "git_undo";
  reason: string;
  actor: string;
  previousRunId: string | null;
  runId: string | null;
  deliveryId: string | null;
  gitUndo?: { operation: "revert" | "reset"; sourceCommit: string; resultCommit: string } | null;
  recordedAt: string;
};

export type CompletionHookSummary = {
  id: string; sourceTaskSlug: string; sourceSpecId: string; targetRunId: string; targetPackageId: string; targetTaskSlug: string;
  idempotencyKey: string; requestedFact: { kind: "execution" | "manual" | "summary"; id: string } | null;
  createdAt: string; triggeredAt: string | null; cancelledAt: string | null; fact: { kind: "execution" | "manual" | "summary"; id: string } | null;
  state: string; dispatchStatus: string | null; programAdmissionId: string | null;
};

export type WorkbenchRun = {
  id: string;
  taskSlug: string;
  packageId: string;
  generation: number;
  specVersion?: number | null;
  threadRef: string;
  environmentId?: string;
  executorKind?: "agent" | "program";
  nativeProjectId?: string;
  dispatchMessageId?: string;
  assignmentRole?: string;
  workPurpose?: string;
  gitBaseline?: { isRepo: boolean; commitSha: string | null };
  workspace: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  programLoop?: { kind: string; maxAttempts: number | null; status: string; attemptId: string | null; attemptOrdinal: number | null; authorizedByUserId: string };
  candidateLoop?: { status: string; maxAttempts: number; attemptId: string | null; attemptOrdinal: number | null; deliveryId: string | null; configuredBy: string };
};

export type ProjectBinding = {
  id: string;
  projectSlug: string;
  environmentId: string;
  nativeProjectId: string;
  workspaceRoot: string | null;
  reason: string;
  actor: string;
  createdAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  revokedBy: string | null;
};

// current-view carries only the active binding (or null); the validator rejects
// foreign-project or already-revoked records rather than letting them steer dispatch.
export function validateProjectBinding(value: unknown, project: string): ProjectBinding | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") throw new Error("Invalid project binding");
  const binding = value as Record<string, unknown>;
  if (
    ["id", "projectSlug", "environmentId", "nativeProjectId", "reason", "actor", "createdAt"].some(
      (field) => typeof binding[field] !== "string" || !binding[field],
    ) ||
    (binding.workspaceRoot !== null && typeof binding.workspaceRoot !== "string") ||
    binding.revokedAt !== null ||
    (binding.revokeReason ?? null) !== null ||
    (binding.revokedBy ?? null) !== null ||
    binding.projectSlug !== project
  )
    throw new Error("Invalid project binding");
  return binding as unknown as ProjectBinding;
}

export type DeliveryTestHook = {
  id: string; project: string; sourceRunId: string; sourceTaskSlug: string;
  targetRunId: string; targetTaskSlug: string; targetPackageId: string; commitSha: string;
  configuredByRunId: string | null; configuredByUserId: string; hostConsumerUserId: string; createdAt: string;
  deliveryId: string | null; triggeredAt: string | null; cancelledAt: string | null;
  cancelledByRunId: string | null; cancelledByUserId: string | null; cancellationReason: string | null;
  retriedAt: string | null; retriedByRunId: string | null; retriedByUserId: string | null;
  dispatchStatus: "blocked" | "unconfirmed" | "commandAccepted" | "rejected" | null;
  dispatchPhase: "create" | "start" | null; dispatchDetail: string | null; dispatchRecordedAt: string | null;
  state: "armed" | "pending" | "cancelled" | "blocked" | "unconfirmed" | "commandAccepted" | "rejected";
};

export type DeliveryHookReceipt = Omit<DeliveryTestHook, "sourceTaskSlug" | "targetTaskSlug">;

export function validateDeliveryHookReceipt(value: unknown, project: string): asserts value is DeliveryHookReceipt {
  if (typeof value !== "object" || value === null) throw new Error("Invalid delivery hooks");
  const hook = value as Record<string, unknown>;
  if (["id", "project", "sourceRunId", "targetRunId", "targetPackageId", "commitSha", "configuredByUserId", "hostConsumerUserId", "createdAt"].some((field) => typeof hook[field] !== "string" || !hook[field]) ||
    ["configuredByRunId", "deliveryId", "triggeredAt", "cancelledAt", "cancelledByRunId", "cancelledByUserId", "cancellationReason", "retriedAt", "retriedByRunId", "retriedByUserId", "dispatchDetail", "dispatchRecordedAt"].some((field) => hook[field] !== null && typeof hook[field] !== "string") ||
    hook.configuredByRunId === "" || hook.project !== project ||
    !["armed", "pending", "cancelled", "blocked", "unconfirmed", "commandAccepted", "rejected"].includes(hook.state as string) ||
    (hook.dispatchStatus !== null && !["blocked", "unconfirmed", "commandAccepted", "rejected"].includes(hook.dispatchStatus as string)) ||
    (hook.dispatchPhase !== null && hook.dispatchPhase !== "create" && hook.dispatchPhase !== "start")) throw new Error("Invalid delivery hooks");
}

export function validateDeliveryHooks(hooks: unknown, project: string) {
  if (hooks === undefined) return;
  if (!Array.isArray(hooks)) throw new Error("Invalid delivery hooks");
  const ids = new Set<string>();
  for (const hook of hooks) {
    validateDeliveryHookReceipt(hook, project);
    const record = hook as DeliveryTestHook;
    if (!record.sourceTaskSlug || typeof record.sourceTaskSlug !== "string" || !record.targetTaskSlug || typeof record.targetTaskSlug !== "string" || ids.has(record.id)) throw new Error("Invalid delivery hooks");
    ids.add(record.id);
  }
}

export type CurrentView = {
  readOnlyTransport?: boolean;
  project: string;
  generatedAt: string;
  projectBinding?: ProjectBinding | null;
  readySpecSlugs?: string[];
  nodeMarks?: NodeMark[];
  nodeEventCounts?: Array<{ taskSlug: string; retries: number; reworks: number; gitUndos?: number }>;
  nodeOwners?: Array<{ taskSlug: string; humanOwnerUserId: string | null; pendingOperationId: string | null }>;
  reviewStates?: ReviewStatus[];
  deliveryHooks?: DeliveryTestHook[];
  specs: Array<{
    slug: string;
    title: string;
    stage: string;
    role?: "work" | "summary";
    priority: string;
    version?: number;
    updatedAt?: string;
  }>;
  decisions: Array<{ slug: string; title: string; status: string }>;
  graph: {
    nodes: Array<{ slug: string; label: string; stage: string; title: string; priority: string }>;
    edges: Array<{ from: string; to: string; type: string }>;
  };
  runs: WorkbenchRun[];
  deliveries: Array<{ id: string; runBindingId: string; submittedBy: string; submittedAt: string }>;
  evidence: Array<{
    id: string;
    deliveryId: string;
    kind: string;
    command: string;
    exitCode: number | null;
    verifier: string;
    createdAt: string;
  }>;
  acceptances: Array<{
    id: string;
    deliveryId: string;
    verdict: string;
    approver: string;
    createdAt: string;
    requirementsFingerprint?: string;
    conditions?: unknown;
  }>;
  capabilities: { independentVerification: boolean; discussionAuthorization: boolean; createNode?: boolean; nodeApproval?: boolean; deliveryReview?: boolean; independentReview?: boolean; testReports?: boolean; manualCompletion?: boolean; mailInspection?: boolean; deliveryHooks?: boolean; dependencyEditing?: boolean; dependencyRemoval?: boolean; subdivision?: boolean; runDispatch?: boolean; changePreview?: boolean; nodeMarks?: boolean; nodeEvents?: boolean; abandonNode?: boolean };
};

export function dependencyDirection(edge: CurrentView["graph"]["edges"][number]) {
  if (edge.type === "BLOCKS") return { prerequisite: edge.from, dependent: edge.to };
  if (edge.type === "DEPENDS_ON") return { prerequisite: edge.to, dependent: edge.from };
  return null;
}

export function specColumns(specs: CurrentView["specs"]) {
  // Presentation order follows SpecGraph's SpecStage; no runtime state is inferred.
  const stages = [
    "summary",
    "spark",
    "shape",
    "specify",
    "decompose",
    "approved",
    "in_progress",
    "review",
    "done",
    "superseded",
    "abandoned",
  ];
  const groups = new Map<string, CurrentView["specs"]>();
  for (const spec of specs) {
    const stage = spec.role === "summary" ? "summary" : spec.stage;
    const group = groups.get(stage);
    if (group) group.push(spec);
    else groups.set(stage, [spec]);
  }
  return [...groups].sort(([a], [b]) => {
    const aRank = stages.indexOf(a);
    const bRank = stages.indexOf(b);
    return (
      (aRank < 0 ? stages.length : aRank) - (bRank < 0 ? stages.length : bRank) ||
      a.localeCompare(b)
    );
  });
}

export function workProgress(specs: CurrentView["specs"]) {
  const result = { current: 0, completed: 0, withdrawn: 0, summaries: 0 };
  for (const spec of specs) {
    if (spec.role === "summary") result.summaries++;
    else if (spec.stage === "abandoned" || spec.stage === "superseded") result.withdrawn++;
    else {
      result.current++;
      if (spec.stage === "done") result.completed++;
    }
  }
  return result;
}

export function evidenceResult(exitCode: number | null) {
  return exitCode === null ? "unknown" : exitCode === 0 ? "command-succeeded" : "command-failed";
}

export function latestAcceptance(records: CurrentView["acceptances"], deliveryId: string) {
  // The backend orders by created_at, id, preserving PostgreSQL microsecond precision.
  return records.findLast((record) => record.deliveryId === deliveryId);
}

export function taskRejectionCounts(data: Pick<CurrentView, "runs" | "deliveries" | "acceptances">) {
  const tasks = new Map(data.runs.map((run) => [run.id, run.taskSlug]));
  const deliveries = new Map(data.deliveries.map((delivery) => [delivery.id, tasks.get(delivery.runBindingId)]));
  const counts = new Map<string, number>();
  for (const review of data.acceptances) {
    const task = deliveries.get(review.deliveryId);
    if (review.verdict === "rejected" && task !== undefined) counts.set(task, (counts.get(task) ?? 0) + 1);
  }
  return counts;
}

export function taskRecords(data: CurrentView, selected: string | null) {
  const runs = selected ? data.runs.filter((run) => run.taskSlug === selected) : data.runs;
  const runIds = new Set(runs.map((run) => run.id));
  const deliveries = selected
    ? data.deliveries.filter((delivery) => runIds.has(delivery.runBindingId))
    : data.deliveries;
  const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));
  return {
    runs,
    deliveries,
    evidence: selected
      ? data.evidence.filter((entry) => deliveryIds.has(entry.deliveryId))
      : data.evidence,
  };
}
export type WorkbenchSearch = {
  project?: string;
  tab?: "overview" | "tasks" | "sessions" | "pending" | "acceptance" | "collaboration" | "knowledge";
  selected?: string;
  runId?: string;
  mailThread?: string;
  layout?: "graph" | "table" | "board";
};

export function validateWorkbenchSearch(raw: Record<string, unknown>): WorkbenchSearch {
  const project = typeof raw.project === "string" && raw.project.trim() ? raw.project : undefined;
  if (!project) return {};
  return {
    project,
    ...(raw.layout === "graph" || raw.layout === "table" || raw.layout === "board"
      ? { layout: raw.layout }
      : {}),
    ...(typeof raw.tab === "string" &&
    ["overview", "tasks", "sessions", "pending", "acceptance", "collaboration", "knowledge"].includes(raw.tab)
      ? { tab: raw.tab as NonNullable<WorkbenchSearch["tab"]> }
      : {}),
    ...(typeof raw.selected === "string" && raw.selected.trim() ? { selected: raw.selected } : {}),
    ...(raw.tab === "sessions" && typeof raw.selected === "string" && raw.selected.trim() && typeof raw.runId === "string" && raw.runId.trim() ? { runId: raw.runId } : {}),
    ...(typeof raw.mailThread === "string" && raw.mailThread.trim() ? { mailThread: raw.mailThread } : {}),
  };
}
