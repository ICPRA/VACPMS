# VACPMS

**Visual Agent Collaboration Project Management System** — a local workbench for running projects where AI agents and humans collaborate: specs live as nodes in a queryable graph, work is dispatched into real AI chat sessions, and deliveries are tied to real Git commits.

[English](README.md) | [简体中文](README.zh-CN.md)

> Status: active development, single-machine setup. 26 of 31 planned capabilities are implemented in source; formal node merge (F27) and the final full check (F28) remain. No installer yet. Per-feature status: [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md).

## What it does

- **Spec graph as the project plan** — requirements and work items are nodes with intent, stage, versions, dependencies and named decisions; create drafts, approve them into execution, subdivide them, and trace why each decision exists.
- **Dispatch to native AI sessions** — a node is prepared and dispatched into a real T3 Code chat thread with a reviewed model/workspace. Preparation is idempotent: unknown outcomes are recovered with the original command identity instead of silently retrying, and a human confirms stops before write responsibility is released.
- **Deliveries anchored in Git** — Git is the only owner of files, commits, diffs and merges. Deliveries reference real commits; reviews compare fixed commit pairs.
- **Program nodes with bounded loops** — mechanical and innovation loops with attempt budgets, explicit pass/unknown/fail outcomes, and escalation to a human when the budget is exhausted.
- **Agent mail** — nodes coordinate through bound-identity mail with read receipts and handover records.
- **Knowledge search without hidden model calls** — one entry searches specs, files and past conversations; plain search never invokes a model.
- **Bilingual UI** — 中文 or English.

## Which pain points it addresses, and how that looks

| Pain | Mechanism in VACPMS | What you (or your AI) do | What you observe |
|---|---|---|---|
| One endless chat with hundreds of subagent calls loses reliability under compression | Project state lives in a database, not a chat; conversations have independent lifecycles and tasks are handed over between them with explicit inheritance | The PM agent splits work into nodes and hands them between conversations; you can override in the dispatch panel | Each conversation's responsibility and inherited sources (requirements/commits/risks/open items) are listed on the dispatch panel |
| Concurrent tasks stepping on each other; nobody knows who is writing where | Every execution holds a claim lease and a run binding; write responsibility is isolated per node; concurrency is capped by the approved budget | The AI dispatches in parallel along the dependency graph; the concurrency ceiling is set when you approve the plan | The overview shows nodes progressing in parallel, each with its owner and state; a node never has two writers |
| Work as a linear pipeline where one change ripples through everything | The project is a graph of nodes plus dependencies: subdividable, groupable into sub-graphs, advanced in parallel along edges | Dependencies are declared during breakdown, each edge with a recorded reason | The 任务与依赖 (Tasks & dependencies) tab renders the actual network in the dependency graph and kanban, not a one-dimensional list |
| No view of the overall structure at design time — you wait for the AI's lucky shot, or mine structure out of a bloated AI plan | Requirement/design review happens before any code; the breakdown is a structured node graph — structure first, execution after | You see the complete proposed breakdown before approving anything | The moment you approve, the graph shows the final structure: every node's goal, boundaries and dependencies, queryable and reviewable |
| A human stepping into one node pollutes every other node's context | Each conversation has an independent lifecycle; a node's context comes from its structured work package, not a shared chat log; takeover is a two-phase handover scoped to that node | Press「我来处理：开始具名接手」on that node only | Other nodes' sessions and work packages are untouched; the takeover record attaches to this node alone |
| AI silently retries a write whose outcome is unknown | Idempotent writes: same request key finds the original preparation; unknown outcomes resume with the original command identity | Nothing — the program enforces it | The UI keeps a visible "outcome unknown" state instead of spawning a second execution |
| A disconnect gets misread as "stopped" and work is re-dispatched | Stop is request-then-confirm: request, observe, then a named confirmation before write responsibility is released | Request stop → see "request accepted" → wait for the host to actually confirm | "Request submitted" and "actually stopped" are distinct states; a lost lease never renders as stopped |
| Unclear who owns what | Three separate records: claim leases, run bindings, mail owners | Automatic; a human takes over via the two-phase "I'll handle it / hand back to AI" | The node shows the real owner, the run, and handover state |
| The model says "done" and that's accepted | Requirement/design review before implementation; test reports registered against a fixed commit; completion only after the agreed evidence | Reviewers approve/reject; the test conversation registers real results; you make the product-level call | Unreviewed / rejected / approved / untested / failed / passed are shown separately; "not run" is never hidden |
| Knowledge loss and repeated investigation | One search box over specs, files and past conversations; explicit ask-AI opens a native chat draft | Search once instead of three places; ask AI explicitly when wanted | Results are grouped by source with why-it-hit; failures, truncation and gaps are shown, not smoothed over |
| AI quietly widening scope or switching to a pricier model | Budgets define allowed models/concurrency; structural changes beyond them escalate | The AI works within the approved envelope; anything beyond escalates to you | The dispatch record shows the requested vs actual model and effort separately |
| False progress ("sent = working", "turn ended = done") | Separate axes for task state, execution attempts, collaboration and verification | Automatic, driven by real host events | Queued / started / waiting / unknown are distinct; nothing is painted green to hide a gap |

## Starting a project

You never touch a CLI for this — your AI agent does. There is no one-click "import existing project" feature today; both paths share the same main line:

**New project.** Tell your AI what you want to build. It creates the SpecGraph project in the target repository (`specgraph init`), and the project appears in the workbench's project dropdown. Work items start as node **drafts** — nothing executes until you approve.

**Taking over an existing codebase.** Point the workbench at the repository/workspace and describe the change you want in natural language. The AI reads the current state — existing capabilities, unknowns, conflicts — and proposes a breakdown; nodes are created only after you review that proposal. Note: automatically attaching a repository's historical material (old commits, past conversations) to nodes is a design contract, not a finished feature; today the three-source search covers current files, specs and conversation history.

## A task's full loop, screen by screen

The workbench page has seven tabs: 概览 (Overview) · 任务与依赖 (Tasks & dependencies) · 执行会话 (Sessions) · 协作 (Collaboration) · 待处理 (Pending) · 验收 (Acceptance) · 资料 (Sources). Each step below says who acts — **you** or **the AI** — and exactly where it happens in the UI (labels quoted from the Chinese UI).

1. **State the goal — you.** Tell the AI in plain language. It creates node drafts (or you press **+「新建需求节点」** in the top bar and fill in「节点标识」「需求目标」「优先级」「复杂度」). The new nodes appear on 任务与依赖.
2. **Approve — you.** Open the node's detail panel, press「审核并允许执行」, fill in「审核依据」(review rationale), press「批准执行」. If the node changed in the meantime the panel asks you to「刷新节点」first — nothing approves against a stale version.
3. **Dispatch — the AI prepares, you confirm.** In the node's「执行与分派」section: pick the「T3 项目」and「执行工作区」(shared directory, or「创建隔离工作树」for an isolated git worktree), set「本次派单职责」(manager / knowledge / executor / reviewer). Tick「确认以上项目、现有目录、模型及权限设置，并派发当前任务。」then press「创建并派发」. The response says plainly「T3 已接受命令；不代表模型已经开始执行。」If anything's outcome was uncertain, the button becomes「恢复原派发」and resumes with the original command identity — a second execution is never spawned.
4. **Watch — you, optionally.** The 执行会话 tab lists run cards with model, workspace, token usage and linked file diffs;「查看 T3 原会话」opens the real chat thread. The thread view's top right carries a「返回工作台 / Back to workbench」chip (returns to the exact workbench view you left, tab and selected node restored) plus generic back/forward buttons — also bound app-wide to Alt+← / Alt+→, multi-level. The 待处理 tab collects everything waiting on a human: reviews, stuck loops, unclosed mail, untested deliveries.
5. **Accept the delivery — you.** The AI submits its delivery from its session (the host binds the real Git HEAD automatically). On the 验收 tab or in the node detail, open「交付与最新验收记录」→「查看交付证据」. The test conversation registers a「测试报告」against the fixed commit (method, result, exit code — a nonzero exit can't be registered as passed). When the agreed evidence exists,「按测试结果完成任务」appears. Work you did yourself goes through「人工完成」— the UI states clearly that this is a human record, not technical verification.
6. **Stop or withdraw — you.**「请求停止原会话」→ the UI says「停止命令已受理；不代表会话已停止」→ once the live session is actually stopped, fill in「停止确认依据」and press「记录停止确认」. To retire a node entirely:「使节点失效」with a recorded reason (it never stops sessions for you first).
7. **Coordinate — mostly the AI.** The 协作 tab is the mail inbox: threads with per-recipient read receipts, takeover records, and「设置本机邮箱」(one-time). Sending/replying is the agents' job via their tools. The 资料 tab is the three-source search box;「在对话中提问」drops your question into a T3 chat draft — plain search never calls a model.

The division of labor underneath: semantic judgment (requirement soundness, relevance, satisfaction, merge strategy) belongs to the LLM or the human; storage, identity, authorization and concurrency/budget checks belong to the program. Unknowns are shown as unknown.

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
