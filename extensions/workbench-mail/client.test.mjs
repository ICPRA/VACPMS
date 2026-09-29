import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { PassThrough, Writable } from "node:stream";
import { completeOwnRun, requestOwnDelivery, requestOwnNodeEvent, requestOwnNodeHandoffSummary, requestOwnCandidateSatisfaction, requestManagerPlan, requestManagerDispatch, requestHostHook, requestHostDeliveryHook, requestHostProgramRun, requestMail, requestProjectKnowledge, requestReview, requestTests } from "./client.mjs";

const connection = { endpoint: "http://127.0.0.1:8690", project: "alpha", token: "test-secret" };
const scope = { environmentId: "env", threadId: "thread", providerSessionId: "session", providerInstanceId: "provider" };
afterEach(() => { mock.restoreAll(); syncBuiltinESMExports(); });

test("node merge uses the original project read and PM write scopes", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { sources: [], contexts: [], relations: [], lineage: [], ancestors: [] } };
  mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const previewInput = { sourceSlugs: ["a", "b"], contextSlugs: ["goal"] };
  assert.deepEqual(await requestProjectKnowledge(local, context, "preview-node-merge", previewInput), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "preview-node-merge", project: "alpha",
    credential: "service-secret", body: { ...previewInput, environment_id: "env", native_project_id: "native-project" } });
  const merge = { expected: reply.data, target: { slug: "c", intent: "Combined", role: "work",
    priority: "p2", complexity: "low" }, relations: [], addedRelations: [], dispositions: [],
    reason: "Agreed content and relations", idempotencyKey: "exact-merge" };
  reply = { data: { id: "merge-1", idempotencyKey: "exact-merge" } };
  assert.deepEqual(await requestManagerPlan(local, scope, "pm-merge-nodes", merge), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "pm-merge-nodes", project: "alpha",
    credential: "service-secret", body: { request: merge, scope: { environment_id: "env", thread_id: "thread",
      provider_session_id: "session", provider_instance_id: "provider" } } });
  for (const [operation, payload] of [["node-merge-history", { taskSlug: "a", beforeId: "merge-2" }],
    ["node-merge-receipt", { id: "merge-1" }]]) {
    assert.deepEqual(await requestProjectKnowledge(local, context, operation, payload), reply.data);
    assert.deepEqual(requests.at(-1).body, { ...payload, environment_id: "env", native_project_id: "native-project" });
  }
  for (const field of ["actor", "scope", "project", "taskSlug", "sourceSlugs"]) {
    await assert.rejects(requestManagerPlan(local, scope, "pm-merge-nodes", { ...merge, [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestProjectKnowledge(local, context, "preview-node-merge", { ...previewInput, project: "other" }), /Unsupported/);
  await assert.rejects(requestManagerPlan(connection, scope, "pm-merge-nodes", merge), /local transport/);
});

test("node owner read and own handoff summary use their separate trusted scopes", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { taskSlug: "task" } };
  const spawn = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const read = { taskSlug: "task" };
  assert.deepEqual(await requestProjectKnowledge(local, context, "node-owner-read", read), reply.data);
  assert.deepEqual(requests.at(-1).body, { taskSlug: "task", environment_id: "env", native_project_id: "native-project" });
  const summary = { eventId: "progress-event", message: "Current phase and remaining work" };
  reply = { data: { eventId: summary.eventId, runId: "bound-run", taskSlug: "task", message: summary.message,
    recordedAt: "now", replayed: false } };
  assert.deepEqual(await requestOwnNodeHandoffSummary(local, context, summary), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "node-handoff-summary-own", project: "alpha",
    credential: "service-secret", body: { nativeProjectId: "native-project", request: summary, scope: { environment_id: "env", thread_id: "thread",
      provider_session_id: "session", provider_instance_id: "provider" } } });
  reply.data.replayed = true;
  assert.deepEqual(await requestOwnNodeHandoffSummary(local, context, summary), reply.data);
  for (const field of ["runId", "taskSlug", "actor", "humanOwnerUserId", "project", "scope", "environment_id", "native_project_id"]) {
    await assert.rejects(requestOwnNodeHandoffSummary(local, context, { ...summary, [field]: "forged" }), /Unsupported/);
    if (field !== "taskSlug") await assert.rejects(requestProjectKnowledge(local, context, "node-owner-read", { ...read, [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestOwnNodeHandoffSummary(connection, context, summary), /local transport/);
  await assert.rejects(requestProjectKnowledge(connection, context, "node-owner-read", read), /local transport/);
  reply = { error: { code: "conflict", message: "private" } };
  await assert.rejects(requestOwnNodeHandoffSummary(local, context, summary), /rejected \(conflict\)/);
  spawn.mock.mockImplementation(() => { throw new Error("private failure"); });
  await assert.rejects(requestOwnNodeHandoffSummary(local, context, summary), /outcome unconfirmed/);
});

test("own node declarations and history keep trusted scope without inferred execution", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { id: "event" } };
  const spawn = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const trustedScope = { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" };
  for (const input of [
    { eventId: "retry-1", kind: "retry", reason: "New formal attempt" },
    { eventId: "retry-2", kind: "retry", reason: "Another owner", previousRunId: "previous-run" },
    { eventId: "rework-1", kind: "rework", reason: "Revised delivered code", deliveryId: "delivery" },
  ]) {
    assert.deepEqual(await requestOwnNodeEvent(local, context, input), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation: "record-own-node-event", project: "alpha",
      credential: "service-secret", body: { scope: trustedScope, request: input } });
  }
  const undo = { eventId: "undo-1", kind: "git_undo", reason: "Declared revert", expectedRunId: "bound-run",
    gitUndo: { operation: "revert", sourceCommit: "a".repeat(40), resultCommit: "b".repeat(40) } };
  assert.deepEqual(await requestOwnNodeEvent(local, context, undo), reply.data);
  assert.deepEqual(requests.at(-1).body, { scope: trustedScope, request: undo });
  const read = { taskSlug: "task", cursor: "event-before" };
  assert.deepEqual(await requestProjectKnowledge(local, context, "node-events", read), reply.data);
  assert.deepEqual(requests.at(-1).body, { ...read, environment_id: "env", native_project_id: "native-project" });
  for (const field of ["actor", "taskSlug", "runId", "currentRunId", "project", "scope", "environment_id", "native_project_id"]) {
    await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "retry-1", kind: "retry", reason: "Reason", [field]: "forged" }), /Unsupported/);
    if (field !== "taskSlug") {
      await assert.rejects(requestProjectKnowledge(local, context, "node-events", { ...read, [field]: "forged" }), /Unsupported/);
    }
  }
  await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "rework-1", kind: "rework", reason: "Reason", previousRunId: "forged" }), /Unsupported/);
  await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "rework-1", kind: "rework", reason: "Reason" }), /requires deliveryId/);
  await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "retry-1", kind: "retry", reason: "Reason", deliveryId: "forged" }), /Unsupported/);
  await assert.rejects(requestOwnNodeEvent(local, context, { ...undo, expectedRunId: undefined }), /Unsupported|missing expectedRunId/);
  await assert.rejects(requestOwnNodeEvent(local, context, { ...undo, gitUndo: { ...undo.gitUndo, actor: "forged" } }), /Unsupported/);
  await assert.rejects(requestOwnNodeEvent(local, context, { ...undo, runId: "forged" }), /Unsupported/);
  await assert.rejects(requestOwnNodeEvent(local, context, { ...undo, kind: "retry" }), /Unsupported/);
  await assert.rejects(requestOwnNodeEvent(connection, context, { eventId: "retry-1", kind: "retry", reason: "Reason" }), /local transport/);
  await assert.rejects(requestProjectKnowledge(connection, context, "node-events", { taskSlug: "task" }), /local transport/);
  reply = { error: { code: "conflict", message: "Already recorded" } };
  await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "retry-1", kind: "retry", reason: "Reason" }), /rejected \(conflict\)/);
  spawn.mock.mockImplementation(() => { throw new Error("private failure"); });
  await assert.rejects(requestOwnNodeEvent(local, context, { eventId: "retry-1", kind: "retry", reason: "Reason" }), /outcome unconfirmed/);
});

test("report flow uses only original PM inputs and host-owned read identity", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { id: "flow" } };
  const spawn = mock.method(childProcess, "spawn", (_executable, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const source = { kind: "specgraph", specSlug: "plan", field: "specify", changeId: "change" };
  const arm = { idempotencyKey: "original-key", conditions: [{ key: "condition", kind: "report",
    report: { deliveryId: "delivery", planSource: source, inputSources: [source] } }],
    branches: [{ runId: "prepared-run", conditionKey: "condition", when: "true" }], candidateAttemptId: "attempt-1" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-flow-arm", arm), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "pm-report-flow-arm", project: "alpha", credential: "service-secret",
    body: { request: arm, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
  const cancel = { flowId: "flow", reason: "Original cancellation" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-flow-cancel", cancel), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: cancel, scope: requests.at(-2).body.scope });
  const join = { flowId: "flow", runId: "join-run", mode: "all", allowEmptySkip: false };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-join-arm", join), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: join, scope: requests.at(-2).body.scope });
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-join-arm", join), reply.data);
  assert.deepEqual(requests.at(-1).body.request, join);
  for (const payload of [{ flowId: "flow" }, { runId: "prepared-run" }]) {
    assert.deepEqual(await requestProjectKnowledge(local, context, "report-flow-read", payload), reply.data);
    assert.deepEqual(requests.at(-1).body, { ...payload, environment_id: "env", native_project_id: "native-project" });
  }
  const judgment = { flowId: "flow", conditionKey: "decision", expectedJudgmentId: null,
    value: "unknown", inputRefs: [source], reason: "Original facts unclear" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-judgment-record", judgment), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: judgment, scope: requests[0].body.scope });
  assert.deepEqual(await requestManagerPlan(local, context, "pm-report-judgment-record", { ...judgment, expectedJudgmentId: "original-judgment" }), reply.data);
  assert.equal(requests.at(-1).body.request.expectedJudgmentId, "original-judgment");
  assert.deepEqual(await requestProjectKnowledge(local, context, "report-judgment-history",
    { flowId: "flow", conditionKey: "decision", cursor: "older" }), reply.data);
  assert.deepEqual(requests.at(-1).body, { flowId: "flow", conditionKey: "decision", cursor: "older",
    environment_id: "env", native_project_id: "native-project" });
  assert.deepEqual(await requestProjectKnowledge(local, context, "report-join-read", { runId: "join-run" }), reply.data);
  assert.deepEqual(requests.at(-1).body, { runId: "join-run", environment_id: "env", native_project_id: "native-project" });
  for (const field of ["project", "scope", "actor", "configuredBy", "receipt", "environment_id", "native_project_id", "packageId", "evaluation", "admission"]) {
    await assert.rejects(requestManagerPlan(local, context, "pm-report-flow-arm", { ...arm, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestManagerPlan(local, context, "pm-report-flow-cancel", { ...cancel, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestProjectKnowledge(local, context, "report-flow-read", { flowId: "flow", [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestManagerPlan(local, context, "pm-report-judgment-record", { ...judgment, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestProjectKnowledge(local, context, "report-judgment-history",
      { flowId: "flow", conditionKey: "decision", [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestManagerPlan(local, context, "pm-report-join-arm", { ...join, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestProjectKnowledge(local, context, "report-join-read", { runId: "join-run", [field]: "forged" }), /Unsupported/);
  }
  for (const forged of [
    { ...arm, conditions: [{ ...arm.conditions[0], evaluation: { value: "true" } }] },
    { ...arm, conditions: [{ ...arm.conditions[0], report: { ...arm.conditions[0].report, planSource: { ...source, actor: "forged" } } }] },
    { ...arm, branches: [{ ...arm.branches[0], packageId: "forged" }] },
    { ...arm, branches: [{ ...arm.branches[0], admission: { id: "forged" } }] },
  ]) await assert.rejects(requestManagerPlan(local, context, "pm-report-flow-arm", forged), /Unsupported/);
  await assert.rejects(requestManagerPlan(local, context, "pm-report-judgment-record", { ...judgment,
    inputRefs: [{ ...source, actor: "forged" }] }), /Unsupported/);
  for (const payload of [{}, { flowId: "flow", runId: "prepared-run" }]) {
    await assert.rejects(requestProjectKnowledge(local, context, "report-flow-read", payload), /exactly one/);
  }
  for (const [operation, payload] of [["pm-report-flow-arm", arm], ["pm-report-flow-cancel", cancel], ["pm-report-join-arm", join],
    ["pm-report-judgment-record", judgment]]) {
    await assert.rejects(requestManagerPlan(connection, context, operation, payload), /local transport/);
  }
  await assert.rejects(requestProjectKnowledge(connection, context, "report-flow-read", { flowId: "flow" }), /local transport/);
  await assert.rejects(requestProjectKnowledge(connection, context, "report-judgment-history", { flowId: "flow", conditionKey: "decision" }), /local transport/);
  await assert.rejects(requestProjectKnowledge(connection, context, "report-join-read", { runId: "join-run" }), /local transport/);
  reply = { error: { code: "conflict", message: "private" } };
  await assert.rejects(requestManagerPlan(local, context, "pm-report-flow-arm", arm), /rejected \(conflict\)/);
  assert.equal(requests.at(-1).body.request.idempotencyKey, "original-key");
  spawn.mock.mockImplementation(() => { throw new Error("private transport"); });
  await assert.rejects(requestManagerPlan(local, context, "pm-report-flow-arm", arm), /outcome unconfirmed/);
});

test("candidate loop actions preserve host identity and explicit attempt keys", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { runId: "run" } };
  const spawn = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const arm = { runId: "run", maxAttempts: 2, terminationKind: "report", planSources: [{ kind: "specgraph", specSlug: "plan", field: "tests", changeId: "change" }],
    join: { mode: "all", allowEmptySkip: false } };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-candidate-loop-arm", arm), reply.data);
  const trustedScope = { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" };
  assert.deepEqual(requests.at(-1).body, { request: arm, scope: trustedScope });
  const satisfaction = { ...arm, terminationKind: "satisfaction", satisfactionCriterion: "Original output meets acceptance" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-candidate-loop-arm", satisfaction), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: satisfaction, scope: trustedScope });
  await assert.rejects(requestManagerPlan(local, context, "pm-candidate-loop-arm", { ...arm, terminationKind: "satisfaction" }), /Unsupported/);
  await assert.rejects(requestManagerPlan(local, context, "pm-candidate-loop-arm", { ...arm, satisfactionCriterion: "forged" }), /Unsupported/);
  const named = { runId: "run", attemptId: "attempt-1", expectedJudgmentId: null, value: "unknown", reason: "Awaiting evidence" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-candidate-satisfaction-record", named), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: named, scope: trustedScope });
  const own = { attemptId: "attempt-1", expectedJudgmentId: "judgment-1", value: "false", reason: "Actual result differs" };
  assert.deepEqual(await requestOwnCandidateSatisfaction(local, context, own), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "candidate-satisfaction-own", project: "alpha",
    credential: "service-secret", body: { request: own, scope: trustedScope } });
  const history = { runId: "run", attemptId: "attempt-1", judgmentCursor: "j-before", interventionCursor: "i-before" };
  assert.deepEqual(await requestProjectKnowledge(local, context, "candidate-satisfaction-history", history), reply.data);
  assert.deepEqual(requests.at(-1).body, { ...history, environment_id: "env", native_project_id: "native-project" });
  for (const field of ["runId", "actor", "project", "scope", "satisfactionCriterion", "interventionId"]) {
    await assert.rejects(requestOwnCandidateSatisfaction(local, context, { ...own, [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestOwnCandidateSatisfaction(local, context, { attemptId: "attempt-1", value: "true", reason: "No CAS" }), /Unsupported/);
  await assert.rejects(requestOwnCandidateSatisfaction(connection, context, own), /local transport/);
  await assert.rejects(requestManagerPlan(local, context, "pm-candidate-loop-arm", { ...arm, join: { ...arm.join, evaluation: { satisfied: true } } }), /Unsupported/);
  const stop = { runId: "run", reason: "Stop future slots" };
  assert.deepEqual(await requestManagerPlan(local, context, "pm-candidate-loop-stop", stop), reply.data);
  assert.deepEqual(requests.at(-1).body, { request: stop, scope: trustedScope });
  assert.deepEqual(await requestProjectKnowledge(local, context, "candidate-loop-read", { runId: "run" }), reply.data);
  assert.deepEqual(requests.at(-1).body, { runId: "run", environment_id: "env", native_project_id: "native-project" });
  assert.deepEqual(await requestOwnDelivery(local, context, "candidate-next-own", { expectedPreviousAttemptId: "attempt-1" }), reply.data);
  assert.deepEqual(requests.at(-1).body, { expectedPreviousAttemptId: "attempt-1", scope: trustedScope });
  const candidate = { expectedRunId: "run", expectedAttemptId: "attempt-2", summary: "Original candidate", head: { isRepo: true, commitSha: "a".repeat(40) } };
  assert.deepEqual(await requestOwnDelivery(local, context, "delivery-submit-self", candidate), reply.data);
  assert.deepEqual(requests.at(-1).body, { ...candidate, scope: trustedScope });
  for (const field of ["scope", "project", "actor", "condition", "currentAttemptId", "environment_id", "native_project_id", "packageId"]) {
    await assert.rejects(requestManagerPlan(local, context, "pm-candidate-loop-arm", { ...arm, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestManagerPlan(local, context, "pm-candidate-loop-stop", { ...stop, [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestProjectKnowledge(local, context, "candidate-loop-read", { runId: "run", [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestOwnDelivery(local, context, "candidate-next-own", { expectedPreviousAttemptId: "attempt-1", [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestOwnDelivery(local, context, "delivery-submit-self", { ...candidate, [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestManagerPlan(connection, context, "pm-candidate-loop-arm", arm), /local transport/);
  await assert.rejects(requestProjectKnowledge(connection, context, "candidate-loop-read", { runId: "run" }), /local transport/);
  await assert.rejects(requestOwnDelivery(connection, context, "candidate-next-own", { expectedPreviousAttemptId: "attempt-1" }), /local transport/);
  reply = { error: { code: "conflict", message: "private" } };
  await assert.rejects(requestOwnDelivery(local, context, "candidate-next-own", { expectedPreviousAttemptId: "attempt-1" }), /rejected \(conflict\)/);
  spawn.mock.mockImplementation(() => { throw new Error("private transport"); });
  await assert.rejects(requestOwnDelivery(local, context, "candidate-next-own", { expectedPreviousAttemptId: "attempt-1" }), /outcome unconfirmed/);
});

test("PM marks and original paginated history preserve host scope and never retry uncertainty", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  const mark = { id: "41", taskSlug: "task", kind: "risk", value: "watch", reason: "Original source", actor: "pm:actual", createdAt: "now" };
  let reply = { data: mark };
  const spawn = mock.method(childProcess, "spawn", (_executable, args, options) => {
    assert.deepEqual(args, ["workbench-command-stdio", "--config", "fixture.yaml"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  for (const expectedMarkId of ["", "40"]) {
    const payload = { taskSlug: "task", kind: "risk", value: "watch", reason: "Original source", expectedMarkId };
    assert.deepEqual(await requestManagerPlan(local, context, "pm-set-node-mark", payload), mark);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation: "pm-set-node-mark", project: "alpha", credential: "service-secret",
      body: { taskSlug: "task", request: { kind: "risk", value: "watch", reason: "Original source", expectedMarkId },
        scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
    for (const field of ["project", "actor", "scope", "environment_id", "native_project_id", "confidence", "confirmed"]) {
      await assert.rejects(requestManagerPlan(local, context, "pm-set-node-mark", { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestManagerPlan(connection, context, "pm-set-node-mark", payload), /local transport/);
  }
  for (const [cursor, data] of [[undefined, { items: [mark], hasMore: true, nextCursor: "41" }],
    ["41", { items: [], hasMore: false, nextCursor: "" }], ["", { items: [mark], hasMore: false, nextCursor: "" }]]) {
    reply = { data };
    const payload = { taskSlug: "task", ...(cursor === undefined ? {} : { cursor }) };
    assert.deepEqual(await requestProjectKnowledge(local, context, "node-mark-history", payload), data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation: "node-mark-history", project: "alpha", credential: "service-secret",
      body: { ...payload, environment_id: "env", native_project_id: "native-project" } });
    for (const field of ["project", "actor", "scope", "environment_id", "native_project_id", "limit", "kind"]) {
      await assert.rejects(requestProjectKnowledge(local, context, "node-mark-history", { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestProjectKnowledge(connection, context, "node-mark-history", payload), /local transport/);
  }
  reply = { error: { code: "conflict", message: "Current mark changed" } };
  const payload = { taskSlug: "task", kind: "risk", value: "high", reason: "Original source", expectedMarkId: "40" };
  await assert.rejects(requestManagerPlan(local, context, "pm-set-node-mark", payload), /rejected \(conflict\)/);
  assert.equal(spawn.mock.callCount(), 6);
  spawn.mock.mockImplementation(() => { throw new Error("Transport failed after possible write"); });
  await assert.rejects(requestManagerPlan(local, context, "pm-set-node-mark", payload), /outcome unconfirmed/);
  assert.equal(spawn.mock.callCount(), 7);
});

test("unified host hooks retain source kinds and trusted scope without accepting arbitrary dispatch", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { environmentId: "env", nativeProjectId: "native-project" };
  const requests = [];
  let reply;
  const spawn = mock.method(childProcess, "spawn", (executable, args, options) => {
    assert.equal(executable, "fixture.exe");
    assert.deepEqual(args, ["workbench-command-stdio", "--config", "fixture.yaml"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  syncBuiltinESMExports();
  const hook = { id: "completion-hook", sourceRole: "summary", fact: { kind: "summary", id: "original-acceptance" },
    targetRunId: "program", targetPackageId: "original-package", programAdmissionId: "this-hook-admission", state: "pending" };
  for (const [operation, payload, data] of [
    ["host-list-hooks", { limit: 25, cursor: "before" }, { hooks: [{ kind: "delivery_test", deliveryTest: { id: "old-hook" } },
      { kind: "completion_program", completionProgram: hook }, { kind: "program_loop", programLoop: { context: { runId: "loop" } } }], nextCursor: "after" }],
    ["host-list-hooks", {}, { hooks: [], nextCursor: "" }],
    ["host-read-completion-hook", { hookId: "completion-hook" }, { hook, run: { context: { runId: "program", packageId: "original-package" } }, readinessError: null }],
    ["host-authorize-completion-hook", { hookId: "completion-hook" }, { run: { state: "prepared" }, mayStart: false }],
    ["host-result-completion-hook", { hookId: "completion-hook", status: "blocked", detail: "Original readiness failure" }, { ...hook, state: "blocked" }],
    ["host-result-completion-hook", { hookId: "completion-hook", status: "unconfirmed" }, { ...hook, state: "unconfirmed" }],
  ]) {
    reply = { data };
    assert.deepEqual(await requestHostHook(local, context, operation, payload), reply);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "alpha", credential: "service-secret",
      body: { ...payload, environmentId: "env", nativeProjectId: "native-project" } });
    for (const field of ["actor", "credential", "hostCredential", "project", "scope", "environmentId", "nativeProjectId", "command", "phase", "runId"]) {
      await assert.rejects(requestHostHook(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestHostHook(connection, context, operation, payload), /local transport/);
  }
  for (const status of ["commandAccepted", "rejected", "started", "completed"]) {
    await assert.rejects(requestHostHook(local, context, "host-result-completion-hook", { hookId: "completion-hook", status }), /result status/);
  }
  await assert.rejects(requestHostHook(local, context, "host-bind-completion-hook", { hookId: "completion-hook" }), /Unsupported/);
  assert.equal(requests.length, 6);
  reply = { error: { code: "conflict", message: "Target admission does not belong to this hook" } };
  assert.deepEqual(await requestHostHook(local, context, "host-authorize-completion-hook", { hookId: "completion-hook" }), reply);
  spawn.mock.mockImplementation(() => { throw new Error("Transport unavailable"); });
  await assert.rejects(requestHostHook(local, context, "host-read-completion-hook", { hookId: "completion-hook" }), { message: "Transport unavailable" });
  assert.equal(spawn.mock.callCount(), 8);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("program host operations retain configured identity, frozen scope and separate result from completion", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { environmentId: "env", nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { outcome: "exited", exitCode: 0 } };
  const spawn = mock.method(childProcess, "spawn", (_executable, args, options) => {
    assert.deepEqual(args, ["workbench-command-stdio", "--config", "fixture.yaml"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done();
      queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const observation = { outcome: "exited", exitCode: 0, observedAt: "2026-09-27T00:00:00Z", startedAt: null,
    finishedAt: "2026-09-27T00:00:00Z", timedOutAt: null, cancelRequestedAt: null, summary: "Observed exit only" };
  for (const [operation, payload] of [
    ["host-read-program-run", { runId: "program" }],
    ["host-authorize-program-run", { runId: "program" }],
    ["host-result-program-run", { runId: "program", observation }],
    ["host-complete-program-run", { runId: "program" }],
    ["host-result-program-attempt", { runId: "program", attemptId: "exact-attempt", observation }],
    ["host-authorize-next-program-attempt", { runId: "program", expectedPreviousAttemptId: "exact-attempt" }],
    ["host-stop-program-loop", { runId: "program", reason: "Transport unconfirmed" }],
    ["host-read-program-loop-history", { runId: "program", attemptCursor: "attempt-before", eventCursor: "event-before" }],
  ]) {
    const before = requests.length;
    assert.deepEqual(await requestHostProgramRun(local, context, operation, payload), reply);
    assert.equal(requests.length, before + 1);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "alpha", credential: "service-secret",
      body: { ...payload, environmentId: "env", nativeProjectId: "native-project" } });
    for (const field of ["actor", "credential", "token", "hostCredential", "project", "scope", "environmentId", "nativeProjectId", "command"]) {
      await assert.rejects(requestHostProgramRun(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestHostProgramRun(connection, context, operation, payload), /local transport/);
    await assert.rejects(requestHostProgramRun({ ...local, project: undefined }, context, operation, payload), /explicit project/);
  }
  await assert.rejects(requestHostProgramRun(local, context, "host-result-program-run", { runId: "program", observation: { ...observation, actor: "forged" } }), /observation field/);
  await assert.rejects(requestHostProgramRun(local, context, "host-result-program-attempt", { runId: "program", attemptId: "exact-attempt", observation: { ...observation, value: "true" } }), /observation field/);
  await assert.rejects(requestHostProgramRun(local, context, "host-authorize-next-program-attempt", { runId: "program", expectedPreviousAttemptId: "exact-attempt", maxAttempts: 100 }), /Unsupported/);
  await assert.rejects(requestHostProgramRun(local, context, "host-read-program-run", { runId: "program", observation }), /Unsupported/);
  await assert.rejects(requestHostProgramRun(local, context, "pm-prepare-program-run", {}), /Unsupported/);
  assert.equal(requests.length, 8);
  reply = { error: { code: "permission_denied", message: "Recorded host identity does not match" } };
  assert.deepEqual(await requestHostProgramRun(local, context, "host-complete-program-run", { runId: "program" }), reply);
  spawn.mock.mockImplementation(() => { throw new Error("Transport unavailable"); });
  await assert.rejects(requestHostProgramRun(local, context, "host-result-program-run", { runId: "program", observation }), { message: "Transport unavailable" });
  assert.equal(spawn.mock.callCount(), 10);
});

test("program loop knowledge and PM decisions preserve derived scope without policy overrides or retry", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { id: "record" } };
  const spawn = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  for (const [operation, payload] of [
    ["pm-record-program-loop-decision", { runId: "program", attemptId: "exact-attempt", value: "unknown", basis: "Insufficient original evidence", expectedJudgmentId: null }],
    ["pm-record-program-loop-decision", { runId: "program", attemptId: "exact-attempt", value: "false", basis: "Corrected original evidence", expectedJudgmentId: "judgment-1" }],
    ["pm-stop-program-loop", { runId: "program", reason: "Stop only future attempts" }],
  ]) {
    assert.deepEqual(await requestManagerPlan(local, context, operation, payload), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "alpha", credential: "service-secret",
      body: { request: payload, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
    for (const field of ["actor", "actorUserId", "actorRunId", "project", "scope", "hostCredential", "command", "maxAttempts", "taskSlug", "environmentId"]) {
      await assert.rejects(requestManagerPlan(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestManagerPlan(connection, context, operation, payload), /local transport/);
  }
  for (const [operation, payload] of [
    ["program-loop-read", { runId: "program" }],
    ["program-loop-history", { runId: "program" }],
    ["program-loop-history", { runId: "program", attemptCursor: "attempt-before", eventCursor: "event-before" }],
  ]) {
    assert.deepEqual(await requestProjectKnowledge(local, context, operation, payload), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "alpha", credential: "service-secret",
      body: { ...payload, environment_id: "env", native_project_id: "native-project" } });
    for (const field of ["actor", "project", "scope", "environment_id", "native_project_id", "limit", "cursor"]) {
      await assert.rejects(requestProjectKnowledge(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
  }
  reply = { error: { code: "conflict", message: "Judgment already consumed" } };
  await assert.rejects(requestManagerPlan(local, context, "pm-record-program-loop-decision", { runId: "program", attemptId: "exact-attempt", value: "true", basis: "Correction", expectedJudgmentId: "judgment-1" }), /conflict/);
  assert.equal(spawn.mock.callCount(), 7);
  spawn.mock.mockImplementation(() => { throw new Error("Outcome unknown after possible write"); });
  await assert.rejects(requestManagerPlan(local, context, "pm-stop-program-loop", { runId: "program", reason: "Stop future only" }), /outcome unconfirmed/);
  assert.equal(spawn.mock.callCount(), 8);
});

test("summary reads and PM writes preserve exact references and host identity without fallback", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", project: "alpha", token: "service-secret" };
  const context = { ...scope, nativeProjectId: "native-project" };
  const requests = [];
  let reply = { data: { accepted: false } };
  const spawn = mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  syncBuiltinESMExports();
  assert.deepEqual(await requestProjectKnowledge(local, context, "summary-status", { goalSlug: "goal" }), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "summary-status", project: "alpha", credential: "service-secret",
    body: { goalSlug: "goal", environment_id: "env", native_project_id: "native-project" } });
  for (const cursor of [undefined, "original-row-id"]) {
    assert.deepEqual(await requestProjectKnowledge(local, context, "summary-history", { goalSlug: "goal", kind: "acceptances", ...(cursor === undefined ? {} : { cursor }) }), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation: "summary-history", project: "alpha", credential: "service-secret",
      body: { goalSlug: "goal", kind: "acceptances", ...(cursor === undefined ? {} : { beforeId: cursor }), environment_id: "env", native_project_id: "native-project" } });
  }
  const source = { kind: "specgraph", specSlug: "goal", field: "intent", changeId: "original-change" };
  const references = { nodes: [{ id: "node", slug: "goal", role: "summary", sourceRefs: { intent: "original-change" }, lifecycleChangeId: "role-change" }],
    relations: [{ fromSlug: "goal", toSlug: "child", type: "COMPOSES", changeId: "removed-edge", present: false }], dispositionIds: [], decisionSources: [] };
  for (const [operation, payload] of [
    ["pm-summary-disposition", { goalSlug: "goal", affectedSlug: "child", disposition: "retain", reviewDecisionId: "approval",
      beforeSources: [source], afterSources: [source], reason: "Original scope preserved", idempotencyKey: "disposition-intent" }],
    ["pm-accept-summary", { goalSlug: "goal", basis: "Observed obligations", evidenceSources: [source], goalsSatisfied: true,
      idempotencyKey: "accept-intent", expectedReferences: references, impactReview: [{ slug: "child", basis: "Read original changes" }] }],
    ["pm-revoke-summary-acceptance", { acceptanceId: "original-acceptance", reason: "Actual source changed" }],
  ]) {
    assert.deepEqual(await requestManagerPlan(local, context, operation, payload), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "alpha", credential: "service-secret",
      body: { request: payload, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
    for (const field of ["actor", "project", "scope", "hostCredential", "environment_id", "native_project_id"]) {
      await assert.rejects(requestManagerPlan(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestManagerPlan(connection, context, operation, payload), /local transport/);
  }
  await assert.rejects(requestProjectKnowledge(local, context, "summary-status", { goalSlug: "goal", actor: "forged" }), /Unsupported/);
  await assert.rejects(requestProjectKnowledge(connection, context, "summary-status", { goalSlug: "goal" }), /local transport/);
  assert.equal(requests.length, 6);
  reply = { error: { code: "conflict", message: "Original references no longer match" } };
  await assert.rejects(requestProjectKnowledge(local, context, "summary-status", { goalSlug: "goal" }), { message: "conflict: Original references no longer match" });
  await assert.rejects(requestManagerPlan(local, context, "pm-revoke-summary-acceptance", { acceptanceId: "original", reason: "Changed" }), { message: "conflict: Original references no longer match" });
  spawn.mock.mockImplementation(() => { throw new Error("Transport unavailable"); });
  await assert.rejects(requestProjectKnowledge(local, context, "summary-status", { goalSlug: "goal" }), { message: "Transport unavailable" });
  await assert.rejects(requestManagerPlan(local, context, "pm-revoke-summary-acceptance", { acceptanceId: "original", reason: "Changed" }), { message: "Transport unavailable" });
  assert.equal(spawn.mock.callCount(), 10);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("project knowledge and review send host-owned identity through local transport and redact failures", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", token: "test-secret" };
  const context = { environmentId: "env", nativeProjectId: "native-project" };
  let reply = { data: { query: "source", scope: "specgraph-records", hasMore: false, items: [] } };
  const requests = [];
  const spawn = mock.method(childProcess, "spawn", (_executable, args, options) => {
    assert.deepEqual(args, ["workbench-command-stdio", "--config", "fixture.yaml"]);
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", ...reply }));
      done();
      queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  assert.deepEqual(await requestProjectKnowledge(local, context, "knowledge-search", { query: "source" }), reply.data);
  assert.deepEqual(requests[0], { id: "node-read", operation: "knowledge-search", credential: "test-secret",
    body: { query: "source", environment_id: "env", native_project_id: "native-project" } });
  for (const kind of ["spec", "decision", "change"]) {
    reply = { data: { kind, id: "record-id", slug: "node-slug", version: 1,
      specgraphProject: "actual-project", record: { body: "Original text" } } };
    assert.deepEqual(await requestProjectKnowledge({ ...local, project: "configured-project" }, context,
      "knowledge-record", { kind, reference: "record-ref", expectedProject: "actual-project" }), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation: "knowledge-record", project: "configured-project", credential: "test-secret",
      body: { kind, reference: "record-ref", expectedProject: "actual-project",
        environment_id: "env", native_project_id: "native-project" } });
  }
  const reviewContext = { ...scope, nativeProjectId: "native-project" };
  const dispatchRequest = { task_slug: "child", workspace: "C:/project", idempotency_key: "original-key", dispatch_target: { threadId: "original-thread" } };
  reply = { data: { binding_id: "original-run", generation: 1, replayed: false } };
  assert.deepEqual(await requestManagerDispatch(local, scope, "pm-prepare-run", dispatchRequest), reply);
  assert.deepEqual(requests.at(-1).body, { request: dispatchRequest, scope: {
    environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  await requestManagerDispatch(local, scope, "pm-bind-run", { runId: "original-run", thread_ref: "original-thread", environment_id: "env" });
  assert.deepEqual(requests.at(-1).body.request, { thread_ref: "original-thread", environment_id: "env" });
  assert.equal(requests.at(-1).body.runId, "original-run");
  await requestManagerDispatch(local, scope, "pm-authorize-run", { runId: "original-run", packageId: "package", target: dispatchRequest.dispatch_target });
  assert.deepEqual(requests.at(-1).body.request, { packageId: "package", target: dispatchRequest.dispatch_target });
  reply = { error: { code: "not_found", message: "private backend detail" } };
  assert.deepEqual(await requestManagerDispatch(local, scope, "pm-read-preparation", { idempotency_key: "original-key" }), { error: { code: "not_found" } });
  assert.deepEqual(requests.at(-1).body.request, { idempotency_key: "original-key" });
  for (const field of ["actor", "scope", "project", "assignmentRole"]) {
    await assert.rejects(requestManagerDispatch(local, scope, "pm-prepare-run", { ...dispatchRequest, [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestManagerDispatch(local, scope, "pm-start-model", {}), /Unsupported/);
  await assert.rejects(requestManagerDispatch(connection, scope, "pm-read-preparation", { runId: "original-run" }), /requires local transport/);
  reply = { data: { approved: "child", version: 2 } };
  assert.deepEqual(await requestManagerPlan(local, scope, "pm-approve-node", { taskSlug: "child", expectedVersion: 1, basis: "Approved scope" }), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "pm-approve-node", credential: "test-secret",
    body: { taskSlug: "child", request: { expectedVersion: 1, basis: "Approved scope" }, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
  const dependency = { taskSlug: "child", prerequisite: "parent", expected_version: 1, expected_prerequisite_version: 2, expected_revision: "9007199254740993", reason: "Plan" };
  await requestManagerPlan(local, scope, "pm-add-dependency", dependency);
  assert.equal(requests.at(-1).body.request.expected_revision, "9007199254740993");
  assert.match(requests.at(-1).body.request.idempotency_key, /^[a-f0-9]{32}$/);
  assert.equal(Object.hasOwn(requests.at(-1).body.request, "taskSlug"), false);
  await requestManagerPlan(local, scope, "pm-create-node", { slug: "draft", intent: "Task", priority: "p2", complexity: "low" });
  assert.equal(Object.hasOwn(requests.at(-1).body, "taskSlug"), false);
  for (const field of ["actor", "project", "scope", "assignmentRole", "provenanceType"]) {
    await assert.rejects(requestManagerPlan(local, scope, "pm-create-node", { slug: "draft", intent: "Task", [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestManagerPlan(local, scope, "pm-delete-node", {}), /Unsupported/);
  await assert.rejects(requestManagerPlan(connection, scope, "pm-create-node", {}), /requires local transport/);
  for (const [operation, payload] of [
    ["pm-arm-delivery-hook", { sourceRunId: "implementation", targetRunId: "prepared-test", commitSha: "a".repeat(40), idempotencyKey: "hook-intent", deliveryId: "exact-delivery" }],
    ["pm-read-delivery-hook", { hookId: "hook" }],
    ["pm-list-delivery-hooks", { limit: 10, cursor: "hook-cursor" }],
    ["pm-cancel-delivery-hook", { hookId: "hook", reason: "Plan changed" }],
    ["pm-retry-delivery-hook", { hookId: "hook", reason: "Guard repaired" }],
  ]) {
    assert.deepEqual(await requestManagerPlan({ ...local, project: "configured-project" }, scope, operation, payload), reply.data);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "configured-project", credential: "test-secret",
      body: { request: payload, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
    for (const field of ["scope", "actor", "project", "configuredByRunId", "targetPackageId"]) {
      await assert.rejects(requestManagerPlan(local, scope, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestManagerPlan(connection, scope, operation, payload), /requires local transport/);
  }
  await requestManagerPlan(local, scope, "pm-list-delivery-hooks", {});
  assert.deepEqual(requests.at(-1).body.request, {});
  reply = { data: { hook: { id: "human-hook", configuredByRunId: null, configuredByUserId: "human-user", hostConsumerUserId: "service-user",
    retriedAt: null, retriedByRunId: null, retriedByUserId: null }, parent: null } };
  for (const [operation, payload] of [
    ["host-list-delivery-hooks", { limit: 20, cursor: "before" }],
    ["host-read-delivery-hook", { hookId: "hook" }],
    ["host-bind-delivery-hook", { hookId: "hook" }],
    ["host-authorize-delivery-hook", { hookId: "hook" }],
    ["host-result-delivery-hook", { hookId: "hook", status: "unconfirmed", detail: "Transport uncertainty" }],
  ]) {
    assert.deepEqual(await requestHostDeliveryHook(local, context, operation, payload), reply);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, credential: "test-secret", body: { ...payload, environmentId: "env", nativeProjectId: "native-project" } });
    for (const field of ["scope", "actor", "environmentId", "nativeProjectId", "targetRunId", "target"]) {
      await assert.rejects(requestHostDeliveryHook(local, context, operation, { ...payload, [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestHostDeliveryHook(connection, context, operation, payload), /Host delivery hooks require local transport/);
  }
  reply = { data: { hookId: "hook", deliveryId: "delivery", sourceRunId: "source", targetRunId: "test", commitSha: "a".repeat(40) } };
  assert.deepEqual(await requestOwnDelivery(local, scope, "delivery-hook-context", {}), reply.data);
  assert.deepEqual(requests.at(-1).body, { scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  await assert.rejects(requestOwnDelivery(local, scope, "delivery-hook-context", { runId: "forged" }), /Unsupported/);
  reply = { data: { specVersion: 1, revision: "9007199254740993", operations: [] } };
  assert.deepEqual(await requestProjectKnowledge(local, context, "dependency-state", { taskSlug: "child" }), reply.data);
  reply = { data: { nodes: [], edges: [], totalNodes: 0, totalEdges: 0, hasMore: false, nextOffset: null } };
  assert.deepEqual(await requestProjectKnowledge(local, context, "graph-current", { offset: 100 }), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "graph-current", credential: "test-secret",
    body: { offset: 100, environment_id: "env", native_project_id: "native-project" } });
  await assert.rejects(requestProjectKnowledge(local, context, "graph-current", { project: "forged" }), /Unsupported/);
  const handoff = { mail_thread_id: "mail-thread", recipient_run_id: "successor", body: "Continue this discussion", idempotency_key: "handoff-key" };
  reply = { data: { thread: { id: "mail-thread", opened_by_run: "original", owner_run: "successor" },
    message: { id: "handoff-message", thread_id: "mail-thread", recipient_run_ids: ["successor"], handoff_to_run: "successor", body: handoff.body, idempotency_key: handoff.idempotency_key } } };
  assert.deepEqual(await requestMail(local, scope, "handoff", handoff), reply.data);
  assert.equal(requests.at(-1).operation, "mail-handoff");
  assert.deepEqual(requests.at(-1).body, { ...handoff, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  reply.data.thread.owner_run = "later-owner";
  assert.equal((await requestMail(local, scope, "handoff", handoff)).thread.owner_run, "later-owner");
  reply.data.message.handoff_to_run = "wrong-recipient";
  await assert.rejects(requestMail(local, scope, "handoff", handoff), /Invalid handoff receipt/);
  await assert.rejects(requestMail(connection, scope, "handoff", handoff), /requires local transport/);
  await assert.rejects(requestMail(local, scope, "handoff", { ...handoff, sender_run: "forged" }), /Unsupported/);
  reply = { data: { threads: [{ id: "owned-thread", task_slug: "task", subject: "Unresolved", opened_by_run: "original", owner_run: "current", closed_at: null }], next_cursor: "" } };
  assert.deepEqual(await requestMail(local, scope, "owned", { limit: 10 }), reply.data);
  assert.equal(requests.at(-1).operation, "mail-owned");
  assert.deepEqual(await requestMail(local, scope, "retired", { limit: 10 }), reply.data);
  assert.equal(requests.at(-1).operation, "mail-retired");
  assert.deepEqual(requests.at(-1).body, { limit: 10, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  await assert.rejects(requestMail(local, scope, "owned", { limit: 10, owner_run: "forged" }), /Unsupported/);
  await assert.rejects(requestMail(connection, scope, "owned", { limit: 10 }), /local transport/);
  reply = { data: { threads: [], next_cursor: "" } };
  assert.deepEqual(await requestMail(local, scope, "owned", { limit: 10 }), reply.data);
  const takeover = { mail_thread_id: "old-mail", recipient_run_id: "new-owner", body: "Prior owner retired", idempotency_key: "takeover-key" };
  const ownerEvent = { id: "owner-event", thread_id: "old-mail", from_run: "retired", to_run: "new-owner", actor_kind: "agent", actor_user_id: "real-user", actor_run_id: "pm-run", reason: takeover.body, created_at: "now" };
  reply = { data: { thread: { id: "old-mail", owner_run: "new-owner" }, event: ownerEvent } };
  assert.deepEqual(await requestMail(local, scope, "takeover", takeover), reply.data);
  assert.equal(requests.at(-1).operation, "mail-takeover");
  assert.deepEqual(requests.at(-1).body, { ...takeover, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  reply.data.thread.owner_run = "later-owner";
  assert.equal((await requestMail(local, scope, "takeover", takeover)).thread.owner_run, "later-owner");
  reply.data.event.actor_kind = "human";
  await assert.rejects(requestMail(local, scope, "takeover", takeover), /Invalid takeover receipt/);
  reply = { data: { events: [{ ...ownerEvent, actor_kind: "human", actor_run_id: null }], next_cursor: "event-next" } };
  assert.deepEqual(await requestMail(local, scope, "owner-history", { mail_thread_id: "old-mail", limit: 10, cursor: "event-before" }), reply.data);
  assert.equal(requests.at(-1).operation, "mail-owner-history");
  for (const operation of ["retired", "owner-history", "takeover"]) {
    await assert.rejects(requestMail(local, scope, operation, { actor_user_id: "forged" }), /Unsupported/);
    await assert.rejects(requestMail(connection, scope, operation, {}), /local transport/);
  }
  const ownContext = { runId: "own-run", taskSlug: "own-task", workspace: "C:/saved" };
  reply = { data: ownContext };
  assert.deepEqual(await requestOwnDelivery(local, scope, "delivery-self-context", {}), ownContext);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "delivery-self-context", credential: "test-secret",
    body: { scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
  const candidate = { expectedRunId: "own-run", summary: "Output", head: { isRepo: true, commitSha: "a".repeat(40) } };
  reply = { data: { deliveryId: "own-delivery", runId: "own-run", taskSlug: "own-task" } };
  assert.deepEqual(await requestOwnDelivery(local, scope, "delivery-submit-self", candidate), reply.data);
  assert.deepEqual(requests.at(-1).body, { ...candidate, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } });
  await assert.rejects(requestOwnDelivery(local, scope, "delivery-self-context", { runId: "forged" }), /Unsupported/);
  await assert.rejects(requestOwnDelivery(local, scope, "delivery-submit-self", { ...candidate, scope: "forged" }), /Unsupported/);
  reply = { data: { taskSlug: "node", deliveries: [], hasMore: false, nextCursor: null } };
  assert.deepEqual(await requestProjectKnowledge(local, context, "node-deliveries", { taskSlug: "node", cursor: "delivery-cursor" }), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "node-deliveries", credential: "test-secret",
    body: { taskSlug: "node", cursor: "delivery-cursor", environment_id: "env", native_project_id: "native-project" } });
  await assert.rejects(requestProjectKnowledge(local, context, "node-deliveries", { taskSlug: "node", project: "forged" }), /Unsupported/);
  reply = { data: { runId: "bound-run", completed: "bound-task" } };
  assert.deepEqual(await completeOwnRun(local, scope), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "run-complete-self", credential: "test-secret",
    body: { scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
  await assert.rejects(completeOwnRun(connection, scope), /requires local transport/);
  const testInput = { deliveryId: "delivery", commitSha: "a".repeat(40), planSources: [{ kind: "specgraph", specSlug: "plan", field: "specify_output", changeId: "cl-plan" }], status: "not_run",
    command: "", exitCode: null, summary: "Not executed", outputRefs: [] };
  reply = { data: { ...testInput, id: "report", testRunId: "bound-run", reporter: "bound-run", createdAt: "now" } };
  assert.deepEqual(await requestTests(local, reviewContext, "test-result-submit", testInput), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "test-result-submit", credential: "test-secret",
    body: { ...testInput, scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } } });
  reply = { data: { deliveryId: "delivery", reports: [], hasMore: false, nextCursor: null } };
  assert.deepEqual(await requestTests(local, reviewContext, "test-results", { deliveryId: "delivery", cursor: "12" }), reply.data);
  assert.deepEqual(requests.at(-1), { id: "node-read", operation: "test-results", credential: "test-secret",
    body: { deliveryId: "delivery", cursor: "12", environment_id: "env", native_project_id: "native-project" } });
  const status = { taskSlug: "task", reviews: [] };
  const assignment = { taskSlug: "task", kind: "requirements", sources: [{ kind: "specgraph", specSlug: "task", field: "intent", changeId: "cl-source" }],
    authorResponsibility: { kind: "agent", runId: "author" }, requirementDecisionIds: [], reviewerRunId: "reviewer", completionRunId: "author" };
  for (const [operation, payload] of [
    ["review-status", { taskSlug: "task" }],
    ["review-request-source", { requestId: "request" }],
    ["review-request-source", { decisionId: "decision" }],
    ["review-delivery-source", { deliveryId: "delivery" }],
    ["review-assign", assignment],
    ["review-submit", { requestId: "request", verdict: "accepted", basis: "Observed verification" }],
  ]) {
    reply = { data: operation === "review-submit" ? { recorded: true, decision: { id: "decision", requestId: "request",
      verdict: "accepted", basis: "Observed source", actorKind: "agent", actor: "service", reviewerRunId: "reviewer", createdAt: "now" }, status }
      : operation === "review-delivery-source" ? { id: "delivery", runBindingId: "run", submittedBy: "author", submittedAt: "now", snapshot: { git: { base: "original-base", head: "original-head" }, summary: "Submitted source" } } : status };
    const before = requests.length;
    assert.deepEqual(await requestReview({ ...local, project: "configured-project" }, reviewContext, operation, payload), reply.data);
    assert.equal(requests.length, before + 1);
    assert.deepEqual(requests.at(-1), { id: "node-read", operation, project: "configured-project", credential: "test-secret",
      body: { ...payload, ...(operation === "review-status" || operation === "review-delivery-source" || operation === "review-request-source" ? { environment_id: "env", native_project_id: "native-project" }
        : { scope: { environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider" } }) } });
  }
  reply = { error: { code: "permission_denied", message: "test-secret private detail" } };
  await assert.rejects(requestManagerPlan(local, scope, "pm-approve-node", { taskSlug: "child", expectedVersion: 1, basis: "scope" }), { message: "Planning request rejected (permission_denied)" });
  await assert.rejects(completeOwnRun(local, scope), { message: "Run completion rejected (permission_denied)" });
  await assert.rejects(requestProjectKnowledge(local, context, "knowledge-search", { query: "source" }),
    { message: "Project knowledge rejected (permission_denied)" });
  await assert.rejects(requestReview(local, reviewContext, "review-assign", assignment),
    { message: "Project review rejected (permission_denied)" });
  spawn.mock.mockImplementation(() => { throw new Error("test-secret fixture.yaml"); });
  await assert.rejects(completeOwnRun(local, scope), { message: "Run completion outcome unconfirmed; inspect task state before another action" });
  await assert.rejects(requestProjectKnowledge(local, context, "knowledge-search", { query: "source" }),
    { message: "Project knowledge request failed or was cancelled" });
  const before = spawn.mock.callCount();
  await assert.rejects(requestReview(local, reviewContext, "review-submit", { requestId: "request", verdict: "accepted", basis: "Observed verification" }),
    { message: "Project review request failed or was cancelled; outcome unconfirmed. Read review status before deciding another action" });
  assert.equal(spawn.mock.callCount(), before + 1);
});

test("review rejects forged scope, actor, threshold and transport fields without HTTP fallback", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const context = { ...scope, nativeProjectId: "native-project" };
  for (const payload of [{}, { requestId: "request", decisionId: "decision" }]) {
    await assert.rejects(requestReview(connection, context, "review-request-source", payload), /exactly one/);
  }
  for (const operation of ["review-status", "review-delivery-source", "review-assign", "review-submit"]) {
    for (const field of ["scope", "project", "actor", "environment_id", "native_project_id", "maxReviewRounds", "token", "endpoint", "idempotency_key"]) {
      await assert.rejects(requestReview(connection, context, operation, { [field]: "forged" }), /Unsupported/);
    }
    await assert.rejects(requestReview(connection, context, operation, {}), /requires local transport/);
  }
  await assert.rejects(requestReview(connection, context, "review-policy", {}), /Unsupported/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("test report transport cannot select another run or actor and never executes a command itself", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const context = { ...scope, nativeProjectId: "native-project" };
  for (const field of ["testRunId", "actor", "project", "scope", "workspace"]) {
    await assert.rejects(requestTests(connection, context, "test-result-submit", { [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestTests(connection, context, "test-result-submit", {}), /require local transport/);
  await assert.rejects(requestTests(connection, context, "execute-tests", {}), /Unsupported/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("project knowledge rejects injected identity and never falls back to HTTP", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  const context = { environmentId: "env", nativeProjectId: "native-project" };
  for (const field of ["scope", "project", "environment_id", "native_project_id", "thread_id", "run_id"]) {
    await assert.rejects(requestProjectKnowledge(connection, context, "knowledge-search", { query: "source", [field]: "forged" }), /Unsupported/);
    await assert.rejects(requestProjectKnowledge(connection, context, "knowledge-record", { kind: "spec", reference: "slug", [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestProjectKnowledge(connection, context, "knowledge-search", { query: "source", expectedProject: "forged" }), /Unsupported/);
  for (const operation of ["knowledge-search", "knowledge-record"]) {
    await assert.rejects(requestProjectKnowledge(connection, context, operation, {}), /requires local transport/);
  }
  await assert.rejects(requestProjectKnowledge(connection, context, "mail-context", {}), /Unsupported/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("conversation runs read forwards only target and cursor with host-owned identity", async () => {
  const local = { executable: "fixture.exe", config: "fixture.yaml", token: "test-secret" };
  const context = { environmentId: "env", nativeProjectId: "native-project" };
  const requests = [];
  const data = { threadId: "archived-thread", runs: [
    { runId: "run-a", taskSlug: "first", state: "completed", createdAt: "2026-09-01T00:00:00Z", dispatchMessageId: "message-a" },
    { runId: "run-b", taskSlug: "second", state: "dispatched", createdAt: "2026-09-02T00:00:00Z", dispatchMessageId: null },
  ], hasMore: true, nextCursor: "run-b" };
  mock.method(childProcess, "spawn", (_executable, _args, _options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => child.emit("close", 1);
    child.stdin = new Writable({ write(chunk, _encoding, done) {
      requests.push(JSON.parse(String(chunk)));
      child.stdout.write(JSON.stringify({ id: "node-read", data }));
      done(); queueMicrotask(() => child.emit("close", 0));
    } });
    return child;
  });
  syncBuiltinESMExports();
  assert.deepEqual(await requestProjectKnowledge(local, context, "conversation-runs", { threadId: "archived-thread", cursor: "run-a" }), data);
  assert.deepEqual(requests[0], { id: "node-read", operation: "conversation-runs", credential: "test-secret",
    body: { threadId: "archived-thread", cursor: "run-a", environment_id: "env", native_project_id: "native-project" } });
  for (const field of ["environment_id", "native_project_id", "project", "scope", "runId", "cwd"]) {
    await assert.rejects(requestProjectKnowledge(local, context, "conversation-runs", { threadId: "archived-thread", [field]: "forged" }), /Unsupported/);
  }
  assert.equal(requests.length, 1);
  await assert.rejects(requestProjectKnowledge(connection, context, "conversation-runs", { threadId: "archived-thread" }), /local transport/);
});

test("preserves content and key while deriving scope only from host context", async () => {
  const payload = { subject: "contract", body: "  original\n", recipient_run_ids: ["run-b"], idempotency_key: "key-1" };
  const result = { message: { id: "message-1", body: payload.body }, thread: { id: "thread-1", closed_at: null } };
  const fetchMock = mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url.href, "http://127.0.0.1:8690/loop/mail/send");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-secret");
    assert.equal(options.headers["X-Specgraph-Project"], "alpha");
    assert.deepEqual(JSON.parse(options.body), { ...payload, scope: {
      environment_id: "env", thread_id: "thread", provider_session_id: "session", provider_instance_id: "provider",
    } });
    return Response.json(result);
  });
  assert.deepEqual(await requestMail(connection, scope, "send", payload), result);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("rejects sender, scope and node injection before fetch", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const field of ["scope", "sender_run", "sender", "task_slug", "project"]) {
    await assert.rejects(requestMail(connection, scope, "send", { [field]: "forged" }), /Unsupported/);
  }
  await assert.rejects(requestMail(connection, scope, "toString", {}), /Unsupported/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("directory rejects forged scope and does not invent an HTTP route", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  await assert.rejects(requestMail(connection, scope, "directory", { limit: 10, project: "forged" }), /Unsupported/);
  await assert.rejects(requestMail(connection, scope, "directory", { limit: 10, assignment_role: "knowledge" }), /requires local transport/);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("third-party contextual mail preserves source references and rejects an incomplete receipt", async () => {
  const payload = { subject: "Review", body: "Please check this decision", recipient_run_ids: ["run-c", "run-d"],
    idempotency_key: "context-1", references: [{ message_id: "source-a", kind: "reply" }, { message_id: "source-b", kind: "context" }] };
  const result = { thread: { id: "new-thread" }, message: { id: "new-message", references: payload.references.map((source) => ({
    ...source, thread_id: "original-thread", task_slug: "original-task", sender_run_id: "run-a",
    subject: "Original subject", body: "Unmodified source text", created_at: "2026-09-20T00:00:00Z",
  })) } };
  const fetchMock = mock.method(globalThis, "fetch", async (_url, options) => {
    const wire = JSON.parse(options.body);
    assert.deepEqual(wire.references, payload.references);
    assert.deepEqual(wire.recipient_run_ids, ["run-c", "run-d"]);
    assert.equal(Object.hasOwn(wire, "mail_thread_id"), false);
    return Response.json(result);
  });
  assert.deepEqual(await requestMail(connection, scope, "send", payload), result);
  fetchMock.mock.mockImplementation(async () => Response.json({ thread: result.thread, message: { id: "new-message" } }));
  await assert.rejects(requestMail(connection, scope, "send", payload), /unconfirmed/);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("refuses nonlocal endpoints and configured URL credentials or paths", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("must not fetch"); });
  for (const endpoint of ["invalid-test-secret", "https://example.com", "http://127.0.0.1.example.com", "http://user@localhost", "http://localhost/base", "http://localhost/?q=1"]) {
    await assert.rejects(requestMail({ ...connection, endpoint }, scope, "inbox", { limit: 10 }), /loopback/);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("read does not acknowledge or close and rejection is not retried", async () => {
  const receipt = { read_at: "2026-09-20T00:00:00Z", acknowledged_at: null };
  const fetchMock = mock.method(globalThis, "fetch", async (url) => url.pathname.endsWith("/read")
    ? Response.json(receipt) : Response.json({ error: "private detail" }, { status: 403 }));
  assert.deepEqual(await requestMail(connection, scope, "read", { message_id: "m" }), receipt);
  await assert.rejects(requestMail(connection, scope, "ack", { message_id: "m" }), /HTTP 403/);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test("network and malformed responses never confirm delivery or leak credentials", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => { throw new Error("test-secret"); });
  await assert.rejects(requestMail(connection, scope, "send", {}), (error) => {
    assert.match(error.message, /unconfirmed/);
    assert.equal(error.message.includes("test-secret"), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  fetchMock.mock.mockImplementation(async () => new Response("not JSON"));
  await assert.rejects(requestMail(connection, scope, "inbox", { limit: 10 }), /invalid response/);
  fetchMock.mock.mockImplementation(async () => Response.json({}));
  await assert.rejects(requestMail(connection, scope, "send", {}), /invalid response/);
  assert.equal(fetchMock.mock.callCount(), 3);
});

test("propagates cancellation without retries", async () => {
  const controller = new AbortController();
  controller.abort();
  const fetchMock = mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(options.signal.aborted, true);
    options.signal.throwIfAborted();
  });
  await assert.rejects(requestMail(connection, scope, "inbox", { limit: 10 }, controller.signal), /cancelled/);
  assert.equal(fetchMock.mock.callCount(), 1);
});
