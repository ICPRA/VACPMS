# VACPMS

**Visual Agent Collaboration Project Management System** — a local workbench for running projects where AI agents and humans collaborate: specs live as nodes in a queryable graph, work is dispatched into real AI chat sessions, and deliveries are tied to real Git commits.

[English](README.md) | [简体中文](README.zh-CN.md)

> Status: active development, single-machine setup. 26 of 31 planned capabilities are implemented in source; formal node merge (F27) and the final full check (F28) remain. No installer yet. Per-feature status: [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md).

## For humans

You need exactly two things:

1. **Software on the machine**: Windows, PostgreSQL 17, Go, Node.js + pnpm + vite-plus (`vp`), T3 Code desktop. (Your AI agent can install these too — skip to 2.)
2. **An AI agent running on that machine** (Claude Code, Kimi Code, Codex, …).

Then tell the agent:

> Set up and start VACPMS. The repositories are `github.com/ICPRA/VACPMS` plus its two forks `ICPRA/specgraph` and `ICPRA/t3code` (`workbench` branches). Follow the "For AI agents" section of the README.

Everything below that line — cloning, building, config files, credentials, mailbox, startup, verification — is the agent's job, not yours.

## For AI agents: setup

Target layout — three sibling checkouts under the same parent (launch scripts resolve them by name):

```
%USERPROFILE%\
├── project-workbench\   ← this repo (VACPMS)
├── specgraph-src\       ← ICPRA/specgraph fork, branch `workbench` (Go backend)
└── t3code-git\          ← ICPRA/t3code fork, branch `workbench` (desktop/web host)
```

Steps:

1. Clone the three repos into that layout; check out `workbench` on both forks.
2. Build the backend: `cd specgraph-src && go build -o specgraph.exe ./cmd/specgraph`.
3. Create `project-workbench/specgraph-config.yaml` (gitignored): `server.listen` (:8690), `server.backend`, `server.postgres.url` (the PostgreSQL 17 instance), `client.default_server`. Verify with `specgraph.exe serve --config ...` once in the foreground.
4. Host deps: `cd t3code-git && pnpm install` (pnpm workspace links `project-workbench/extensions/workbench-ui` and `workbench-mail`).
5. Start the stack: run `project-workbench/start-workbench-stack.bat`. It auto-supervises specgraph (:8690) and the vite client (:5733) and launches T3 Code. Logs: `logs-specgraph.txt`, `logs-vite.txt`. Stop with `stop-workbench-stack.bat`.
6. Create the operator credential: `specgraph auth api-key create` against the running server; use it to sign in on the workbench page, then run the one-time mailbox setup command there (it creates a reader-scoped service credential under `runtime/t3-desktop/mail-secrets`, ACL-locked to the current user).
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
- Upstream sync: `git fetch upstream` in each fork, then rebase the `workbench` branch.
- `extensions/workbench-ui/t3-workbench-host.patch` is a snapshot; the git branch is authoritative.

## Documentation

[PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) · [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) · [TODO.md](TODO.md) · [STATE.md](STATE.md) · [QA-TEST-PLAN.md](QA-TEST-PLAN.md) · [design-drafts/](design-drafts/)

## License

[Apache-2.0](LICENSE) (see `NOTICE`). The two forks retain their upstream licenses.
