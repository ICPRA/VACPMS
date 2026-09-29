# VACPMS

**Visual Agent Collaboration Project Management System** — a local workbench for running projects where AI agents and humans collaborate: specs live as nodes in a queryable graph, work is dispatched into real AI chat sessions, and deliveries are tied to real Git commits.

[English](README.md) | [简体中文](README.zh-CN.md)

> Status: active development. 26 of 31 planned capabilities are implemented in source; formal node merge (F27) and the final full check (F28) remain. There is no packaged installer yet, and overall acceptance has not been performed. See [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) for the authoritative per-feature status.

## What it does

- **Spec graph as the project plan** — requirements and work items are nodes with intent, stage, versions, dependencies and named decisions; you create drafts, approve them into execution, subdivide or (formally) merge them, and trace why each decision exists.
- **Dispatch to native AI sessions** — a node is prepared and dispatched into a real T3 Code chat thread with the model/workspace you reviewed. Preparation is idempotent: unknown outcomes are recovered with the original command identity instead of silently retrying, and a human confirms stops before write responsibility is released.
- **Deliveries anchored in Git** — Git is the only owner of files, commits, diffs and merges. Deliveries reference real commits; reviews compare fixed commit pairs. The system never copies the commit graph or invents authorship for unattributed changes.
- **Program nodes with bounded loops** — mechanical and innovation loops run with attempt budgets, explicit pass/unknown/fail outcomes, satisfaction judgments by named deciders, and escalation to a human when the budget is exhausted.
- **Agent mail** — nodes coordinate through bound-identity mail: send, reply, forward, acknowledge, close, hand off. Moving a mail thread does not move task ownership.
- **Knowledge search without hidden model calls** — one entry searches specs, files and past conversations; grouped results show why each source hit. Plain search never invokes a model; only an explicit "ask AI" action opens a native chat draft with the question and source scope.
- **Bilingual UI** — the workbench page runs in 中文 or English.

A core design rule: semantic judgment (requirement soundness, relevance, satisfaction, merge strategy) belongs to the LLM/human in the conversation; the program supplies original sources, real identities, structured records, authorized operations and the necessary concurrency/budget checks. There is no semantic arbitration engine pretending otherwise.

## Repository layout

VACPMS is three sibling repositories that must be checked out side by side under the same parent directory:

| Repository | Role | License |
|---|---|---|
| `project-workbench` (this repo) | Product docs, workbench extensions (`@project-workbench/ui`, `@project-workbench/mail`, desktop stdio bridge), launcher scripts, `kimi-cursor-shim` | MIT |
| `specgraph-src` | Fork of [specgraph/specgraph](https://github.com/specgraph/specgraph) — the `workbench` branch adds the backend subsystem (Go + PostgreSQL): program loops, dispatch, knowledge, mail, delivery hooks | Apache-2.0 (see its `FORK-NOTICE.md`) |
| `t3code-git` | Fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code) — the `workbench` branch adds the workbench page, i18n, desktop IPC bridge and server hooks | Upstream license |

The forks track upstream and rebase onto it periodically; the customization lives in a single `workbench` commit/branch on each side. `desktop-runtime.json` in this repo binds the three checkouts together with relative paths.

## Running (current development setup)

Target platform today is Windows, with PostgreSQL 17 and Go, Node.js + pnpm (vite-plus) installed.

```bat
:: build the backend candidate from the specgraph fork, then from this repo:
start-workbench-stack.bat   :: supervises specgraph (:8690) and the vite client (:5733)
launch-t3-workbench.bat     :: starts T3 Code against the custom client
```

`launch-vacpms.bat` is the alternate entry that runs the built source desktop directly (no vite dev server). See `extensions/workbench-desktop/README.md` for the exact contract.

## Development

- Backend changes: `specgraph-src` `workbench` branch; `go build ./...`, focused `go test` runs (PostgreSQL-gated tests skip without their env vars).
- Host changes: `t3code-git` `workbench` branch; `pnpm install`, `pnpm run typecheck`, targeted `vp test` runs.
- After touching host integration points, run `node extensions/workbench-ui/check-host.mjs <t3code checkout>` to verify the markers survived.
- `extensions/workbench-ui/t3-workbench-host.patch` is a regenerated snapshot of the 68 dedicated host files; the git branch is authoritative.

## Documentation

- [PRODUCT-DESIGN.md](PRODUCT-DESIGN.md) — business contracts and design decisions
- [REQUIREMENTS-REVIEW.md](REQUIREMENTS-REVIEW.md) — per-feature status (F01–F31)
- [TODO.md](TODO.md) — remaining actions only
- [STATE.md](STATE.md) — chronological implementation evidence
- [QA-TEST-PLAN.md](QA-TEST-PLAN.md) — QA flow: requirement review → design review → test design → implementation → delivery testing
- [design-drafts/](design-drafts/) — UI drafts

## License

This repository is [MIT](LICENSE). The two forks retain their upstream licenses; the specgraph fork carries a `FORK-NOTICE.md` per Apache-2.0 §4(b).
