# Repository reconciliation — 2026-10-03

The user explicitly designated `/home/aryan/Documents/Codex/2026-09-12/bu/outputs/designflow` as the authoritative backend. `NekoArch` is an independent experimental frontend/visualization workspace. They must remain separate. Its absence is not a backend release blocker. No frontend source, scripts or dependencies were added, copied or recovered.

## Observed state and history

Incoming branch: `main`. Incoming HEAD: `f17a33703b226117ad3cbfa4f25a1889dccce71b`. Working tree was clean. One registered worktree. The existing lightweight tag `backend-v1-phase19-complete` points directly to this commit. Its sole parent is `094e6856a61abfeee78881dbc98fe34ef10eb970`, the Phase 18 checkpoint. No Phase 20 completion tag exists.

`git log --all -- packages/generator/src/solver-v2 apps/api/src/ai/conversation-planner.ts supabase/migrations/0012_conversations.sql` identifies **the same commit, f17a337**, as introducing both implementations into reachable Git history. Its message names only Phase 19. The commit also adds Phase 20 evidence and deletes the old frontend README. There is no separate Phase 19-only implementation commit followed by a Phase 20 implementation commit. The local reflog records one ordinary commit operation. Git establishes that the combined working state was committed together; it cannot establish whether including Phase 20 was intentional or accidental.

Historical reports describe different working states. Before an interrupted audit the sibling `outputs/NekoArch` existed at Phase 18 with uncommitted backend code and untracked frontend files; on resumption it was absent. No completed cross-copy hash comparison exists, so no file identity or relocation cause is claimed. The user's architecture clarification resolves source authority without a speculative merge. Earlier frontend build claims remain historical evidence only and do not apply to this intentionally backend-only checkout. The Windows path is not mounted in this environment.

## Preservation and release strategy

The incoming 659 tracked files were SHA-256 inventoried and copied into `/tmp/designflow-stabilization-incoming.tar.gz`; every archived file was read back and checked. `/tmp/designflow-stabilization-history.bundle` contains all Git refs and passed `git bundle verify`. Paths and hashes are in [incoming.json](stabilization-evidence/incoming.json). These are local temporary recovery artifacts, not durable off-machine backups.

No commit, staging operation, branch switch, tag change, push, merge, deployment, reset or migration rewrite was performed. Existing history is retained. A Phase 19-only checkpoint cannot be obtained by simply tagging an existing intermediate commit: there is none. Reconstructing it would require a separate branch from Phase 18, manual separation of shared integration changes, and independent verification. It is unnecessary for finalizing the current combined backend and was not attempted.

Recommended correction: document the existing tag as a historical combined implementation snapshot; append one stabilization/verification commit containing the actual fixes and evidence; after review, add a new Phase 19 verification tag and the new Phase 20 completion tag to that same combined snapshot. Do not move the existing Phase 19 tag or claim that the new snapshot contains only one phase. Proposed commands and final readiness appear in [stabilization-report.md](stabilization-report.md).


Final recovery check: the original `/tmp` files were no longer present at handoff. The clean incoming source was reconstructed from unchanged Git HEAD and all 659 file hashes reverified. Replacement source archive and verified history bundle are in `/home/aryan/.codex/visualizations/2026/10/03/01a1014c-bebc-73f1-b0ce-d7bc8e1f1807/recovery`; [incoming.json](stabilization-evidence/incoming.json) records their SHA-256 hashes. These local copies are not off-machine backups.
