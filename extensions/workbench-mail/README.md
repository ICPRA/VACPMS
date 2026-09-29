# Workbench Mail Transport

2026-09-23: source wiring now also supports the existing local stdio command
bridge. Startup configuration selects executable/config instead of endpoint;
component and token_file paths can be relative to the configuration file. The MCP
consumer passes authenticated invocation scope exactly as before. All six mail
operations use the same Go mail executor as HTTP, including the original
multi-recipient and reply/forward logic. There is no HTTP fallback from a local
failure. This is internal wiring, not completed zero-configuration installation;
packaging/initialization must supply these settings rather than require users to
edit them. Real Node client to Go stdio to isolated PostgreSQL verification passed
on 2026-09-23: multi-recipient send, contextual forwarding/replies to third parties,
inbox/thread reads, read/ack receipts, closure and unenrolled-scope rejection.
No real project messages were sent. Local calls now automatically enroll the
uniquely bound project/environment/thread run, using the authenticated bridge
identity. Explicit revocation is not silently reversed; HTTP enrollment semantics
are unchanged. The same isolated round trip passed without manual grant/binding
fixtures, including a revocation check. Local configurations may omit projects:
the authenticated environment/thread resolves its project from an existing unique
bound run, never a title. Missing or ambiguous bindings fail. Initial credential setup remains
unfinished; this is not a claim of complete end-user delivery.

Server-only external source for the T3 mailbox integration. The source checkout
has an opt-in registration on its existing `/mcp` endpoint. The installed stock
T3 server is unchanged. This package creates no credentials or service.

`requestMail(connection, invocation, operation, payload, signal)` accepts host
configuration (`endpoint`, `project`, `token`) and an authenticated T3
`McpInvocationContext` (`environmentId`, `threadId`, `providerSessionId`,
`providerInstanceId`). Never expose either object as model tool arguments.

The configured endpoint must be a loopback HTTP origin. Redirects are rejected,
requests have a 15-second timeout and optional cancellation, and failures are not
automatically retried. Keep the same idempotency key when explicitly retrying an
unconfirmed send. The transport preserves the server JSON result; it does not
interpret a read receipt as acknowledgment or a closed thread as task acceptance.

Payload fields are specific to send/inbox/thread/read/ack/close. Sender, task,
project and scope cannot be supplied through that payload. The backend must still
authenticate the service key, authorize its grant and resolve the pinned session
mapping before selecting a sender run and task. This client is not authentication.

The host must keep the service credential out of provider environments, files,
logs and tool results. No operating-system isolation from same-user arbitrary
shell access is claimed. Verified scope enrollment and actual provider calls remain
unverified. There is no automatic wakeup, retry, new thread or task acceptance.

## Source Host Configuration

`T3_WORKBENCH_MAIL_CONFIG` is an absolute JSON file path, never a token. The source
server reads that file and its `token_file` once at startup, not during tool calls.
Without the environment variable no mail tools are registered. Invalid configured
settings fail startup with a redacted error instead of silently disabling mail.
The configuration has exactly these fields (illustration only, no file is created):

```json
{
  "endpoint": "http://127.0.0.1:8690",
  "token_file": "C:\\operator-owned\\mail-service-token.txt",
  "projects": { "actual-native-project-id": "existing-specgraph-project" }
}
```

The operator owns the credential file and its access controls. Do not put its raw
token into an environment variable, provider configuration or logs. Native project
IDs come from the authenticated thread's projection, never titles or directories.
Missing/deleted, archived and unmapped threads fail before HTTP access. Backend
service-key authentication, bridge grants and pinned session bindings still apply.

The six mail operations are `workbench_mail_send`, `workbench_mail_inbox`,
`workbench_mail_thread`, `workbench_mail_read`, `workbench_mail_ack` and
`workbench_mail_close`. Only inbox/thread are read-only; read/ack create receipts.
All operations are idempotent for the same input, including send's required key
and close's same resolution. The model schema contains no host identity or secrets.

Contextual replies and forwards use send's optional `references` array:
`[{"message_id":"original-message-id","kind":"reply"}]`.
Kinds are `reply`, `forward`, and additional `context`; at most eight distinct
sources and one direct reply. The backend checks source access and returns the
original text, author, timestamp, thread and task with the message. Quote bodies
and authors are never accepted from the caller. Selected source bodies together
must fit 64 KiB; excessive selections fail rather than being truncated.

Omit `mail_thread_id` to send those selected sources to third parties in a new
thread, without adding recipients to the original thread. Set it only when the
recipients should join the target discussion and see its whole history. Nested
quotes are not copied recursively: select additional source messages explicitly.
An already received quotation may be explicitly shared again; this never grants
access to unshared sibling messages or the original thread.
References are part of the idempotent intent; changing them requires a new key.

The additional read-only `workbench_mail_context` has no arguments and returns
the authenticated four-field scope, native project ID and configured SpecGraph
project. It reads no credentials into its result and makes no backend request.
An operator can use those exact values for explicit enrollment. The MCP
`providerSessionId` is not the provider's own session ID. Metadata retrieval does
not authorize or enroll a session; grant/binding approval remains a separate
operator action. Runtime deployment and credential activation are tracked in
the workbench `STATE.md`; source registration alone does not enable these tools.

Run `node --test client.test.mjs config.test.mjs` here. Tests check request identity/content,
injection rejection, loopback/redirect policy, independent receipt operations,
failure handling, cancellation and startup configuration with mocked fetch and
in-memory file reads. T3's `src/mcp/workbenchMail.test.ts` exercises the actual
Effect toolkit handlers and in-memory MCP registry with fake native projections.
These are source consumer tests, not real provider/backend or deployed integration
tests. Tool schemas reuse the host's Effect 4.0.0-rc.115 peer; transport/config use
only the Node standard library.

For host regression checks, invoke the installed Vitest entry directly from
`t3code-git/apps/server`, resolving its package through
`createRequire(import.meta.resolve("vite-plus/test/node"))` and its `bin.vitest`
field. The installed vite-plus 0.3.0 `dist/bin.js` uses the same bundled runner.
Do not use `pnpm --filter t3 exec vp test` for this check: that wrapper unexpectedly
triggered a workspace install. A direct-run root check passed all eight host tests
and compared the lockfile bytes before/after unchanged. The earlier install's
three extra lock records remain unattributed because its pre-install baseline
was not retained; they were not guessed away or silently reverted.
