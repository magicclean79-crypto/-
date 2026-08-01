# AI_RULES

> Hard rules. Each one is listed with **where it is enforced**, so you can
> verify the rule rather than trust this file.
>
> `ENFORCED` = a test fails if you break it.
> `CONVENTION` = no test catches it; a reviewer will.

---

## R1 — The API is append-only `ENFORCED`

**Never** rename, remove, retype, or repurpose an existing response field,
route, or status code. Add new fields only.

```
enforce  apps/api/src/… *.spec.ts (response-shape assertions)
         live check `existing-responses-unchanged` — pins the exact 404 body
why      Screens, scripts, and the operator's muscle memory depend on shapes.
         A renamed field is an outage that compiles.
```

If you believe a field is wrong, add the correct one beside it and leave the
old one. Removal is a separate, owner-approved decision.

---

## R2 — Unknown is never pass `ENFORCED`

A check that cannot determine an answer returns **unknown**, never success.

```
enforce  packages/core/src/ops/*.spec.ts  (verdict unions include unknown)
         scripts/live-checks.mjs exits non-zero on 판정 불가
         scripts/check-live-coverage.mjs uses Math.floor — never rounds up
why      "We didn't see a problem" and "there is no problem" are different
         facts. Collapsing them is how a dead provider produced a green screen.
```

Related phrasings you will find in the code, all meaning the same thing:

- 모르는 것을 통과로 처리하지 않는다
- 표본이 적으면 달성이라고 말하지 않는다
- 던지지 않았다고 성공이 아니다

---

## R3 — No bypass flags `ENFORCED`

There is no `force`, `skip`, `override`, or `--i-know-what-im-doing` anywhere,
and there must not be.

```
enforce  apps/api/src/contents/publish-boundary.spec.ts
         apps/api/src/pricing/append-only.spec.ts
         packages/core/src/ops/governance-boundary.spec.ts
         packages/core/src/ops/provider-rollout-boundary.spec.ts
why      "하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가 '안전을
         위해' 되살려도 아무도 모른다." So the absence itself is tested.
         If a gate can be opened, it is not a gate.
```

**This means: if a gate blocks you, the answer is to satisfy the gate, not to
add a way around it.**

---

## R4 — Batch AI work goes through `JobRunner` `CONVENTION`

Do not call a provider in a loop from a controller or service. Register a job
kind and let `JobRunner` run it.

```
where    apps/api/src/reliability/job-runner.service.ts
         apps/api/src/reliability/job-registry.service.ts
kinds    ocr-batch · analysis-batch · content-batch · publish-batch
why      Checkpoints. A resumed job must not re-buy finished stages.
         Heartbeats. Without them the queue cannot tell "running" from "dead".
```

Related: `MAX_ITEMS = 50` per batch. Do not raise it casually — an unbounded
batch means nobody knows what one request costs.

---

## R5 — Never make the system pay twice `ENFORCED`

Resumption must reuse completed stages, and the queue must never reclaim a
live job.

```
enforce  live check `job-checkpoint-saves-money` (OCR rows must not grow)
         live check `job-resume-same-row` (attempt 2 writes the same row)
history  Sprint 47: the queue marked a RUNNING job as interrupted because
         heartbeats were 30s apart and resumed jobs carried an old startedAt.
         With two instances that is double-buying. Fixed by stamping
         heartbeatAt at start — in BOTH the create and resume branches.
```

---

## R6 — A stub success is not a connection `ENFORCED`

Never record, display, or count a stub/mock response as evidence of a real
provider.

```
enforce  packages/core/src/ops/production-cutover.spec.ts
         POST /ops/validation-run/execute returns 403 while unprepared
         scripts/cutover.mjs marks non-official endpoints not-production
why      "준비되지 않은 채 돌리면 스텁을 상대로 한 성공 기록이 남고,
         그 기록은 나중에 실연결의 증거로 읽힙니다."
```

**Corollary: do not "fix" a blocked validation by pointing it at a stub.**

---

## R7 — Normalize provider usage into our meaning `ENFORCED`

Each vendor counts tokens differently. Convert at the adapter boundary.

```
where    apps/api/src/llm/providers/{anthropic,openai,gemini}.provider.ts
rules    Anthropic — input already excludes cache
         OpenAI    — subtract cached_tokens from input
         Gemini    — subtract cachedContentTokenCount; ADD thoughtsTokenCount
                     to output
enforce  apps/api/src/llm/providers/usage-detail.spec.ts
caveat   These rules come from vendor documentation. They have NOT been
         confirmed against live responses. Treat as assumption, not fact.
```

---

## R8 — Never invent a price `CONVENTION` (strongly held)

The price table has 7 models. If a model is missing, cost is **not counted**
and the budget ceiling does not apply to it. That is the correct behavior.

```
where    packages/core/src/execution/pricing-provenance.ts
surface  GET /llm/pricing-health — names each unpriced model and call count
why      A number with no source is worse than no number: a missing value
         shows as "unknown"; an invented one is never re-checked.
change   Price changes are a 4-step flow: propose → review → approve → apply.
         Detection only creates proposals. A human applies.
```

---

## R9 — No markdown in user-facing strings `ENFORCED`

Doc comments are markdown. **String literals that reach a screen are not.**

```
enforce  packages/core/src/ops/no-markdown.spec.ts
         packages/core/src/reliability/no-markdown.spec.ts
why      Fixed four times before the guard existed. The habit leaks from the
         comment above into the string below, and nothing fails.
```

---

## R10 — Operational docs must point at real routes `ENFORCED`

Any path written in `OPERATIONS_RUNBOOK.md` must exist in the route table.

```
enforce  apps/api/src/ops/runbook-routes.spec.ts
history  Sprint 49: four documented paths had never existed
         (/ops/backup, /ops/recovery, /ops/schedule, /ops/lock).
         An on-call engineer pasting those gets a 404 mid-incident and
         suspects the server is down.
```

---

## R11 — Pin what you removed `ENFORCED`

When a decision is "we will NOT do X", write a test asserting X is absent.

```
pattern  *-boundary.spec.ts / append-only.spec.ts
why      Removed code leaves no trace. Six months later someone re-adds it
         "for safety" and no test objects.
```

---

## R12 — One judgment, one owner `CONVENTION`

A fact must have exactly one place that decides it. Screens and summaries
**quote** verdicts; they never recompute them.

```
example  /admin/overview and GET /ops/overview cite other judgments only
why      "같은 사실에 두 개의 답이 생기면, 어긋나는 순간 둘 다 못 믿게 된다"
```

---

## R13 — Pure judgment stays pure `CONVENTION`

In `packages/core`: no Prisma, no `fetch`, no filesystem, no ambient clock in
the decision path. Time and I/O are passed in.

```
why      Judgments must be testable without infrastructure, and reproducible.
note     Workflow-style scripts elsewhere ban Date.now()/Math.random() for the
         same reason — determinism.
```

---

## R14 — Errors say what to do, and never leak internals `CONVENTION`

User-facing messages state the next action. Raw upstream error text does not
reach the screen — nobody knows in advance what is inside it.

```
vocab    "잠시 후 다시 시도해 주세요"  → retriable
         "관리자에게 알려 주세요"      → configuration; retrying won't help
         "지금은 이 작업을 실행할 수 없습니다" → gate/budget; waiting won't help
         "이어할 수 있습니다"          → resumable, finished stages preserved
where    packages/core/src/reliability/failure-taxonomy.ts
```

---

## R15 — Do not silently stop `CONVENTION`

If an automatic process gives up, a human must learn about it.

```
why      "조용히 그만두면, 아무도 못 받은 알림이 없는 일이 된다"
applies  auto-resume exhaustion · alert resend exhaustion · scheduler death
```

---

## Quick self-check before you finish

```
[ ] Did I change an existing response shape?              → R1 violation
[ ] Does any new check return pass when it cannot tell?   → R2 violation
[ ] Did I add a way to skip a gate?                       → R3 violation
[ ] Did I call a provider outside JobRunner in a loop?    → R4 violation
[ ] Did I write a price I could not source?               → R8 violation
[ ] Did I put ** inside a user-facing string?             → R9 violation
[ ] Did I add a doc path without checking it resolves?    → R10 violation
[ ] Have I seen my new gate go red at least once?         → ASK_AI_FIRST §7
```
