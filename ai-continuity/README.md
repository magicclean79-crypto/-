# AI_CONTINUITY — start here

> You unpacked this because you are taking over **AI Product Content OS
> (ACOS)**. This archive is self-contained: everything you need to understand
> the project is here, and nothing here requires the repository to read.
>
> **Open `FIRST_READ.md` now.** It takes 5 minutes and tells you what to read
> next.

---

## What is in this archive

### Core handover — written for an AI, read in this order

| # | File | Minutes |
| --- | --- | --- |
| 1 | `FIRST_READ.md` | 5 — **start here** |
| 2 | `ASK_AI_FIRST.md` | 5 — the procedure to run before any change |
| 3 | `AI_RULES.md` | 5 — hard rules + where each is enforced |
| 4 | `PROJECT_PHILOSOPHY.md` | 5 — what must never change, and the incident behind each rule |
| 5 | `SYSTEM_MAP.md` | 5 — folders, DB, API, providers |
| 6 | `ARCHITECTURE.md` | 5 — layers and dataflow |
| 7 | `AI_HANDOVER.md` | 5 — full project state, domain by domain |
| 8 | `DECISION_LOG.md` | reference — 162 decisions, indexed to the code |
| 9 | `TROUBLESHOOTING.md` | reference — diagnostic procedures |
| 10 | `PROMPT_GUIDE.md` | reference — only if you touch prompts |

**Minimum to start working: 1-5. About 25 minutes.**

### `repo-docs/` — the project's own documents, unmodified

```
README.md                 project entry point
AGENTS.md                 collaboration rules
TASKS.md                  85 completed TASKs, Sprint 1 → 50 (the narrative history)
KNOWN_LIMITATIONS.md      honest list of what does not work
OPERATIONS_RUNBOOK.md     on-call procedures
USER_GUIDE.md             end-user instructions
MIGRATION_GUIDE.md        how to stand the system up
RELEASE_CHECKLIST.md      the 7 items blocking release
RELEASE_READINESS.md      release-prep status
RELEASE_NOTES_v1.0.md     draft release notes (not finalized)

reports/
  CTO_REPORT.md               current technical truth
  CTO_REQUEST.md              open questions for the owner (#85)
  CTO_FINAL_RELEASE_REPORT.md final release judgment
  RELEASE_BLOCKER_REPORT.md   what blocks v1.0.0 and how to unblock it
  GO_LIVE_REPORT.md           the product's own go-live verdict
  CTO_RELEASE_REPORT.md       the earlier RC judgment
```

---

## The three facts to carry before you read anything else

1. **`LLM_PROVIDER=mock` is the default and this system has never run against
   a real AI provider.** `validation_runs` has 0 rows. Every green result you
   will see was earned against our own stubs.

2. **`v1.0.0` was deliberately NOT tagged**, at Sprint 50, with every gate
   green. A version number that asserts verification was withheld because
   verification had not happened. `v1.0.0-rc.1` is the current tag.

3. **Unknown is never pass.** If a check cannot tell, it must say so. Roughly
   half this codebase exists to keep that distinction intact.

---

## If the repository is also available to you

```bash
cat ai-continuity/FIRST_READ.md      # same files, kept in sync with the code
```

The docs in this archive were generated from the repository at
**commit-time 2026-08-01** and every file path, constant, and count in them was
machine-verified against the source at that moment. If the code has moved on,
trust the code — and regenerate `DECISION_LOG.md` §3 with the script in its §4.
