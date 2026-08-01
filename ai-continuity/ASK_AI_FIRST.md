# ASK_AI_FIRST

> **Procedure. Run it before every task. No exceptions.**
>
> This is not advice. Each step exists because skipping it has already cost
> this project a defect.

---

## STEP 0 — Orient (2 min, no commands)

Answer these from `FIRST_READ.md`. If you cannot, re-read it.

```
[ ] What is the default LLM_PROVIDER?                → mock
[ ] How many rows in validation_runs?                → 0
[ ] Is v1.0.0 released?                              → No. v1.0.0-rc.1 only.
[ ] What does a green test suite prove about
    real providers?                                  → Nothing.
```

---

## STEP 1 — Classify your task

```
┌─ Is it a bug fix in existing behavior?      → go to STEP 2
├─ Is it a new feature?                       → STOP. Read the warning below.
├─ Is it a refactor?                          → STOP. Read the warning below.
├─ Is it a doc change?                        → go to STEP 2 (still run tests)
└─ Is it an ops/config change?                → go to STEP 2, then TROUBLESHOOTING.md
```

> **Warning — new features and refactors.**
> This project is under **Code Freeze** as of Sprint 48. New features, large
> refactors, API changes, and DB structure changes are **forbidden** unless the
> owner explicitly lifts the freeze for your task. If you were not told the
> freeze is lifted, assume it is not. Ask.

---

## STEP 2 — Find the truth before you change it

Do not trust this documentation over the code. Docs drift; the code does not.

```bash
# 2a. What does the current behavior actually do?
grep -rn "<the-thing>" packages/core/src apps/api/src --include=*.ts | grep -v spec

# 2b. What test pins it? (If none, that is itself a finding.)
grep -rn "<the-thing>" packages/core/src apps/api/src --include=*.spec.ts

# 2c. Was this decided deliberately? Search the decision index.
grep -n "<the-thing>" ai-continuity/DECISION_LOG.md
```

**If step 2c finds a decision, you may not silently reverse it.** Decisions are
cited in code as `결정 NNNN-①` / `정책 NNNN-①`. Reversing one requires the
owner's approval, recorded the same way.

---

## STEP 3 — Locate the layer (this determines where your code goes)

```
Is it a PURE JUDGMENT?  (given these facts, what is the verdict?)
   → packages/core/src/…        no I/O, no Date.now() in the decision path,
                                no Prisma, no fetch
Is it an ADAPTER?        (talk to DB / HTTP / S3 / clock)
   → apps/api/src/…             wires I/O into the pure judgment
Is it a SCREEN?
   → apps/web/app/…             renders judgments; never re-judges
```

**Putting judgment in the adapter is the single most common architectural
mistake here.** If your new code contains both a decision and a `prisma.` call,
split it.

---

## STEP 4 — Check the rules that apply to your change

Open `AI_RULES.md` and read the sections matching your task. Minimum:

| If you touch… | Read rule |
| --- | --- |
| any controller / DTO | R1 (API is append-only) |
| a gate, check, or verdict | R2 (unknown ≠ pass), R3 (no bypass) |
| batch / AI calls | R4 (JobRunner), R5 (no double-buy) |
| provider adapters | R6 (stub ≠ connected), R7 (normalize usage) |
| pricing | R8 (never invent a price) |
| user-facing strings | R9 (no markdown in strings) |
| the runbook or ops docs | R10 (paths must exist) |
| anything deleted | R11 (pin the absence with a test) |

---

## STEP 5 — Make the change

Order matters:

```
1. Write / extend the test first when the change is behavioral.
2. Change pure judgment in @acos/core.
3. Wire the adapter in apps/api.
4. Surface it in apps/web only if a human must see it.
```

---

## STEP 6 — Verify (all of it, in this order)

```bash
pnpm build          # 6/6
pnpm typecheck      # 0
pnpm lint           # 0
pnpm test           # 2,963 → your number should be ≥ this
```

Then, if you touched anything operational, AI-facing, or job-related:

```bash
pnpm live:checks    # 11/11 — see TROUBLESHOOTING.md §1 to bring infra up
```

**A "unknown"/"판정하지 않음" result in live:checks is a FAILURE, not a pass.**
The script exits non-zero on purpose.

---

## STEP 7 — Prove your gate can fail

If you added or modified a check, gate, or guard: **deliberately break the
thing it guards and confirm the check goes red.** Then restore.

```
A check that has never been observed failing is not a check.
```

This step is not optional and has caught real defects (Sprint 48 C-4,
Sprint 49 runbook guard).

---

## STEP 8 — Report honestly

When you summarize your work:

- State what you verified **and how**.
- State what you did **not** verify, explicitly.
- Never write "should work", "presumably", or "verified" about a path you did
  not execute.
- If a test failed and you skipped it, say so in the first paragraph.

---

## The four mistakes this procedure prevents

| Mistake | Which step stops it |
| --- | --- |
| Reversing a deliberate decision without knowing it was one | STEP 2c |
| Putting judgment in the adapter | STEP 3 |
| Shipping a gate that can only ever be green | STEP 7 |
| Reporting stub success as real verification | STEP 0, STEP 8 |
