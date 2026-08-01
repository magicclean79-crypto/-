# PROJECT_PHILOSOPHY

> **Do not change these.** Everything else in the repository is negotiable;
> this is not. If a change you are making conflicts with a principle here,
> the change is wrong — or it needs the owner's explicit approval, recorded as
> a decision.
>
> Each principle is followed by **the incident that created it**. They were not
> chosen in advance. They were paid for.

---

## P1 — Unknown is not pass

> **모르는 것을 통과로 처리하지 않는다**

A boolean cannot say "I could not tell." So judgments return a verdict union:

```ts
"pass" | "fail" | "warn" | "unknown" | "manual" | "not-started" | …
```

**Consequences you must preserve:**

- A check with too small a sample returns *판정 유보*, not success.
- A check that could not run returns *못 읽음*, not success — and the two are
  distinguished, because one is a bug and the other is patience.
- Coverage math uses `Math.floor`. It never rounds up.

**Why:** a screen once showed green while a provider was returning 503,
because "no failure recorded" had been collapsed into "healthy".

---

## P2 — One fact, one owner

> **같은 사실에 두 개의 답이 생기면, 어긋나는 순간 둘 다 못 믿게 된다**

Exactly one place decides any given fact. Dashboards **cite**; they never
re-derive. `/ops/overview` and `/admin/overview` are quotation surfaces.

**Why:** two summaries computing "is backup healthy?" independently will
diverge, and the operator then trusts neither.

---

## P3 — A gate that can be opened is not a gate

There is no bypass flag anywhere in this system, and its absence is tested.
The publish gate, the migration gate, the activation gate, the validation
gate — none has an escape hatch.

**Why:** the escape hatch is used exactly once "just this time", and after
that the gate is decoration. Tests pin the absence because *removed code
leaves no trace*.

---

## P4 — A gate that can only be green is not a gate

Every guard must have been observed failing.

**Why:** Sprint 48 — the live check `job-batch-succeeds` looked only at job
status, so it passed while **every single item was skipped** because the
storage pointed at the wrong directory. It went green with the product
completely misconfigured.

**Practice:** after writing a guard, break the thing it guards, watch it go
red, then restore. This is step 7 of `ASK_AI_FIRST.md`.

---

## P5 — Pure judgment, adapted I/O

```
packages/core   decides         no Prisma · no fetch · no fs · no ambient clock
apps/api        talks           DB, HTTP, S3, time, queues
apps/web        shows           renders verdicts; never re-judges
```

**Why:** judgments must be testable without infrastructure and reproducible
across runs. This is also why 1,736 of the 2,963 tests need nothing but node.

---

## P6 — Tests are necessary and not sufficient

**Five defects in the last three sprints passed the entire unit suite:**

| Sprint | What passed tests but was broken |
| --- | --- |
| 47 | Queue marked a **running** job as dead → with 2 instances, double-buy |
| 47 | Vision returned **503** and the batch reported **success** |
| 48 | Production session cookie could ship **without `Secure`** |
| 48 | Live gate passed with **every item skipped** |
| 49 | On-call runbook cited **four routes that never existed** |

This is why `pnpm live:checks` exists and why it runs against real PostgreSQL,
real Redis, real object storage, and a controllable stub.

**Corollary:** "the tests pass" is never an answer to "does it work?"

---

## P7 — Say what you do not know

Reports, screens, and commit messages state the limits of what was verified.

- The recovery drill record contains the sentence *"운영 호스트의 RTO는
  여전히 모릅니다."*
- The RTO figure is labelled a **measured lower bound**.
- `live:checks` prints, every run: *CI가 초록이라고 라이브 검증이 끝난 것이
  아닙니다.*

**Why:** an unqualified claim is read later as a guarantee by someone who
wasn't there.

---

## P8 — Money and irreversibility deserve friction

| Action | Friction |
| --- | --- |
| AI calls | budget ceiling → 429; batch capped at 50 items |
| Auto-resume | **default off** — it spends money with nobody watching |
| Publish | governance judgment, no override |
| Restore | target DB must differ from production, enforced at boot |
| Migrations | no rollback; the undo is *restore* |

**Why:** the cost of a wrong automated decision here is money or an
irreversible publish, not a stack trace.

---

## P9 — Silence is a failure mode

> **조용히 그만두면, 아무도 못 받은 알림이 없는 일이 된다**

When automation gives up — resume exhausted, alert resend exhausted, scheduler
stopped — a human must be told. A quiet stop is indistinguishable from success.

---

## P10 — Error messages are instructions

Users see what to do next, never raw upstream text.

```
"잠시 후 다시 시도해 주세요"           retriable
"관리자에게 알려 주세요"                configuration — retrying is pointless
"지금은 이 작업을 실행할 수 없습니다"   gate/budget — waiting won't open it
"이어할 수 있습니다"                    resumable, finished stages preserved
```

**Why:** upstream error bodies have unknown contents. They may contain
credentials, internal hostnames, or nothing useful.

---

## P11 — The human checkpoint is deliberate

The pipeline **stops** at Product Object confirmation. AI extracts; a person
promotes to `READY`. Content cannot be generated from a non-READY object.

**Why:** it is the one place where a human can catch a wrong reading before it
propagates into published copy.

---

## P12 — A version number is a claim

`v1.0.0` means "verified". This project reached Sprint 50 with every gate green
and **still did not tag v1.0.0**, because real-provider validation had never
run.

**Why:** applying a number that asserts verification to something unverified
would break P1 at the level of the whole product. Consistency at that scale is
the point.

---

## What this philosophy costs

Be honest with yourself about the trade-offs you are inheriting:

- **More code.** Verdict unions, boundary tests, and citation-only dashboards
  are more code than booleans and recomputation.
- **Slower green.** Live checks need real infrastructure.
- **Fewer shortcuts.** No bypass flag means occasionally you must fix the
  underlying condition when you only wanted to demo something.

These costs were accepted deliberately. **Do not optimize them away.**
