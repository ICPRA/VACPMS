# Project Workbench UI

This private local workspace package owns the workbench page, model, authenticated
SpecGraph operations, and bilingual business text outside the T3 checkout. It is
not an official T3 plugin ABI and is not published to npm. It does not modify
the installed desktop application, server bundle, or provider runtime.

## Host Contract

- Import `Page` from `@project-workbench/ui` and model/types from
  `@project-workbench/ui/model`.
- Provide `search` / `onSearchChange`, `language` (`zh` or `en`),
  `languageControl`, `renderSessions(runs, selected)`, and
  `renderTooltip(label, trigger)`. The T3 wrapper supplies its existing real
  session view and uses `TooltipTrigger render={trigger}`.
- Keep the host route/search validation, navigation entry, and same-origin
  `/workbench-api` proxy. The optional `renderDispatch` callback belongs to the
  native host; it may create/bind/send using T3 commands only after an explicit
  operator action and backend authorization. The external page does not manage
  provider processes. Node creation,
  manual completion and prerequisite editing use the existing authenticated
  backend; controls are gated by the returned capabilities where applicable.
- `@project-workbench/ui/dispatch` supplies the versioned `vacpms-run-v1`
  recorded-context formatter. Preserve its output contract for outstanding
  native command retries; changed formatting needs a new format version.
  Conversation logs, free-form notes, hashes and dispatch configuration are not
  copied into the first task prompt. Native prompt-effort prefix text is frozen
  in the prepared target, rather than recomputed from upgraded host helpers.
- Register this directory in the host pnpm workspace and use `workspace:*` in
  the web package. Its React and lucide peers must resolve from the same workspace.
- Import `@project-workbench/ui/styles.css` after Tailwind in the host's main
  stylesheet. Its `@source` registers external page classes with the host's
  Tailwind 4 compiler; host theme tokens remain authoritative. Vite must allow
  this external source directory. No copied theme or second CSS build is needed.

## Upgrade Verification

`t3-workbench-host.patch` preserves the current 70 dedicated workbench host source/test
files outside T3, including the route, i18n and desktop IPC method.
It is regenerated from the `workbench` branch of the t3code-git checkout
(`git diff --diff-filter=A upstream/main..workbench`), which is the authoritative
history for host-side changes.
It is a source snapshot, not a rollback and
not an installer. Creating it does not change the host files. `git apply --stat`
can inspect its inventory without applying changes. It does not include shared
workspace, proxy, stylesheet or package configuration, and has not yet been
rehearsed against a clean upgraded host. Refresh it after host-adapter edits;
do not treat its existence as upgrade compatibility or use it to overwrite
different existing source without reviewing those differences.

Shared host edits must be merged, not replaced wholesale: workspace/package and
the DesktopConfig/DesktopEnvironment/DesktopAppIdentity optional Electron
user-data-directory override used by the VACPMS launcher; the remaining
lockfile links to the two external packages; index.css external stylesheet import;
SidebarChrome workbench navigation and the /workbench entry in
isSidebarUtilityPage; the ThreadRouteView back-to-workbench chip reading the
sessionStorage return href written by workbench thread links;
DesktopIpcHandlers registration of read and
command; preload's two IPC functions; DesktopBridge declarations in contracts/ipc;
and the two exact first-party names in scripts/lib/third-party-licenses.ts.
The native OrchestrationSearchThreadsInput and ProjectionSnapshotQuery also have
optional projectId/includeArchived filters used by the knowledge view; preserve
the SQL filtering before ranking/limit and its focused existing regression.
Original callers still default to global active-thread search.
Preserve the optional original messageId in search results and the scoped
readProjectConversationMessage service method for paged source reads, together
with WorkbenchKnowledgeRegistrationLive in the existing McpHttpServer pipeline.
These reuse native storage and transport; they do not use mailbox credentials.
Git baseline and fixed-range reads add vcs.readHead/vcs.compareCommits to the existing GitWorkflowService, RPC
contracts/handler/read-scope table and client-runtime VCS command collection.
Preserve these shared hooks; no separate Git runner or network listener is added.
The server ProviderCommandReactor also retains successful sendTurn results as
provider.turn.request-linked activities (messageId/startCommandId and actual
turnId). Preserve that small business-event hook and its existing reactor test;
it does not change native transport or infer token ownership from timestamps.
ProviderRuntimeIngestion also projects successful Codex source-read results into
consultedSource metadata on the existing completed-tool activity. Preserve this
small hook and its focused test; it does not add event rows or duplicate text.
Regenerate the TanStack route tree with the normal web build. Vite's external
source allowlist and old HTTP proxy belong to browser development, not the new
desktop IPC runtime. Do not migrate native T3 auth or ports. `check-host.mjs`
now reports missing shared integration markers as well as the external workspace
link; these are mechanical presence checks, not semantic compatibility proof.

The external business source can be reused while this host contract remains
compatible. Replacing a T3 checkout still requires retaining its finite host
integration changes; breaking T3, React, route, tooltip, or backend interfaces
require adaptation. Zero-adaptation upgrades are not promised.

Run the existing T3 consumer model and component tests, then the host typecheck.
First run `node check-host.mjs <T3-checkout-path>` from this package to verify
that the host resolves this external source, not an overwritten or stale copy.
This read-only check deliberately does not report interface compatibility.
Check the actual running Vite module and compiled CSS, not only TypeScript:
external board/detail layout classes must appear in the CSS output. Finish with
user-owned desktop/mobile visual and UX verification. Reinstall/upgrade rehearsal
and visual verification have not yet been completed for this package extraction.

The host declares pnpm 11.10.0 while the default executable is 11.19.0. Both
unfrozen dry runs proposed unrelated dependency changes and were not applied.
The existing cached 11.10.0 CLI completed an offline, scripts-disabled,
frozen-lockfile install after only the new workspace importer and host link were
added. The existing dependency graph was preserved; no package-manager version
was downloaded or existing dependency upgraded.

At initial extraction, the T3 consumer suite passed 14 model/component tests through the external
package. A fresh Tailwind 4.3.3 process discovered this package's `src/Page.tsx`
through the real host stylesheet and emitted both board and detail grid CSS.
After the existing Vite process reloaded its configuration to discard a cached
pre-install resolution failure, the thin host page, external page module, and
host stylesheet all returned HTTP 200. The host module references the external
package source. These checks do not replace visual or upgrade/reinstall
verification.

## Dependency Graph

Overview shows the dependency graph directly after project statistics. Tasks
defaults to `layout=graph`; explicit board/table searches remain supported.
The graph renders only current-view graph nodes and relationships. `BLOCKS`
arrows run from source to target; `DEPENDS_ON` arrows run from target to source.
Both are labeled "prerequisite for"; other relationship types retain their raw
direction and use dashed edges. Missing endpoints or duplicate node identifiers
produce an explicit error instead of fabricated nodes. Empty graphs stay empty.
Only returned Spec nodes with matching task records open task details; other
nodes show their returned metadata without requesting a bogus task endpoint.
Native node buttons and viewport controls provide keyboard access. Prerequisite
editing, manual completion, subgraph navigation and read-only mail supervision
are connected. Full orchestration, routing and structural editing remain under
development; current delivery and regression status is in ../../STATE.md.

Pinned MIT packages: `@xyflow/react` 12.11.6 and `@dagrejs/dagre` 3.1.1
(graphlib 4.0.5). Version-specific installed package manifests, ReactFlow props,
node/control types, CSS variables and Dagre exported types were inspected.
Each conversion owns a fresh directed multigraph and runs synchronous Dagre
layout; no shared mutable graph, network request or persistence is added.
ReactFlow owns viewport interaction and lifecycle. Host theme tokens are used;
the upstream stylesheet and attribution are retained.

Using pnpm 11.10.0, a scripts-disabled lockfile-only add followed by a frozen,
scripts-disabled install added 21 graph/transitive packages. Parsed lockfile
comparison confirmed every pre-existing package and snapshot unchanged, and
only this UI workspace importer changed. The project-local comparison snapshots
were removed after verification.

Graph contribution verification: all 23 host workbench tests pass (the prior
18 plus four graph conversion/direction/navigation/empty/error checks and an
overview integration check), and host
TypeScript passes with existing unrelated Effect suggestions. Tests exercise
the real Dagre conversion, not a mock layout. Browser rendering, desktop/mobile
viewport interaction and production deployment remain unverified; no service,
browser or model was started for this contribution.
