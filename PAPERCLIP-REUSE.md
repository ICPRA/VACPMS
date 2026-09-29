# Paperclip Source Reuse

Approved route: limited source reuse only. No Paperclip server, alternative
control plane, takeover switch, or duplicate task/approval authority.

## Fixed Source

- Repository: https://github.com/paperclipai/paperclip
- Commit: `7b7c4d4172d6aac14919e2682b702ae87bc17653`
- File: `server/src/services/issue-execution-policy.ts`
- Source URL: https://github.com/paperclipai/paperclip/blob/7b7c4d4172d6aac14919e2682b702ae87bc17653/server/src/services/issue-execution-policy.ts
- License URL: https://github.com/paperclipai/paperclip/blob/7b7c4d4172d6aac14919e2682b702ae87bc17653/LICENSE

The source and license were read during the assessment. The local consumer
boundary below records the implementation; this document does not establish
deployment or real Agent usage.

## Selected Semantics

`actorPrincipal` and `principalsEqual` distinguish an agent from a user before
comparing identity. A shared API key alone cannot identify a reviewer run.

The changes-requested transition in `applyIssueExecutionStageTransition`
resets the unattended round count for a human decision and increments it for
an Agent decision. Count explicit current review requests, not every historical
rejection. A revised requirements/design proposal or reviewer assignment must not erase the unresolved
review cycle. Historical re-review must not release a current human hold.

Upstream `resolveMaxReviewRounds` defaults to three. That is a configurable
upstream policy, not an independently confirmed VACPMS requirement.

## Required Local Differences

- Do not adopt the all-self-review auto-skip in `canAutoSkipPendingStage`.
- Use verified stored account kind plus host-bound Agent identity. Unknown is
  not human; different sessions are not proof of operating-system isolation.
- Apply review to requirements and design before implementation. Do not force
  these objects into the existing delivery-only `acceptances` contract.
- Preserve explicit independent reviewer assignment and a real human handling
  destination. Missing ownership must not masquerade as successful escalation.
- An approved requirements review advances design work; an approved design and
  pre-implementation test plan permit implementation within the approved scope.
  Neither approval completes code delivery. Delivered artifacts execute tests.
- Do not add a generic idempotency framework, document snapshots, or exact
  preview-equality gates. One effective Agent decision belongs to its explicit
  review request; human historical re-review remains a separate appendable fact.

## Current Implementation Boundary

The existing user record already contains human/service-account kind. Its
internal propagation was explicitly authorized and implemented, with six
targeted checks. Unknown stays unknown; the field is excluded from JSON.
No owner metadata, public response, privilege, or database read was added.
The delivery-only draft was superseded by the pre-execution QA implementation.
Requirements/design reviews use their original source-review records and
explicit independent assignments. An accepted review with a submitted
completionRunId calls the original completion owner for that authoring run;
without that association it records the review only. A blocked completion keeps
the approval and can be retried without inventing a second review.

PrepareRun and actual dispatch authorization consume the same QA-basis checks.
Design requires its applicable requirements approval; implementation requires
requirements/design approvals and fixed test-plan sources. Code completion
still requires the applicable test reports. Approval does not itself create or
start another model session. Host-bound tools, dispatch and saved harness inputs
use these existing paths; there is no additional progression service.

The 2026-09-27 source audit traced these consumers and the existing
authoring_completion, dispatch_qa, source_review, tool and dispatch tests.
It did not rerun tests, modify the deployed database, or verify real Agent use.
Prior execution evidence and remaining Q1-Q8 coverage are recorded in STATE.md
and QA-TEST-PLAN.md. No Paperclip service or takeover alternative is involved.

## Upstream License

MIT License

Copyright (c) 2025 Paperclip AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
