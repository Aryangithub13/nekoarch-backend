# Release run 1: passed, evidence set invalidated by operator error

Run 1 (frozen manifest `16c02eb674a7e133c0715b5e7bb3a14b1951b355fbd91dc574e3865ad3d103d0`, 442 files) completed
62/62 gates exit 0, all `sourceUnchanged`/`untouchedDirectoriesUnchanged` true, mutation 37/37. The complete per-gate
record is the harness stdout in `harness-stdout-62-gates.log`.

After it finished, the operator ran `verify-phase28.py --help` while inspecting results. The harness does not parse
`--help`; it began a new full run that rewrote `final/verification.json` (6 rows), the logs of gates 1-6 (tag lookups,
baseline ancestor, Phase 24 audit reproduction) and `tested-source-sha256.json` (same digest), then exited on SIGPIPE
before gate 7. No source, database or other evidence was changed. Because `final/` then mixed two invocations,
the set was archived unpromoted and release run 2 was executed from scratch on the same frozen source.
