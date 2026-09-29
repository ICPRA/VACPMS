# VACPMS

**Visual Agent Collaboration Project Management System** — a local workbench for running projects where AI agents and humans collaborate: specs live as nodes in a queryable graph, work is dispatched into real AI chat sessions, and deliveries are tied to real Git commits.

[English](README.md) | [简体中文](README.zh-CN.md)

> Status: active development, single-machine setup. 26 of 31 planned capabilities are implemented in source; formal node merge (F27) and the final full check (F28) remain. No installer yet. Per-feature status: [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md).

## What it does

- **Spec graph as the project plan** — requirements and work items are nodes with intent, stage, versions, dependencies and named decisions; create drafts, approve them into execution, subdivide them, and trace why each decision exists.
- **Dispatch to native AI sessions** — a node is prepared and dispatched into a real T3 Code chat thread with a reviewed model/workspace. Preparation is idempotent: unknown outcomes are recovered with the original command identity instead of silently retrying, and a human confirms stops before write responsibility is released.
- **Deliveries anchored in Git** — Git is the only owner of files, commits, diffs and merges. Deliveries reference real commits; reviews compare fixed commit pairs. The system never copies the commit graph or invents authorship for unattributed changes.
- **Program nodes with bounded loops** — mechanical and innovation loops run with attempt budgets, explicit pass/unknown/fail outcomes, satisfaction judgments by named deciders, and escalation to a human when the budget is exhausted.
- **Agent mail** — nodes coordinate through bound-identity mail: send, reply, forward, acknowledge, close, hand off. Moving a mail thread does not move task ownership.
- **Knowledge search without hidden model calls** — one entry searches specs, files and past conversations; grouped results show why each source hit. Plain search never invokes a model; only an explicit "ask AI" action opens a native chat draft.
- **Bilingual UI** — 中文 or English.

## Which pain points it addresses, and how that looks

| Pain | Mechanism in VACPMS | What you (or your AI) do | What you observe |
|---|---|---|---|
| One endless chat with hundreds of subagent calls loses reliability under compression | Project state lives in a database, not a chat; conversations have independent lifecycles and tasks are handed over between them with explicit inheritance | The PM agent splits work into nodes and hands them between conversations; you can override in the dispatch panel | Each conversation's responsibility and inherited sources (requirements/commits/risks/open items) are listed on the dispatch panel |
| AI silently retries a write whose outcome is unknown | Idempotent writes: same request key finds the original preparation; unknown outcomes resume with the original command identity | Nothing — the program enforces it | The UI keeps a visible "outcome unknown" state instead of spawning a second execution |
| A disconnect gets misread as "stopped" and work is re-dispatched | Stop is request-then-confirm: request, observe, then a named confirmation before write responsibility is released | Request stop → see "request accepted" → wait for the host to actually confirm | "Request submitted" and "actually stopped" are distinct states; a lost lease never renders as stopped |
| Unclear who owns what | Three separate records: claim leases, run bindings, mail owners | Automatic; a human takes over via the two-phase "I'll handle it / hand back to AI" | The node shows the real owner, the run, and handover state |
| The model says "done" and that's accepted | Requirement/design review before implementation; test reports registered against a fixed commit; completion only after the agreed evidence | Reviewers approve/reject; the test conversation registers real results; you make the product-level call | Unreviewed / rejected / approved / untested / failed / passed are shown separately; "not run" is never hidden |
| Knowledge loss and repeated investigation | One search box over specs, files and past conversations; explicit ask-AI opens a native chat draft | Search once instead of three places; ask AI explicitly when wanted | Results are grouped by source with why-it-hit; failures, truncation and gaps are shown, not smoothed over |
| AI quietly widening scope or switching to a pricier model | Budgets define allowed models/concurrency; structural changes beyond them escalate | The AI works within the approved envelope; anything beyond escalates to you | The dispatch record shows the requested vs actual model and effort separately |
| False progress ("sent = working", "turn ended = done") | Separate axes for task state, execution attempts, collaboration and verification | Automatic, driven by real host events | Queued / started / waiting / unknown are distinct; nothing is painted green to hide a gap |

## Starting a project

There is no one-click "import existing project" feature today. Both paths share the same main line:

**New project.** A VACPMS project is a SpecGraph project: run `specgraph init <project-slug>` in the target repository (it writes `.specgraph.yaml` and agent-integration files), and the project appears in the workbench. Work items start as node **drafts** — from the UI or the PM agent — and only enter execution after explicit approval.

**Taking over an existing codebase.** Same main line, different evidence source: point the workbench at the repository/workspace, describe the change you want in natural language, and the PM agent reads the current state — existing capabilities, unknowns, conflicts — then proposes a breakdown. Nodes are created only after you review that proposal. Note: automatically attaching a repository's historical material (old commits, past conversations) to nodes is a design contract, not a finished feature; today the three-source search covers current files, specs and conversation history.

## How you work with the AI

The typical loop:

1. **You state the goal in natural language.** The PM agent reads the current state and proposes a breakdown into node drafts.
2. **You review and approve** the plan and its budget (allowed models, concurrency) on the workbench page. Requirement review → design review → test-case design all happen *before* implementation.
3. **The agent dispatches and executes.** Work runs in real T3 chat threads you can open at any time. Within the approved envelope the agent dispatches, subdivides and adjusts on its own — with a recorded trail.
4. **You review deliveries.** Each delivery is tied to a real commit, tested by a separate conversation against pre-designed cases, and completed only when the agreed evidence exists.
5. **Escalations come to you.** Scope/budget changes, ambiguous or repeatedly failing work, stop confirmations, and human-takeover handovers all require a named human decision — the system never silently resolves them.

The division of labor: semantic judgment (requirement soundness, relevance, satisfaction, merge strategy) belongs to the LLM or the human; storage, identity, authorization and concurrency/budget checks belong to the program. Unknowns are shown as unknown.

## Architecture at a glance

VACPMS is three repositories checked out **side by side under the same parent directory** (the launch scripts resolve them by name):

```
%USERPROFILE%\
├── project-workbench\   ← this repo: docs, extensions, launchers
├── specgraph-src\       ← fork of specgraph/specgraph, branch `workbench` (Go backend)
└── t3code-git\          ← fork of pingdotgg/t3code, branch `workbench` (desktop/web host)
```

- The **specgraph fork** serves the workbench API on `:8690` (specs, nodes, runs, mail, knowledge, delivery hooks) against PostgreSQL.
- The **t3code fork** renders the workbench page and owns AI sessions; it links `extensions/workbench-ui` and `extensions/workbench-mail` from this repo as pnpm workspace packages.
- **This repo** glues them together: `desktop-runtime.json` points at the sibling checkouts with relative paths.

## For humans

You need exactly two things:

1. **Software on the machine**: Windows, PostgreSQL 17, Go, Node.js + pnpm + vite-plus (`vp`), T3 Code desktop. (Your AI agent can install these too — skip to 2.)
2. **An AI agent running on that machine** (Claude Code, Kimi Code, Codex, …).

Then tell the agent:

> Set up and start VACPMS. The repositories are `github.com/ICPRA/VACPMS` plus its two forks `ICPRA/specgraph` and `ICPRA/t3code` (`workbench` branches). Follow the "For AI agents" section of the README.

Everything below that line — cloning, building, config files, credentials, mailbox, startup, verification — is the agent's job, not yours.

## For AI agents: setup

Steps (layout as shown in the architecture section above):

1. Clone the three repos into the sibling layout; check out `workbench` on both forks.
2. Build the backend: `cd specgraph-src && go build -o specgraph.exe ./cmd/specgraph`.
3. Create `project-workbench/specgraph-config.yaml` (gitignored): `server.listen` (:8690), `server.backend`, `server.postgres.url` (the PostgreSQL 17 instance), `client.default_server`. Verify with one foreground run of `specgraph.exe serve --config ...`.
4. Host deps: `cd t3code-git && pnpm install` (pnpm workspace links `project-workbench/extensions/workbench-ui` and `workbench-mail`).
5. Start the stack: run `project-workbench/start-workbench-stack.bat`. It auto-supervises specgraph (:8690) and the vite client (:5733) and launches T3 Code. Logs: `logs-specgraph.txt`, `logs-vite.txt`. Stop with `stop-workbench-stack.bat`.
6. Create the operator credential: `specgraph auth api-key create` against the running server; sign in on the workbench page with it, then run the one-time mailbox setup command there (creates a reader-scoped service credential under `runtime/t3-desktop/mail-secrets`, ACL-locked to the current user).
7. Verify: specgraph answers on :8690, vite on :5733, and `node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git` reports all integration markers present.

Alternative entry after a desktop build exists in `t3code-git`: `launch-vacpms.bat` runs the built source desktop directly (no vite dev server; requires Docker). Contract details: `extensions/workbench-desktop/README.md`.

## For AI agents: operating the workbench

You operate VACPMS on the user's behalf — through the PM/agent tools and the workbench API, not by handing the user instructions.

- Business contracts and invariants: [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md). Current per-feature truth: [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md). Remaining work: [TODO.md](TODO.md).
- Plan: create node drafts, get explicit approval into execution, subdivide with recorded reasons, manage dependencies.
- Dispatch: prepare with the reviewed project/workspace/model, and never silently retry a write whose outcome is unknown — resume with the original command identity. Stops are request-then-confirm.
- Deliveries anchor to real Git commits; register test reports against the delivery, then complete. Human-owned work uses manual completion — never fabricate an AI session.
- Coordinate between nodes with bound-identity mail; answer knowledge questions through the three-source search; plain search never calls a model.
- Semantic judgment is yours (or the human's); storage, identity, authorization and concurrency checks are the program's. Show unknowns as unknown.

## Repository layout

| Repository | Role | License |
|---|---|---|
| `project-workbench` (this repo) | Product docs, workbench extensions, launcher scripts, `kimi-cursor-shim` | Apache-2.0 |
| `specgraph-src` | Fork of [specgraph/specgraph](https://github.com/specgraph/specgraph) — `workbench` branch: backend subsystem (Go + PostgreSQL) | Apache-2.0 (`FORK-NOTICE.md`) |
| `t3code-git` | Fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — `workbench` branch: workbench page, i18n, desktop IPC, server hooks | Upstream license |

## Development

- Backend: `go build ./...`, focused `go test` (PostgreSQL-gated tests skip without their env vars).
- Host: `pnpm run typecheck`, targeted `vp test`.
- After touching host integration points: `node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git`.
- Upstream sync: `git fetch upstream` in each fork, then rebase the `workbench` branch.
- `extensions/workbench-ui/t3-workbench-host.patch` is a snapshot; the git branch is authoritative.

## Documentation

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) — business contracts and design decisions
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) — per-feature status (F01–F31)
- [TODO.md](TODO.md) — remaining actions only
- [STATE.md](STATE.md) — chronological implementation evidence
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) — QA flow: requirement review → design review → test design → implementation → delivery testing
- [design-drafts/](design-drafts/) — UI drafts

## License

[Apache-2.0](LICENSE) (see `NOTICE`). The two forks retain their upstream licenses; the specgraph fork carries a `FORK-NOTICE.md` per Apache-2.0 §4(b).
