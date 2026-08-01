# AI_HANDOVER

> Full project description for an incoming AI. Read `FIRST_READ.md` first.
>
> This document tells you **what exists and what state it is in**.
> `ARCHITECTURE.md` tells you how it fits together.
> `SYSTEM_MAP.md` tells you where the files are.

---

## 1. Identity

```
project      AI Product Content OS  (ACOS)
repo         magicclean79-crypto/-
branch       claude/ai-product-content-os-setup-jb5oai
version      1.0.0 in package.json · tagged v1.0.0-rc.1 · NOT released
sprints      50 completed · 85 completed TASKs
language     code English · user-facing strings, comments, reports Korean
```

**Governance model**: an owner ("CTO") issues one TASK at a time. The
implementer does exactly that TASK, runs the full gate set, updates
`reports/CTO_REPORT.md` + `reports/CTO_REQUEST.md` + `TASKS.md` + `README.md`,
commits, pushes, and **stops** until the next approval. Decisions are recorded
as `결정 NNNN-①` / `정책 NNNN-①` and cited in code at the constraint.

---

## 2. What the product does

A person uploads product photographs. The system reads them, extracts
structured product information, has a human confirm it, generates a marketing
detail page in the company's voice, and publishes it only if it passes
governance.

```
① Project          the unit cost is attributed to
② Upload images    → S3
③ OCR              → text in the image (ingredients, warnings, copy)
④ Analysis         → name, category, keywords, attributes  (image + OCR)
⑤ Product Object   ★ HUMAN CONFIRMS ★  DRAFT → READY, versioned
⑥ Generation       → detail page, with Company Brain injected
⑦ Review → Publish DRAFT → REVIEW → PUBLISHED → ARCHIVED, governance-gated
```

Step ⑤ is a deliberate stop. Step ⑦ has **no override**.

**Company Brain** — four stores injected into generation: Memory, Knowledge,
Decisions, SOP. Queried in a fixed order so the same question always gets the
same answer.

---

## 3. What state it is in — read this carefully

### 3.1 Green

| | |
| --- | --- |
| Build | 6/6 workspaces |
| Tests | **2,963** (core 1,736 · api 975 · web e2e 252) |
| TypeScript | 0 errors |
| ESLint | 0 errors, 0 warnings |
| Live verification | **11/11** |
| CI | 3 parallel jobs, all `success` |
| Known Critical defects | **0** |

### 3.2 Not green — and this is the whole story

```
validation_runs                0 rows
GET /ops/go-live               not-started   (2 of 8 conditions met)
pnpm cutover                   exit 1        (activation 1 of 3)
pnpm validation:preflight      exit 1        (preparation 4 of 11)
GET /ops/readiness             recoverable: false  (pass 13 · fail 2 · warn 1 · manual 3)
```

**This system has never been run against a real AI provider.**
`LLM_PROVIDER=mock` is the default. Every green result above was earned
against our own stubs, and the codebase says so at every judgment point.

### 3.3 The seven things blocking release

Tracked in `RELEASE_CHECKLIST.md`. Six require a human.

| | Item | State |
| --- | --- | --- |
| 1 | Provider credential | ❌ none |
| 2 | Network allowlist | ⚠️ partial — `api.openai.com` unreachable |
| 3 | Validation environment | ❌ none |
| 4 | Production host inventory | ❌ 2 declared, 6 used-but-undeclared |
| 5 | Amazon S3 | ❌ still s3rver (dev-only) |
| 6 | Backup chain | ❌ 18.4h gap (2 of 24 runs in 24h) |
| 7 | Recovery drill | ✅ done — RPO 37min, RTO 1s (measured lower bound) |

**Note the distinction the project insists on**: validation did not *fail*, it
never *started*. `POST /ops/validation-run/execute` returns 403 while
preparation is incomplete, deliberately, so that no stub-based success record
can ever exist.

---

## 4. Technology

```
pnpm 10 workspaces + Turborepo
apps/web    Next.js 16, App Router, port 3000
apps/api    NestJS 11, port 4000, Prisma 6 → PostgreSQL
packages/core  @acos/core — pure judgment, no I/O
Redis       distributed lock, pricing cache bus (required for multi-instance)
S3          images + backups (must be different buckets)
Jest 30     unit/integration · Playwright — 252 e2e (chromium)
```

**48 DB models · 57 migrations · 2 Major Migrations · 179 API routes ·
97 declared environment variables.**

---

## 5. Domain by domain

### Product pipeline
`projects` `products` `uploads` `ocr` `analysis` `product-object` `contents`
Product Object is versioned per project and validated before `READY`.

### Content governance
Banned words, required notices, product state. Runs on every publish and on
revive-then-republish. Scan runs are recorded. No bypass exists, and its
absence is pinned by a test.

### Company Brain
`knowledge` `memory` `decisions` `sop` `project-memories` `company-brain`.
Memory is scoped `GLOBAL | COMPANY | PROJECT | PRODUCT` with `(scope, scopeId,
key)` unique.

### LLM layer (19 routes)
Provider factory (openai / anthropic / gemini / mock), cross-provider routing,
failover priority, experiments with sticky assignment, production monitoring.
**Judgments withhold below ~5 samples** — `unknown` is not a failure.

### Cost governance
An `Execution` row per AI call: model, tokens, `usageDetail`, cost, requestId,
projectId. Daily/monthly budget ceiling returns 429. Price table has **7
models** with `asOf` + `source`; a missing model means **cost is not counted
and the ceiling does not apply** — visible via `GET /llm/pricing-health`.
Price changes are propose → review → approve → apply.

### Reliability (11 routes)
`job_runs` **is** the queue. Four job kinds: `ocr-batch` `analysis-batch`
`content-batch` `publish-batch`. Checkpoints mean a resumed job does not
re-buy finished stages. Heartbeats every 30s; stale at 90s. Auto-resume is
**off by default** — it spends money unattended. Max 2 auto rounds, backoff
60s then 600s, batch capped at 50 items.

### Operations (69 routes)
Readiness, diagnostics, cutover, validation plan/run, go-live, backup,
restore verification, recovery drills and drill requirements, alerts with
bounded resend, host inventory, KPI, cost forecast, neglect tracking.
Dashboards **quote** other judgments; they never re-derive.

### Auth
Cookie session (`acos_session`, HttpOnly, SameSite=Lax, `Secure` auto-on in
production). Roles VIEWER / EDITOR / ADMIN. Lockout on repeated failures.
Because it is cookie-only, **the cookie is the sole credential.**

---

## 6. How work is verified here

Two layers, and the second one matters more than you expect.

```
pnpm test          2,963 — necessary, not sufficient
pnpm live:checks   11 checks against REAL postgres/redis/storage + a
                   controllable stub, including an actual kill -9
```

**In the last three sprints, five defects passed the entire unit suite** and
were caught only by running the system:

| Sprint | Defect |
| --- | --- |
| 47 | Queue marked a **running** job dead → two instances would double-buy |
| 47 | Vision returned **503**; the batch reported **success** |
| 48 | Production session cookie could ship **without `Secure`** |
| 48 | Live gate passed with **every item skipped** |
| 49 | On-call runbook cited **four routes that never existed** |

If you take one operational habit from this project, take this: **run it.**

---

## 7. Things that are deliberately absent

Do not "add" these. Their absence is tested.

- No publish override / force flag
- No retroactive price editing
- No migration rollback (the undo is *restore*)
- No auto-population of the production host list
- No way to force `validation-run/execute`
- No prices for models we could not source

---

## 8. Known limitations (honest list)

Full text in `KNOWN_LIMITATIONS.md`.

- **Never validated against a real provider.** Default is mock; the mock's
  output is not real analysis.
- **No export path for published content** — it cannot leave the system
  automatically. Highest-value v1.1 item.
- **Multi-instance behavior never actually exercised** with two competing
  processes. The design is conditional-update and it is unit-tested; that is
  not the same as observed.
- **Vendor token semantics are assumed from documentation**, not confirmed
  against live responses.
- **Running version is not exposed** — during an incident you cannot ask
  "what is deployed?"
- **No pagination on product lists** — slow at scale.
- **`ops.controller.ts` is ~69 routes.** Splitting it is deferred, deliberately.
- Backup offsite replication is **off**; the host-loss scenario is unverified.
- The runbook path guard covers **only** the runbook; the other four release
  documents were not checked.

---

## 9. Operating it locally

See `TROUBLESHOOTING.md` §1 for exact commands. Summary:

```
postgres 5432 · redis 6379 · s3rver 9000 · vision stub 9100
api 4000 (exec node dist/main.js in a background task) · web 3000
curl needs --noproxy '*'
web must point at http://localhost:4000 (not 127.0.0.1) or the cookie is dropped
```

---

## 10. If you are asked to continue development

1. Run `ASK_AI_FIRST.md` — every step.
2. Confirm whether **Code Freeze** still applies. It was in force at Sprint 50.
   If nobody has lifted it, new features are forbidden.
3. The v1.1 roadmap, in the owner's stated order:

```
1. Complete real-provider validation      (unblocks the release)
2. Export published content               ← highest user value
3. Expose running version
4. Verify multi-instance for real
5. Fill the price table
6. Generate .env.example automatically
7. Bring remaining AI paths into the reliability layer
8. Widen rate limiting
9. Check paths in the other four release documents
```

---

## 11. Where the record lives

| Question | File |
| --- | --- |
| What was built, sprint by sprint | `TASKS.md` (85 TASKs) |
| What is technically true right now | `reports/CTO_REPORT.md` |
| What is waiting on the owner | `reports/CTO_REQUEST.md` (#85 open) |
| Why release is blocked | `reports/RELEASE_BLOCKER_REPORT.md` |
| What a human must prepare | `RELEASE_CHECKLIST.md` |
| Can we go live? | `reports/GO_LIVE_REPORT.md` |
| Final release judgment | `reports/CTO_FINAL_RELEASE_REPORT.md` |
| On-call procedures | `OPERATIONS_RUNBOOK.md` |
| End-user instructions | `USER_GUIDE.md` |
| Honest limitations | `KNOWN_LIMITATIONS.md` |
| Collaboration rules | `AGENTS.md` |

---

## 12. The one sentence to carry

> **번호를 붙이는 것보다, 그 번호가 참인 것이 중요합니다.**
> *It matters more that the number is true than that a number is applied.*

This project reached Sprint 50 with every gate green and still refused to tag
`v1.0.0`, because the thing that number asserts — verification — had not
happened. Preserve that standard.
