# SYSTEM_MAP

> Where everything is. Folder → module → DB → API → provider.
> Counts are measured, not estimated (2026-08-01).

---

## 1. Repository top level

```
/
├── apps/
│   ├── api/          NestJS 11  · port 4000 · Prisma 6 · 179 routes
│   └── web/          Next.js 16 · port 3000 · App Router
├── packages/
│   └── core/         @acos/core — PURE JUDGMENT ONLY (no I/O)
├── scripts/          gates, live checks, stubs (.mjs, run by node directly)
├── docs/             architecture/ · operations/
├── reports/          CTO_REPORT · CTO_REQUEST · release reports
├── tests/            cross-cutting fixtures
├── config/           shared config
├── infrastructure/   deployment assets
├── ai-continuity/    ← you are here
└── *.md              README · AGENTS · TASKS · runbook · guides · checklists
```

**Build**: `pnpm` workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo.

---

## 2. The layer rule (memorize this)

```
        ┌──────────────────────────────────────────┐
        │ apps/web        renders verdicts          │  never re-judges
        └───────────────▲──────────────────────────┘
                        │ HTTP
        ┌───────────────┴──────────────────────────┐
        │ apps/api        adapters                  │  Prisma · fetch · S3 · clock
        └───────────────▲──────────────────────────┘
                        │ imports
        ┌───────────────┴──────────────────────────┐
        │ packages/core   pure judgment             │  NO I/O AT ALL
        └──────────────────────────────────────────┘
```

Dependency direction is one-way. `core` imports nothing from `api`.

---

## 3. `packages/core/src` — judgment modules

| Module | Files | What it decides |
| --- | --- | --- |
| `ops` | 59 | readiness · cutover · backup · recovery · alerts · KPI · validation · hosts · live-coverage |
| `llm` | 12 | provider port · routing · failover · production monitor · registry |
| `execution` | 9 | execution records · cost estimation · usage detail · price provenance |
| `reliability` | 7 | failure taxonomy · stage timing · queue plan · batch judgment |
| `vision` | 5 | vision port · LLM-backed vision |
| `content-governance` | 5 | banned words · required notices · publish eligibility |
| `auth` | 5 | session · role · lockout rules |
| `analysis` | 5 | analysis port · LLM-backed analysis |
| `ocr` | 4 | OCR port · result shaping |
| `content` | 4 | content lifecycle `DRAFT → REVIEW → PUBLISHED → ARCHIVED` |
| `prompt` | 3 | prompt engine + 3 templates |
| `product-object` | — | assembly, READY validation, versioning |
| `knowledge` `memory` `decision` `sop` `project-memory` | — | Company Brain |
| `workflow` | — | sequential step engine |
| `admin` | — | settings judgment |

**Ports live in core; adapters live in api.** Port files:

```
packages/core/src/llm/llm-provider.ts
packages/core/src/ocr/ocr-provider.ts
packages/core/src/vision/vision-provider.ts
packages/core/src/analysis/analysis-provider.ts
packages/core/src/{knowledge,memory,decision,project-memory}/*.ts   repositories
```

---

## 4. `apps/api/src` — adapter modules

```
auth          login · cookie session · lockout · roles (VIEWER/EDITOR/ADMIN)
projects      top-level tenant-ish root; cost is attributed per project
products      product CRUD
uploads       image upload → S3
ocr           OCR adapter (Google Vision or stub)
analysis      product analysis (multimodal)
product-object  assemble → READY validation → versioning
contents      generation · lifecycle · publish
content-governance  banned words · notices · scan runs
company-brain   knowledge · memory · decisions · SOP query surface
llm           provider factory · routing · failover · budget · monitoring (19 routes)
pricing       price table · proposals · pricing health
execution     execution records surface
reliability   JobRunner · job queue · registry · batch jobs (11 routes)
ops           the operations surface — 69 routes
storage       S3 adapter
prisma        PrismaService
common        request context (requestId), interceptors
health        /health (unauthenticated)
```

### Provider adapters (the only place vendor APIs are touched)

```
apps/api/src/llm/providers/anthropic.provider.ts
apps/api/src/llm/providers/openai.provider.ts
apps/api/src/llm/providers/gemini.provider.ts
```

Each normalizes token usage into **our** meaning — see `AI_RULES.md` R7.

---

## 5. API surface — 179 routes

| Controller | Routes | Notes |
| --- | --- | --- |
| `ops.controller.ts` | **69** | the operations platform |
| `llm.controller.ts` | 19 | routing, budget, monitoring, pricing-health |
| `jobs.controller.ts` | 11 | batch jobs + queue |
| `auth.controller.ts` | 9 | |
| `contents.controller.ts` | 8 | includes publish transition |
| `projects` `products` `knowledge` `decisions` `memory` `project-memories` | 5 each | |
| `product-object` `governance` `ocr` | 4 each | |
| `sop` `admin` `analysis` `execution` | 3 each | |
| `app` `uploads` `health` | 2 each | |
| `ready-validation` `company-brain` `prompt` | 1 each | |

**Regenerate this table yourself** (do not trust the numbers if code changed):

```bash
grep -rn "@\(Get\|Post\|Put\|Patch\|Delete\)(" apps/api/src --include=*.controller.ts | wc -l
```

### Operationally important endpoints

```
GET  /health                       liveness, no auth
GET  /ops/readiness                backup · restore · redis · enterprise blocks
GET  /ops/overview                 quotation-only dashboard
GET  /ops/go-live                  8-item release verdict
GET  /ops/cutover                  real-provider transition verdict
GET  /ops/validation-plan          11 preparation steps
POST /ops/validation-run/execute   403 until prepared — never bypass
POST /ops/backup/run               single backup
POST /ops/backup/verify-restore    restores into BACKUP_RESTORE_DB_URL
POST /ops/drills                   record a recovery drill (human-performed)
GET  /ops/drills/requirements      outstanding drill requirements
GET  /ops/diagnostics              startup/runtime checks incl. scheduler
GET  /ops/hosts                    declared vs observed production hosts
GET  /llm/budget /llm/monitoring /llm/pricing-health
GET  /jobs  /jobs/:id  POST /jobs/:id/resume
GET  /jobs/queue/status  POST /jobs/queue/sweep
```

---

## 6. Database — 48 models, 57 migrations

**Major Migrations: 2** (they require a recovery drill before activation)

```
20260729180000_operational_readiness
20260729210000_enterprise_backup
```

### Model groups

```
DOMAIN        Project · Product · ProductObject · Image · OcrResult
              AnalysisResult · Content · ContentStatusHistory
GOVERNANCE    ContentGovernanceCheck · GovernanceScanRun
BRAIN         Knowledge · Memory · Decision · ProjectMemory · SopRun
AUTH          User · AuthSession · UserAuditLog
AI/COST       Execution · PricingProposal · PriceDetectionRun
EXPERIMENT    ExperimentState · ExperimentEvent · ExperimentAssignment
              ExperimentAssignmentEvent
JOBS          JobRun · JobEvent · JobStageMetric
OPS           Alert · NotificationDelivery · NotificationQueue · CheckRun
              BackupRun · RestoreRun · RecoveryDrill · DrillRequirement
              ActivationEvent · SmokeRun · Incident · OpsEvent · OpsAuditLog
              KpiSnapshot · ObservedHost · NeglectDecision · DiagnosticRun
              ValidationRun ← 0 rows. This is the release blocker.
ADMIN         AdminSetting · AdminAuditLog
```

**Rollback does not exist.** The undo for a migration is a restore.

---

## 7. Job system

```
job_runs IS the queue.  There is no separate broker.

kinds        ocr-batch · analysis-batch · content-batch · publish-batch
runner       apps/api/src/reliability/job-runner.service.ts
registry     apps/api/src/reliability/job-registry.service.ts
queue        apps/api/src/reliability/job-queue.service.ts
plan         packages/core/src/reliability/queue-plan.ts   ← pure judgment

HEARTBEAT_STALE_MS     90_000
AUTO_RESUME_MAX_ROUNDS 2
AUTO_RESUME_BACKOFF_MS [60_000, 600_000]
SWEEP_INTERVAL_MS      60_000
MAX_ITEMS              50        (per batch request)

JOB_AUTO_RESUME=on to enable. DEFAULT IS OFF — it spends money unattended.
```

Queue deliberately does **not** touch: live jobs · non-retriable failures ·
unknown failures · jobs past 2 auto rounds · jobs older than a day.

---

## 8. Prompts

```
engine     packages/core/src/prompt/prompt-engine.ts · default-engine.ts
templates  packages/core/src/prompt/templates/
             product-analysis.template.ts
             content-generation.template.ts
             vision-analysis.template.ts
constants  apps/api/src/prompt/prompt.constants.ts
surface    GET /prompt (1 route)
```

See `PROMPT_GUIDE.md` before editing any of these.

---

## 9. External dependencies

| Dependency | Env | Production standard | Currently |
| --- | --- | --- | --- |
| PostgreSQL | `DATABASE_URL` | managed PG | local 5432 |
| Redis | `REDIS_URL` | required for multi-instance | local 6379 |
| Object storage | `S3_ENDPOINT` `S3_BUCKET` | **Amazon S3** | **s3rver (dev only)** |
| OCR | `GOOGLE_VISION_ENDPOINT` | official Vision address | local stub :9100 |
| LLM | `LLM_PROVIDER` + keys | openai/anthropic/gemini | **mock** |
| Backups | `BACKUP_DIR` `BACKUP_RESTORE_DB_URL` | separate DB, offsite on | local, offsite off |

**97 environment variables** are declared in
`packages/core/src/ops/env-spec.ts`. Production boot **fails** on a declared
error — deliberately.

---

## 10. CI

```
.github/workflows/ci.yml  — 3 parallel jobs

quality-gates   build · major-migrations · ci-gates · typecheck · lint · test
web-e2e         playwright install · build · 252 e2e
live-checks     postgres service · stubs · migrate · seed · API · live:checks
```

`live-checks` proves **wiring**, not provider behavior. It prints that
disclaimer every run.

---

## 11. Local scripts

```
pnpm build / typecheck / lint / test / test:e2e
pnpm check:ci-gates          the CI has the 7 required gates, in order
pnpm check:major-migrations  manifest ↔ filenames agree
pnpm check:live-coverage     how much of live verification CI can do (11/15)
pnpm live:checks             11 live checks against real infra
pnpm cutover                 real-provider transition verdict (exit 1 = not done)
pnpm validation:preflight    can validation start? (exit 1 = no)

scripts/ci-vision-stub.mjs   controllable Vision stub
                             modes: ok|outage|unauthorized|quota|empty|garbage
scripts/seed-live-checks.mjs seed rows the live checks need
scripts/wait-for.mjs         readiness wait helper
```
