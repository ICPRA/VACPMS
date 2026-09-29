# VACPMS

**Visual Agent Collaboration Project Management System** — a local workbench for running projects where AI agents and humans collaborate: specs live as nodes in a queryable graph, work is dispatched into real AI chat sessions, and deliveries are tied to real Git commits.

[English](README.md) | [简体中文](README.zh-CN.md)

> Status: active development, single-machine setup. 26 of 31 planned capabilities are implemented in source; formal node merge (F27) and the final full check (F28) remain. There is no installer and no new-machine bootstrap yet — the steps below describe how the author's machine is wired. Per-feature status: [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md).

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

## Setup

Prerequisites: Windows, PostgreSQL 17 (native service or Docker), Go, Node.js + pnpm + [vite-plus](https://viteplus.dev) (`vp`), and the T3 Code desktop app installed.

```bat
:: 1. clone the three repos side by side (see layout above), forks on branch `workbench`

:: 2. build the backend (produces specgraph.exe in specgraph-src)
cd %USERPROFILE%\specgraph-src
go build -o specgraph.exe ./cmd/specgraph

:: 3. create %USERPROFILE%\project-workbench\specgraph-config.yaml (gitignored)
::    fields: server.listen / server.backend / server.postgres.url / client.default_server

:: 4. install host dependencies (links the two extension packages via pnpm workspace)
cd %USERPROFILE%\t3code-git
pnpm install
```

## Running

```bat
cd %USERPROFILE%\project-workbench
start-workbench-stack.bat
```

This starts an auto-restarting specgraph on `:8690` and the custom vite client on `:5733` (logs: `logs-specgraph.txt`, `logs-vite.txt`), then launches T3 Code. `stop-workbench-stack.bat` stops the two services.

Alternative entry: `launch-vacpms.bat` runs the **built** source desktop directly via `extensions/workbench-desktop/launch.mjs` — no vite dev server needed, but requires a prior desktop build in `t3code-git` and Docker running. Details: `extensions/workbench-desktop/README.md`.

## Daily workflow

1. **Open the workbench** — sidebar → Workbench (switchable between 中文 and English). Sign in with the operator credential; mail features additionally need the one-time mailbox setup command.
2. **Plan** — the overview shows the project graph, kanban and dependency views. Create a node draft, then explicitly approve it into execution. Subdivide large nodes; add/remove dependencies with recorded reasons.
3. **Dispatch** — on a node, pick the T3 project, workspace and model, tick the review checkbox, then *Create and dispatch*. The AI works in a real T3 chat thread you can open and inspect. If a prepare/dispatch outcome is unknown, the UI offers *Resume original dispatch* with the original command identity — it never silently retries. Stopping a run is request-then-confirm; a released node is never left writing.
4. **Review deliveries** — the agent's work lands as real Git commits in its workspace. Submit the delivery, register the test report against it, then complete the node (or mark human-done work with manual completion).
5. **Coordinate** — nodes exchange bound-identity mail (reply/forward/ack/close/hand-off). The knowledge search queries specs, files and past conversations from one box; plain search never calls a model — only an explicit *ask AI* opens a native chat draft.

A core design rule: semantic judgment (requirement soundness, relevance, satisfaction, merge strategy) belongs to the LLM/human in the conversation; the program supplies original sources, real identities, structured records, authorized operations and concurrency/budget checks. Unknowns are shown as unknown.

## Development

- Backend: `specgraph-src` `workbench` branch; `go build ./...`, focused `go test` (PostgreSQL-gated tests skip without their env vars).
- Host: `t3code-git` `workbench` branch; `pnpm install`, `pnpm run typecheck`, targeted `vp test`.
- After touching host integration points: `node extensions/workbench-ui/check-host.mjs %USERPROFILE%\t3code-git`.
- `extensions/workbench-ui/t3-workbench-host.patch` is a regenerated snapshot of the 68 dedicated host files; the git branch is authoritative.
- Upstream sync: `git fetch upstream` in each fork, then rebase the `workbench` branch.

## Documentation

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) — business contracts and design decisions
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) — per-feature status (F01–F31)
- [TODO.md](TODO.md) — remaining actions only
- [STATE.md](STATE.md) — chronological implementation evidence
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) — QA flow: requirement review → design review → test design → implementation → delivery testing
- [design-drafts/](design-drafts/) — UI drafts

## License

[Apache-2.0](LICENSE) (see `NOTICE`). The two forks retain their upstream licenses; the specgraph fork carries a `FORK-NOTICE.md` per Apache-2.0 §4(b).
