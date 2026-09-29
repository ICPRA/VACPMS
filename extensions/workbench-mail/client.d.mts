export type MailOperation = "context" | "directory" | "owned" | "retired" | "owner-history" | "takeover" | "send" | "handoff" | "inbox" | "thread" | "read" | "ack" | "close";
export type HostHookOperation = "host-list-hooks" | "host-read-completion-hook" | "host-authorize-completion-hook" | "host-result-completion-hook";
export function requestHostHook(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string },
  operation: HostHookOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<{ data?: unknown; error?: { code: string; message: string } }>;
export type HostProgramRunOperation = "host-read-program-run" | "host-authorize-program-run" | "host-result-program-run" | "host-complete-program-run" | "host-result-program-attempt" | "host-authorize-next-program-attempt" | "host-stop-program-loop" | "host-read-program-loop-history";
export function requestHostProgramRun(
  connection: MailConnection & { readonly project: string },
  context: { readonly environmentId: string; readonly nativeProjectId: string },
  operation: HostProgramRunOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<{ data?: unknown; error?: { code: string; message: string } }>;
export type HostDeliveryHookOperation = "host-list-delivery-hooks" | "host-read-delivery-hook" | "host-bind-delivery-hook" | "host-authorize-delivery-hook" | "host-result-delivery-hook";
export function requestHostDeliveryHook(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string },
  operation: HostDeliveryHookOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<{ data?: unknown; error?: { code: string } }>;
export type KnowledgeOperation = "preview-node-merge" | "node-merge-history" | "node-merge-receipt" | "summary-status" | "summary-history" | "knowledge-search" | "knowledge-record" | "conversation-runs" | "node-deliveries" | "node-events" | "node-owner-read" | "node-mark-history" | "dependency-state" | "graph-current" | "program-loop-read" | "program-loop-history" | "report-flow-read" | "report-join-read" | "report-judgment-history" | "candidate-loop-read" | "candidate-satisfaction-history";
export type ManagerPlanOperation = "pm-merge-nodes" | "pm-summary-disposition" | "pm-accept-summary" | "pm-revoke-summary-acceptance" | "pm-create-node" | "pm-subdivide-node" | "pm-approve-node" | "pm-set-node-mark" | "pm-add-dependency" | "pm-remove-dependency" | "pm-arm-delivery-hook" | "pm-read-delivery-hook" | "pm-list-delivery-hooks" | "pm-cancel-delivery-hook" | "pm-retry-delivery-hook" | "pm-record-program-loop-decision" | "pm-stop-program-loop" | "pm-report-flow-arm" | "pm-report-flow-cancel" | "pm-report-join-arm" | "pm-report-judgment-record" | "pm-candidate-loop-arm" | "pm-candidate-loop-stop" | "pm-candidate-satisfaction-record";
export type ManagerDispatchOperation = "pm-prepare-run" | "pm-bind-run" | "pm-authorize-run" | "pm-read-preparation";
export function requestManagerDispatch(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: ManagerDispatchOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<{ data?: unknown; error?: { code: string } }>;
export function requestManagerPlan(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: ManagerPlanOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export type ReviewOperation = "review-status" | "review-request-source" | "review-delivery-source" | "review-assign" | "review-submit";
export type TestOperation = "test-results" | "test-result-submit";
export function requestOwnDelivery(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: "delivery-self-context" | "delivery-submit-self" | "delivery-hook-context" | "candidate-next-own",
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function requestOwnNodeEvent(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function requestOwnCandidateSatisfaction(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function requestOwnNodeHandoffSummary(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function completeOwnRun(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  signal?: AbortSignal,
): Promise<unknown>;
export function requestTests(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: TestOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function requestReview(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: ReviewOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export function requestProjectKnowledge(
  connection: MailConnection,
  context: { readonly environmentId: string; readonly nativeProjectId: string },
  operation: KnowledgeOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
export type MailConnection = { readonly token: string; readonly project?: string | undefined } &
  ({ readonly endpoint: string } | { readonly executable: string; readonly config: string });
export function requestMail(
  connection: MailConnection,
  invocation: { readonly environmentId: string; readonly threadId: string; readonly providerSessionId: string; readonly providerInstanceId: string },
  operation: MailOperation,
  payload: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Promise<unknown>;
