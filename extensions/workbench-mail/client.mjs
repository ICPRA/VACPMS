import { commandWorkbench } from "../workbench-desktop/read-node.mjs";

export async function requestHostHook(connection, context, operation, payload, signal) {
  const fields = operation === "host-list-hooks" ? ["limit", "cursor"]
    : ["host-read-completion-hook", "host-authorize-completion-hook"].includes(operation) ? ["hookId"]
    : operation === "host-result-completion-hook" ? ["hookId", "status", "detail"] : null;
  if (!fields || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("Unsupported host hook operation or field");
  if (operation === "host-result-completion-hook" && !["blocked", "unconfirmed"].includes(payload.status)) {
    throw new Error("Unsupported completion hook result status");
  }
  if (!connection.executable) throw new Error("Host hooks require local transport");
  const response = await commandWorkbench({ executable: connection.executable, config: connection.config,
    project: connection.project, credential: connection.token, operation,
    body: { ...payload, environmentId: context.environmentId, nativeProjectId: context.nativeProjectId },
  }, signal);
  return response.error ? { error: response.error } : { data: response.data };
}

export async function requestHostProgramRun(connection, context, operation, payload, signal) {
  const fields = ["host-read-program-run", "host-authorize-program-run", "host-complete-program-run"].includes(operation) ? ["runId"]
    : operation === "host-result-program-run" ? ["runId", "observation"]
    : operation === "host-result-program-attempt" ? ["runId", "attemptId", "observation"]
    : operation === "host-authorize-next-program-attempt" ? ["runId", "expectedPreviousAttemptId"]
    : operation === "host-stop-program-loop" ? ["runId", "reason"]
    : operation === "host-read-program-loop-history" ? ["runId", "attemptCursor", "eventCursor"] : null;
  if (!fields || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("Unsupported host program run operation or field");
  if (operation === "host-result-program-run" || operation === "host-result-program-attempt") {
    const observationFields = ["outcome", "exitCode", "observedAt", "startedAt", "finishedAt", "timedOutAt", "cancelRequestedAt", "summary"];
    if (!payload.observation || typeof payload.observation !== "object" || Array.isArray(payload.observation) ||
      Object.keys(payload.observation).some((key) => !observationFields.includes(key))) throw new Error("Unsupported host program observation field");
  }
  if (!connection.executable) throw new Error("Host program runs require local transport");
  if (!connection.project) throw new Error("Host program runs require an explicit project");
  const response = await commandWorkbench({ executable: connection.executable, config: connection.config,
    project: connection.project, credential: connection.token, operation,
    body: { ...payload, environmentId: context.environmentId, nativeProjectId: context.nativeProjectId },
  }, signal);
  return response.error ? { error: response.error } : { data: response.data };
}

export async function requestHostDeliveryHook(connection, context, operation, payload, signal) {
  const fields = operation === "host-list-delivery-hooks" ? ["limit", "cursor"]
    : ["host-read-delivery-hook", "host-bind-delivery-hook", "host-authorize-delivery-hook"].includes(operation) ? ["hookId"]
    : operation === "host-result-delivery-hook" ? ["hookId", "status", "phase", "detail"] : null;
  if (!fields || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("Unsupported host delivery hook operation or field");
  if (!connection.executable) throw new Error("Host delivery hooks require local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: { ...payload, environmentId: context.environmentId, nativeProjectId: context.nativeProjectId },
    }, signal);
  } catch { throw new Error("Host delivery hook transport outcome is unconfirmed"); }
  return response.error ? { error: { code: response.error.code } } : { data: response.data };
}

// Internal host calls: model tools never supply scope, native target IDs or credentials.
export async function requestManagerDispatch(connection, context, operation, payload, signal) {
  const fields = operation === "pm-prepare-run" ? ["task_slug", "workspace", "idempotency_key", "dispatch_target"]
    : operation === "pm-bind-run" ? ["runId", "thread_ref", "environment_id"]
    : operation === "pm-authorize-run" ? ["runId", "packageId", "target"]
    : operation === "pm-read-preparation" ? ["runId", "idempotency_key"] : null;
  if (!fields || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("Unsupported manager dispatch operation or field");
  if (!connection.executable) throw new Error("Manager dispatch requires local transport");
  const { runId, ...request } = payload;
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: { ...(runId === undefined ? {} : { runId }), request,
        scope: { environment_id: context.environmentId, thread_id: context.threadId,
          provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch { throw new Error("Manager dispatch outcome unconfirmed; recover the original preparation before another action"); }
  return response.error ? { error: { code: response.error.code } } : { data: response.data };
}

const sourceAllowed = (source) => source && typeof source === "object" && !Array.isArray(source) &&
  (source.kind === "specgraph" || source.kind === "git") &&
  Object.keys(source).every((key) => (source.kind === "specgraph"
    ? ["kind", "specSlug", "field", "changeId"] : ["kind", "environmentId", "repositoryRoot", "commitSha", "path", "entry"]).includes(key));

export async function requestManagerPlan(connection, context, operation, payload, signal) {
  const summary = ["pm-summary-disposition", "pm-accept-summary", "pm-revoke-summary-acceptance"].includes(operation);
  const fields = operation === "pm-summary-disposition" ? ["goalSlug", "affectedSlug", "disposition", "replacementSlug", "reviewDecisionId", "beforeSources", "afterSources", "reason", "idempotencyKey"]
    : operation === "pm-accept-summary" ? ["goalSlug", "basis", "evidenceSources", "goalsSatisfied", "idempotencyKey", "expectedReferences", "impactReview"]
    : operation === "pm-revoke-summary-acceptance" ? ["acceptanceId", "reason"]
    : operation === "pm-create-node" ? ["slug", "intent", "priority", "complexity"]
    : operation === "pm-merge-nodes" ? ["expected", "target", "relations", "addedRelations", "dispositions", "reason", "idempotencyKey"]
    : operation === "pm-report-flow-arm" ? ["idempotencyKey", "conditions", "branches", "candidateAttemptId"]
    : operation === "pm-report-judgment-record" ? ["flowId", "conditionKey", "expectedJudgmentId", "value", "inputRefs", "reason"]
    : operation === "pm-report-join-arm" ? ["flowId", "runId", "mode", "allowEmptySkip"]
    : operation === "pm-candidate-loop-arm" ? ["runId", "maxAttempts", "planSources", "join", "terminationKind", "satisfactionCriterion"]
    : operation === "pm-candidate-satisfaction-record" ? ["runId", "attemptId", "expectedJudgmentId", "value", "reason"]
    : operation === "pm-candidate-loop-stop" ? ["runId", "reason"]
    : operation === "pm-report-flow-cancel" ? ["flowId", "reason"]
    : operation === "pm-arm-delivery-hook" ? ["sourceRunId", "targetRunId", "commitSha", "idempotencyKey", "deliveryId"]
    : operation === "pm-read-delivery-hook" ? ["hookId"]
    : operation === "pm-list-delivery-hooks" ? ["limit", "cursor"]
    : operation === "pm-cancel-delivery-hook" || operation === "pm-retry-delivery-hook" ? ["hookId", "reason"]
    : operation === "pm-subdivide-node" ? ["taskSlug", "expectedVersion", "reason", "children"]
    : operation === "pm-approve-node" ? ["taskSlug", "expectedVersion", "basis"]
    : operation === "pm-set-node-mark" ? ["taskSlug", "kind", "value", "reason", "expectedMarkId"]
    : operation === "pm-record-program-loop-decision" ? ["runId", "attemptId", "value", "basis", "expectedJudgmentId"]
    : operation === "pm-stop-program-loop" ? ["runId", "reason"]
    : operation === "pm-add-dependency" || operation === "pm-remove-dependency"
      ? ["taskSlug", "prerequisite", "expected_version", "expected_prerequisite_version", "expected_revision", "reason"] : null;
  if (!fields || Object.keys(payload).some((key) => !fields.includes(key))) throw new Error("Unsupported planning operation or field");
  if (operation === "pm-report-flow-arm") {
    if (!Array.isArray(payload.conditions) || !Array.isArray(payload.branches) ||
      payload.conditions.some((condition) => !condition || typeof condition !== "object" || Array.isArray(condition) ||
        Object.keys(condition).some((key) => !["key", "kind", "report", "judgment"].includes(key)) ||
        (condition.kind === "report" && (condition.judgment !== undefined || !condition.report ||
          typeof condition.report !== "object" || Array.isArray(condition.report) ||
          Object.keys(condition.report).some((key) => !["deliveryId", "planSource", "inputSources"].includes(key)) ||
          !sourceAllowed(condition.report.planSource) || !Array.isArray(condition.report.inputSources) ||
          condition.report.inputSources.some((source) => !sourceAllowed(source)))) ||
        (condition.kind === "judgment" && (condition.report !== undefined || !condition.judgment ||
          typeof condition.judgment !== "object" || Array.isArray(condition.judgment) ||
          Object.keys(condition.judgment).some((key) => !["criterion", "inputSources", "deliveryId"].includes(key)) ||
          !Array.isArray(condition.judgment.inputSources) ||
          condition.judgment.inputSources.some((source) => !sourceAllowed(source)))) ||
        !["report", "judgment"].includes(condition.kind)) ||
      payload.branches.some((branch) => !branch || typeof branch !== "object" || Array.isArray(branch) ||
        Object.keys(branch).some((key) => !["runId", "conditionKey", "when"].includes(key)))) {
      throw new Error("Unsupported report flow input field");
    }
  }
  if (operation === "pm-report-judgment-record" &&
    (!Array.isArray(payload.inputRefs) || payload.inputRefs.some((source) => !sourceAllowed(source)))) {
    throw new Error("Unsupported judgment input reference");
  }
  if (operation === "pm-candidate-loop-arm" && payload.join !== undefined &&
    (!payload.join || typeof payload.join !== "object" || Array.isArray(payload.join) ||
      Object.keys(payload.join).some((key) => !["mode", "allowEmptySkip"].includes(key)))) {
    throw new Error("Unsupported candidate join field");
  }
  if (operation === "pm-candidate-loop-arm" && (payload.terminationKind === "report"
    ? payload.satisfactionCriterion !== undefined
    : payload.terminationKind !== "satisfaction" || typeof payload.satisfactionCriterion !== "string" || !payload.satisfactionCriterion.trim())) {
    throw new Error("Unsupported candidate termination policy");
  }
  if (!connection.executable) throw new Error("Project planning requires local transport");
  const { taskSlug, ...request } = payload;
  if (operation === "pm-add-dependency" || operation === "pm-remove-dependency") {
    request.idempotency_key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: { ...(taskSlug === undefined ? {} : { taskSlug }), request,
        scope: { environment_id: context.environmentId, thread_id: context.threadId,
          provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch (cause) {
    if (summary) throw cause;
    throw new Error("Planning outcome unconfirmed; inspect the original operation record before another action");
  }
  if (response.error) throw new Error(summary ? `${response.error.code}: ${response.error.message}` : `Planning request rejected (${response.error.code})`);
  return response.data;
}

export async function requestOwnDelivery(connection, context, operation, payload, signal) {
  const allowed = operation === "delivery-self-context" || operation === "delivery-hook-context" ? []
    : operation === "delivery-submit-self" ? ["expectedRunId", "summary", "head", "expectedAttemptId"]
    : operation === "candidate-next-own" ? ["expectedPreviousAttemptId"] : null;
  if (!allowed || Object.keys(payload).some((field) => !allowed.includes(field))) throw new Error("Unsupported own-delivery operation or field");
  if (!connection.executable) throw new Error("Own delivery requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: { ...payload, scope: { environment_id: context.environmentId, thread_id: context.threadId,
        provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch {
    throw new Error(operation === "delivery-hook-context" ? "Delivery hook context unavailable"
      : operation === "delivery-self-context" ? "Own delivery context unavailable; nothing submitted"
      : operation === "candidate-next-own" ? "Candidate next outcome unconfirmed; read the original loop before another action"
      : "Delivery outcome unconfirmed; inspect node deliveries before another action");
  }
  if (response.error) throw new Error(`${operation === "candidate-next-own" ? "Candidate next" : "Own delivery"} request rejected (${response.error.code})`);
  return response.data;
}

export async function requestOwnNodeEvent(connection, context, payload, signal) {
  const fields = payload.kind === "retry" ? ["eventId", "kind", "reason", "previousRunId"]
    : payload.kind === "rework" ? ["eventId", "kind", "reason", "deliveryId"]
    : payload.kind === "git_undo" ? ["eventId", "kind", "reason", "gitUndo", "expectedRunId"] : null;
  if (!fields || Object.keys(payload).some((field) => !fields.includes(field))) {
    throw new Error("Unsupported own node event field");
  }
  if (payload.kind === "rework" && !Object.hasOwn(payload, "deliveryId")) {
    throw new Error("Rework requires deliveryId");
  }
  if (payload.kind === "git_undo" && (typeof payload.expectedRunId !== "string" || !payload.expectedRunId.trim() ||
    !payload.gitUndo || typeof payload.gitUndo !== "object" || Array.isArray(payload.gitUndo) ||
    Object.keys(payload.gitUndo).some((field) => !["operation", "sourceCommit", "resultCommit"].includes(field)))) {
    throw new Error("Unsupported git undo reference or missing expectedRunId");
  }
  if (!connection.executable) throw new Error("Own node events require local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation: "record-own-node-event",
      body: { request: payload, scope: { environment_id: context.environmentId, thread_id: context.threadId,
        provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch { throw new Error("Node event outcome unconfirmed; read the task's original events before another action"); }
  if (response.error) throw new Error(`Node event request rejected (${response.error.code})`);
  return response.data;
}

export async function requestOwnCandidateSatisfaction(connection, context, payload, signal) {
  const fields = ["attemptId", "expectedJudgmentId", "value", "reason"];
  if (Object.keys(payload).some((field) => !fields.includes(field)) || !Object.hasOwn(payload, "expectedJudgmentId")) {
    throw new Error("Unsupported own candidate satisfaction field");
  }
  if (!connection.executable) throw new Error("Own candidate satisfaction requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation: "candidate-satisfaction-own",
      body: { request: payload, scope: { environment_id: context.environmentId, thread_id: context.threadId,
        provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch { throw new Error("Candidate satisfaction outcome unconfirmed; read the original history before another action"); }
  if (response.error) throw new Error(`Candidate satisfaction rejected (${response.error.code})`);
  return response.data;
}

export async function requestOwnNodeHandoffSummary(connection, context, payload, signal) {
  if (Object.keys(payload).some((field) => !["eventId", "message"].includes(field))) {
    throw new Error("Unsupported own handoff summary field");
  }
  if (!connection.executable) throw new Error("Own handoff summary requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation: "node-handoff-summary-own",
      body: { nativeProjectId: context.nativeProjectId, request: payload,
        scope: { environment_id: context.environmentId, thread_id: context.threadId,
        provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch { throw new Error("Handoff summary outcome unconfirmed; read the original node owner state before another action"); }
  if (response.error) throw new Error(`Handoff summary rejected (${response.error.code})`);
  return response.data;
}

export async function completeOwnRun(connection, context, signal) {
  if (!connection.executable) throw new Error("Run completion requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation: "run-complete-self",
      body: { scope: { environment_id: context.environmentId, thread_id: context.threadId,
        provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch {
    throw new Error("Run completion outcome unconfirmed; inspect task state before another action");
  }
  if (response.error) throw new Error(`Run completion rejected (${response.error.code})`);
  return response.data;
}

export async function requestTests(connection, context, operation, payload, signal) {
  const allowed = operation === "test-results" ? ["deliveryId", "cursor"]
    : operation === "test-result-submit" ? ["deliveryId", "commitSha", "planSources", "status", "command", "exitCode", "summary", "outputRefs"] : null;
  if (!allowed || Object.keys(payload).some((field) => !allowed.includes(field))) throw new Error("Unsupported test report operation or payload field");
  if (!connection.executable) throw new Error("Test reports require local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: operation === "test-results"
        ? { ...payload, environment_id: context.environmentId, native_project_id: context.nativeProjectId }
        : { ...payload, scope: { environment_id: context.environmentId, thread_id: context.threadId,
          provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch {
    throw new Error("Test report request failed or was cancelled; outcome unconfirmed. Read reports before deciding another action");
  }
  if (response.error) throw new Error(`Test report request rejected (${response.error.code})`);
  return response.data;
}

export async function requestReview(connection, context, operation, payload, signal) {
  const allowed = operation === "review-status" ? ["taskSlug"]
    : operation === "review-request-source" ? ["requestId", "decisionId"]
    : operation === "review-delivery-source" ? ["deliveryId"]
    : operation === "review-assign" ? ["taskSlug", "kind", "sources", "authorResponsibility", "requirementDecisionIds", "reviewerRunId", "completionRunId"]
    : operation === "review-submit" ? ["requestId", "verdict", "basis"] : null;
  if (!allowed || Object.keys(payload).some((field) => !allowed.includes(field))) {
    throw new Error("Unsupported review operation or payload field");
  }
  if (operation === "review-request-source" && Object.hasOwn(payload, "requestId") === Object.hasOwn(payload, "decisionId")) {
    throw new Error("Supply exactly one review requestId or decisionId");
  }
  if (!connection.executable) throw new Error("Project review requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: operation === "review-status" || operation === "review-delivery-source" || operation === "review-request-source"
        ? { ...payload, environment_id: context.environmentId, native_project_id: context.nativeProjectId }
        : { ...payload, scope: { environment_id: context.environmentId, thread_id: context.threadId,
          provider_session_id: context.providerSessionId, provider_instance_id: context.providerInstanceId } },
    }, signal);
  } catch {
    throw new Error("Project review request failed or was cancelled; outcome unconfirmed. Read review status before deciding another action");
  }
  if (response.error) throw new Error(`Project review rejected (${response.error.code})`);
  return response.data;
}

/** Project identity comes from the authenticated native thread, not mailbox enrollment. */
export async function requestProjectKnowledge(connection, context, operation, payload, signal) {
  const allowed = operation === "summary-status" ? ["goalSlug"]
    : operation === "summary-history" ? ["goalSlug", "kind", "cursor"]
    : operation === "knowledge-search" ? ["query"]
    : operation === "knowledge-record" ? ["kind", "reference", "expectedProject"]
    : operation === "conversation-runs" ? ["threadId", "cursor"]
    : operation === "node-deliveries" ? ["taskSlug", "cursor"]
    : operation === "node-events" ? ["taskSlug", "cursor"]
    : operation === "node-owner-read" ? ["taskSlug"]
    : operation === "node-mark-history" ? ["taskSlug", "cursor"]
    : operation === "dependency-state" ? ["taskSlug"]
    : operation === "graph-current" ? ["offset"]
    : operation === "preview-node-merge" ? ["sourceSlugs", "contextSlugs"]
    : operation === "node-merge-history" ? ["taskSlug", "beforeId"]
    : operation === "node-merge-receipt" ? ["id"]
    : operation === "program-loop-read" ? ["runId"]
    : operation === "program-loop-history" ? ["runId", "attemptCursor", "eventCursor"]
    : operation === "report-flow-read" ? ["flowId", "runId"]
    : operation === "report-join-read" ? ["runId"]
    : operation === "report-judgment-history" ? ["flowId", "conditionKey", "cursor"]
    : operation === "candidate-loop-read" ? ["runId"]
    : operation === "candidate-satisfaction-history" ? ["runId", "attemptId", "judgmentCursor", "interventionCursor"] : null;
  if (!allowed || Object.keys(payload).some((field) => !allowed.includes(field))) {
    throw new Error("Unsupported project knowledge operation or payload field");
  }
  if (operation === "report-flow-read" && Object.hasOwn(payload, "flowId") === Object.hasOwn(payload, "runId")) {
    throw new Error("Supply exactly one report flowId or runId");
  }
  if (!connection.executable) throw new Error("Project knowledge requires local transport");
  let response;
  try {
    response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation,
      body: { ...(operation === "summary-history" ? { goalSlug: payload.goalSlug, kind: payload.kind,
        ...(payload.cursor === undefined ? {} : { beforeId: payload.cursor }) } : payload),
        environment_id: context.environmentId, native_project_id: context.nativeProjectId },
    }, signal);
  } catch (cause) {
    if (operation === "summary-status" || operation === "summary-history") throw cause;
    throw new Error("Project knowledge request failed or was cancelled");
  }
  if (response.error) throw new Error(operation === "summary-status" || operation === "summary-history" ? `${response.error.code}: ${response.error.message}` : `Project knowledge rejected (${response.error.code})`);
  return response.data;
}

const operationFields = {
  context: [],
  directory: ["limit", "cursor", "assignment_role"],
  send: ["mail_thread_id", "subject", "body", "recipient_run_ids", "idempotency_key", "references"],
  inbox: ["limit", "cursor"],
  thread: ["mail_thread_id", "limit", "cursor"],
  read: ["message_id"],
  ack: ["message_id"],
  close: ["mail_thread_id", "resolution"],
  handoff: ["mail_thread_id", "recipient_run_id", "body", "idempotency_key"],
  owned: ["limit", "cursor"],
  retired: ["limit", "cursor"],
  "owner-history": ["mail_thread_id", "limit", "cursor"],
  takeover: ["mail_thread_id", "recipient_run_id", "body", "idempotency_key"],
};

/** Server-only: connection is host configuration, invocation is authenticated
 * T3 McpInvocationContext, never model arguments. No credentials are loaded,
 * persisted, logged, or passed to a provider by this module. */
export async function requestMail(connection, invocation, operation, payload, signal) {
  const allowed = Object.hasOwn(operationFields, operation) ? operationFields[operation] : null;
  if (!allowed || Object.keys(payload).some((field) => !allowed.includes(field))) {
    throw new Error("Unsupported mailbox operation or payload field");
  }
  if (connection.executable) {
    const response = await commandWorkbench({ executable: connection.executable, config: connection.config,
      project: connection.project, credential: connection.token, operation: `mail-${operation}`,
      body: { ...payload, scope: { environment_id: invocation.environmentId, thread_id: invocation.threadId,
        provider_session_id: invocation.providerSessionId, provider_instance_id: invocation.providerInstanceId } },
    }, signal);
    if (response.error) throw new Error(`Mailbox ${operation} rejected (${response.error.code})`);
    return validateMailResult(response.data, operation, payload);
  }
  let endpoint;
  if (operation === "context") throw new Error("Bound mailbox context requires local transport");
  if (operation === "directory") throw new Error("Mailbox directory requires local transport");
  if (operation === "handoff") throw new Error("Mailbox handoff requires local transport");
  if (operation === "owned") throw new Error("Owned mailbox threads require local transport");
  if (["retired", "owner-history", "takeover"].includes(operation)) throw new Error("Mailbox ownership management requires local transport");
  try {
    endpoint = new URL(connection.endpoint);
  } catch {
    throw new Error("Mailbox endpoint must be a loopback HTTP origin");
  }
  if (endpoint.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname) ||
      endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      endpoint.pathname !== "/") {
    throw new Error("Mailbox endpoint must be a loopback HTTP origin");
  }
  endpoint.pathname = `/loop/mail/${operation}`;
  const timeout = AbortSignal.timeout(15_000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${connection.token}`,
        "X-Specgraph-Project": connection.project,
      },
      body: JSON.stringify({
        ...payload,
        scope: {
          environment_id: invocation.environmentId,
          thread_id: invocation.threadId,
          provider_session_id: invocation.providerSessionId,
          provider_instance_id: invocation.providerInstanceId,
        },
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch {
    // No raw fetch cause: it can expose credentials or request content.
    throw new Error("Mailbox request failed or was cancelled; delivery is unconfirmed");
  }
  if (!response.ok) throw new Error(`Mailbox ${operation} rejected (HTTP ${response.status})`);
  try {
    const result = await response.json();
    return validateMailResult(result, operation, payload);
  } catch {
    throw new Error("Mailbox returned an invalid response; delivery is unconfirmed");
  }
}

function validateMailResult(result, operation, payload) {
    const object = result !== null && typeof result === "object" && !Array.isArray(result);
    if (operation === "owned" || operation === "retired") {
      if (!object || !Array.isArray(result.threads) || typeof result.next_cursor !== "string" ||
        !result.threads.every((thread) => thread && thread.closed_at === null &&
          [thread.id, thread.task_slug, thread.subject, thread.opened_by_run, thread.owner_run].every((value) => typeof value === "string" && value.length > 0))) {
        throw new Error("Invalid owned-thread response");
      }
      return result;
    }
    if (operation === "owner-history") {
      if (!object || !Array.isArray(result.events) || typeof result.next_cursor !== "string" ||
        result.events.some((event) => event?.thread_id !== payload.mail_thread_id)) throw new Error("Invalid owner history response");
      return result;
    }
    if (operation === "takeover") {
      if (!object || result.thread?.id !== payload.mail_thread_id || typeof result.thread.owner_run !== "string" ||
        result.event?.thread_id !== payload.mail_thread_id || result.event.to_run !== payload.recipient_run_id ||
        result.event.reason !== payload.body || result.event.actor_kind !== "agent" ||
        typeof result.event.actor_user_id !== "string" || !result.event.actor_user_id ||
        typeof result.event.actor_run_id !== "string" || !result.event.actor_run_id) throw new Error("Invalid takeover receipt; outcome unconfirmed");
      return result;
    }
    const valid = object && (operation === "directory" ? Array.isArray(result.contacts) && typeof result.next_cursor === "string" && result.contacts.every((entry) => entry && typeof entry.run_id === "string" && entry.run_id.length > 0 && typeof entry.task_slug === "string" && entry.task_slug.length > 0 && (entry.assignment_role === null || typeof entry.assignment_role === "string")) : operation === "context" ? [result.project, result.run_id, result.task_slug].every((value) => typeof value === "string" && value.length > 0) : operation === "send" || operation === "handoff"
      ? typeof result.thread?.id === "string" && typeof result.message?.id === "string"
      : operation === "inbox" || operation === "thread"
        ? Array.isArray(result.items) && typeof result.next_cursor === "string" &&
          (operation !== "thread" || typeof result.thread?.id === "string")
        : operation === "close"
          ? typeof result.id === "string" && typeof result.closed_at === "string"
          : [result.read_at, result.acknowledged_at].every((value) => value === null || typeof value === "string") &&
            typeof result[operation === "read" ? "read_at" : "acknowledged_at"] === "string");
    if (!valid) throw new Error("Invalid mailbox response envelope");
    if (operation === "handoff" && (
      result.thread.id !== payload.mail_thread_id || result.message.thread_id !== payload.mail_thread_id ||
      ![result.thread.owner_run, result.thread.opened_by_run].every((id) => typeof id === "string" && id.length > 0) ||
      result.message.handoff_to_run !== payload.recipient_run_id || result.message.body !== payload.body ||
      result.message.idempotency_key !== payload.idempotency_key ||
      !Array.isArray(result.message.recipient_run_ids) || result.message.recipient_run_ids.length !== 1 || result.message.recipient_run_ids[0] !== payload.recipient_run_id
    )) throw new Error("Invalid handoff receipt; outcome unconfirmed");
    if (operation === "send" && payload.references?.length) {
      const references = result.message.references;
      if (!Array.isArray(references) || references.length !== payload.references.length ||
          !payload.references.every((source) => references.some((entry) =>
            entry.message_id === source.message_id && entry.kind === source.kind &&
            [entry.thread_id, entry.task_slug, entry.sender_run_id, entry.subject, entry.body, entry.created_at]
              .every((field) => typeof field === "string")))) {
        throw new Error("Missing contextual mail receipt");
      }
    }
    return result;
}
