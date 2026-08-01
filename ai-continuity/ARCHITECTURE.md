# ARCHITECTURE

> Structure and dataflow. For *where files are*, see `SYSTEM_MAP.md`.
> For *why it is shaped this way*, see `PROJECT_PHILOSOPHY.md`.

---

## 1. Shape in one diagram

```
                         ┌─────────────────────────┐
   browser ──────────────│  apps/web  (Next.js 16) │   renders verdicts
                         └────────────┬────────────┘
                                      │ HTTP, cookie session
                         ┌────────────▼────────────┐
                         │  apps/api  (NestJS 11)  │   adapters + wiring
                         │                          │
                         │  controllers → services  │
                         │        │          │      │
                         │        │          ├──────┼──▶ Prisma ─▶ PostgreSQL
                         │        │          ├──────┼──▶ S3 client ─▶ storage
                         │        │          ├──────┼──▶ Redis (locks, cache bus)
                         │        │          └──────┼──▶ Provider adapters ─▶ AI
                         │        │                 │
                         │        ▼                 │
                         │  ┌──────────────────┐    │
                         │  │  @acos/core      │    │  PURE JUDGMENT
                         │  │  no I/O at all   │    │  input: facts
                         │  └──────────────────┘    │  output: verdicts
                         └──────────────────────────┘
```

**The one-way rule**: `core` never imports from `api` or `web`.
If you need data in a judgment, pass it in as an argument.

---

## 2. Port / Adapter, concretely

The pattern, using OCR as the example — every AI capability follows it.

```
packages/core/src/ocr/ocr-provider.ts        PORT     interface + result types
apps/api/src/ocr/…                           ADAPTER  Google Vision or stub
```

| Capability | Port (core) | Adapter (api) |
| --- | --- | --- |
| OCR | `ocr/ocr-provider.ts` | `src/ocr/` |
| Vision | `vision/vision-provider.ts` | `src/ocr/`, LLM-backed variant in core |
| Analysis | `analysis/analysis-provider.ts` | `src/analysis/` |
| LLM | `llm/llm-provider.ts` | `src/llm/providers/{openai,anthropic,gemini}` |
| Knowledge/Memory/Decision | repository interfaces | Prisma repositories |

**Selecting an implementation** is an environment decision
(`LLM_PROVIDER`, `VISION_PROVIDER`, `GOOGLE_VISION_ENDPOINT`), resolved by a
factory in `apps/api/src/llm/`. Judgment code never knows which vendor it got.

---

## 3. The product pipeline

```
① Project                 cost is attributed per project — pick the unit you
                          will later want to ask "how much did X cost?" about
     │
② Image upload            → S3 · Image row · project association matters
     │
③ OCR                     → OcrResult (PENDING/RUNNING/SUCCESS/FAILED)
     │                      batch: job kind `ocr-batch`
④ Analysis                → AnalysisResult · multimodal (image + OCR text)
     │                      batch: job kind `analysis-batch`
     ▼
⑤ Product Object          ◀── ★ HUMAN CHECKPOINT ★
     │                    assembled from OCR + Vision; a person edits and
     │                    promotes DRAFT → READY. Versioned per project.
     │                    Content CANNOT be generated from a non-READY object.
     ▼
⑥ Content generation      → Content · Company Brain injected here
     │                      (knowledge · decisions · banned words)
     │                      batch: job kind `content-batch`
     ▼
⑦ Review → Publish        DRAFT → REVIEW → PUBLISHED → ARCHIVED
                          PUBLISHED requires governance judgment:
                          banned words · required notices · product state
                          NO OVERRIDE EXISTS.
                          ARCHIVED can be revived to DRAFT; re-publishing
                          re-runs governance.
```

State machines:

```
ProductObject   DRAFT ⇄ READY  →  ARCHIVED
Content         DRAFT → REVIEW → PUBLISHED → ARCHIVED  (ARCHIVED → DRAFT revive)
```

---

## 4. Company Brain

Four stores, queried in a fixed order, injected into generation:

```
Memory      (scope: GLOBAL | COMPANY | PROJECT | PRODUCT, key/value)
Knowledge   (company-wide: RULE POLICY GUIDE BRAND LEGAL QUALITY FAQ OTHER)
Decision    ("we decided to write it this way")
SOP         (procedures; WorkflowEngine can run them)

surface     POST /company-brain/query  → 4 sections, fixed order
```

The fixed order is deliberate: same question, same answer, every time.

---

## 5. Reliability layer

This is the layer most likely to be misunderstood. Read it before touching
anything batch-related.

```
job_runs IS the queue.  No broker, no separate table.

JobRunner        runs stages, writes checkpoints, stamps heartbeats
JobRegistry      maps kind → {resume, countItems}
JobQueue         sweeps for orphans (job_runs where heartbeat is stale)
queue-plan.ts    PURE: decides alive/orphaned/resume/wait/hold/exhausted/…
batch-stage.ts   PURE: decides whether one item's failure stops the batch
```

**Two invariants you must not break:**

1. **Resume reuses finished stages.** A resumed job must not re-pay for OCR it
   already bought. Pinned by live check `job-checkpoint-saves-money`.
2. **The queue must never reclaim a live job.** `heartbeatAt` is stamped at
   start — in *both* the create and resume branches. Sprint 47 shipped without
   the resume branch and the queue declared a running job dead.

Failure classification (`reliability/failure-taxonomy.ts`) decides what the
user is told and whether a retry is even sensible:

```
upstream / rate-limited / unauthorized / blocked / storage / rejected / unknown
        ↓                                   ↓
   retriable                       stops the batch
```

Note `recoverStatus()`: our own adapters write helpful Korean sentences
containing `(503)`, which destroys the structured status. The taxonomy parses
it back out. Do not "clean up" that regex without understanding why it exists.

---

## 6. Cost and provider governance

```
Execution row per AI call   model · tokens · usageDetail · costUsd · requestId
                            · projectId (attribution)

usageDetail  cachedInputTokens · cacheWriteTokens · reasoningTokens
             CACHE_READ_MULTIPLIER  0.1
             CACHE_WRITE_MULTIPLIER 1.25

pricing      7 models with asOf + source (pricing-provenance.ts)
             PRICE_STALE_AFTER_DAYS 180
             missing model → cost NOT counted, budget ceiling NOT applied
             (this is correct — see AI_RULES R8)

budget       daily/monthly ceiling → 429 when exceeded
routing      cross-provider routing · failover priority · experiments
             judgments withheld below 5 samples
```

Price changes: **propose → review → approve → apply**. Automatic detection
only creates proposals.

---

## 7. Operations platform (`/ops`, 69 routes)

The unusual part of this codebase. It exists because the product spends money
and publishes irreversibly.

```
readiness        env · backup · restore · redis · enterprise checks
diagnostics      startup + runtime component checks
cutover          is each dependency the REAL one? (0/4 today)
validation-plan  11 steps to being allowed to validate
validation-run   the real-provider validation executor (403 until ready)
go-live          8 conditions for release (2/8 today)
backup/recovery  run · verify-restore · drills · drill requirements
alerts           delivery · queue · resend (bounded, then escalate)
hosts            declared vs observed production hosts
kpi/cost         snapshots · attribution · forecast
neglect          things nobody has looked at
```

**Dashboards quote. They never re-judge.** (`PROJECT_PHILOSOPHY.md` P2)

---

## 8. Auth

```
cookie session (default; token: null in the login response body)
  acos_session · HttpOnly · SameSite=Lax · Secure auto-enabled in production
roles VIEWER < EDITOR < ADMIN
lockout on repeated failures, audited in UserAuditLog
```

**Because it is cookie-only, the cookie is the sole credential.** That is why
the missing `Secure` flag was a Critical in Sprint 48.

---

## 9. Request identity

`apps/api/src/common/request-context.service.ts` assigns a `requestId` per request.
Executions carry it, so cost can be attributed to a job stage, and errors can
be traced from a screen message back to a log line.

Deliberately: `requestId` is **not** added to existing response bodies —
pinned by the live check `existing-responses-unchanged` (see `AI_RULES.md` R1).

---

## 10. Startup behavior

```
production:  env validation runs; a declared ERROR aborts boot
             log line: 환경 오류 [NAME] …
non-prod:    same checks, warnings only
always:      diagnostics run and are recorded; boot is NOT blocked by them
             (경보와 차단은 다릅니다 — alerting and blocking are different)
```

Refusing to boot on bad configuration is intentional: a silently
misconfigured server is more dangerous than one that will not start.

---

## 11. Where to add things

| You want to add… | Put it |
| --- | --- |
| a new rule/verdict | `packages/core/src/<domain>/` + `.spec.ts` |
| a new external system | port in `core`, adapter in `apps/api` |
| a new batch operation | a job kind + registry entry, **not** a loop |
| a new operational fact | one owner in `core`; `/ops` cites it |
| a new screen | `apps/web/app/…`; render verdicts, do not compute them |
| a new invariant | a `*-boundary.spec.ts` asserting the absence |
