# TROUBLESHOOTING

> Ordered diagnostic procedures for an AI. Follow top to bottom; do not skip
> to the fix.
>
> For **production on-call**, use `OPERATIONS_RUNBOOK.md` instead — this file
> is about getting the repository working and diagnosing development failures.

---

## 0. Decision tree — start here

```
Nothing runs at all                    → §1  bring infrastructure up
API won't boot                         → §2  read the env error line
Tests fail                             → §3
live:checks fails or says "판정 불가"   → §4
CI is red but local is green           → §5
A job is stuck / failed                → §6
Something says "unknown" and you
  don't know if that's bad             → §7   ★ read this before assuming
Costs/budget behaving oddly            → §8
Everything is green but the feature
  doesn't work                         → §9   ★ this is common here
```

---

## 1. Bring local infrastructure up

Required for `pnpm live:checks` and any API run.

```bash
# PostgreSQL
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main \
  -o '-c config_file=/etc/postgresql/16/main/postgresql.conf' \
  -l /var/log/postgresql/pg.log start"
pg_isready -h 127.0.0.1 -p 5432

# Redis
redis-server --port 6379 --daemonize yes --save ''
redis-cli -p 6379 ping        # → PONG

# Object storage (s3rver) on :9000, Vision stub on :9100
node scripts/ci-vision-stub.mjs &          # controllable stub
```

**Gotchas that will cost you 20 minutes each:**

| Symptom | Cause | Fix |
| --- | --- | --- |
| `curl` hangs or 403s on localhost | proxy env vars | add `--noproxy '*'` |
| API exits with code 144 | `setsid`/`disown` wrapper | start with `exec node dist/main.js` in a background task |
| Port already in use | stale process | `fuser -k -n tcp 4000` |
| Web shows "ADMIN 로그인이 필요합니다" | cookie origin mismatch | start web with `NEXT_PUBLIC_API_URL=http://localhost:4000` (not `127.0.0.1`) — the page origin is `localhost` |

---

## 2. API will not boot

**Read the log. It tells you exactly what to fix.**

```
환경 오류 [NAME] <what is wrong> — <what to do>
환경 검증에 실패해 기동을 중단합니다
```

This is deliberate: in production a declared env error **aborts startup**,
because a silently misconfigured server is worse than one that will not start.

Common ones:

| Line | Meaning |
| --- | --- |
| `[BACKUP_RESTORE_DB_URL] 복원 대상이 운영 데이터베이스와 같습니다` | You pointed restore at the production DB. Restore erases the target. Use a separate DB. (`결정 1601-②`) |
| `[S3_BUCKET] 필수 환경변수가 없습니다` | Set it. |
| `환경 권고 [...]` (WARN, not ERROR) | Advisory. Boot continues. |

To inspect only, without production strictness: run with `NODE_ENV` not equal
to `production`. **Temporary diagnosis only — never operate that way.**

All 97 variables are declared in `packages/core/src/ops/env-spec.ts`.

---

## 3. Tests fail

```bash
pnpm test                                   # all 2,963
pnpm --filter @acos/core test               # 1,736, no infra needed
pnpm --filter api test                      # 975, mocked Prisma
cd apps/api && npx jest src/path/to.spec.ts # one file
```

**Before you debug your change, prove the failure is yours:**

```bash
git stash && pnpm test ; git stash pop
```

This has mattered: a test that failed only on the 1st of the month
(daily-vs-monthly budget queries were indistinguishable that day) looked like
a new regression and was not. Time-dependent tests now pin the clock with
`jest.useFakeTimers` + `setSystemTime`.

**Guard specs you may trip without touching their subject:**

| Failure | Meaning |
| --- | --- |
| `no-markdown.spec.ts` | You put `**` inside a user-facing **string literal**. Comments are fine. |
| `runbook-routes.spec.ts` | `OPERATIONS_RUNBOOK.md` mentions a path that does not exist in the route table. |
| `*-boundary.spec.ts` / `append-only.spec.ts` | You re-added something deliberately removed. **Read the doc comment before "fixing" it.** |

**Dependency-injection failures in api tests** usually mean a new service needs
a stub in the test module. Add the stub; do not weaken the module.

---

## 4. `live:checks` fails

```bash
source <your-env.sh>
export VISION_STUB_CONTROL=http://127.0.0.1:9100
pnpm live:checks
```

### "스텁을 제어할 수 없어 판정하지 않았습니다"

**This is a failure, not a skip.** The controllable Vision stub is not running
or `VISION_STUB_CONTROL` is unset. Start `scripts/ci-vision-stub.mjs` on 9100.

The script exits non-zero on undetermined checks **on purpose** — "we could not
tell" must never be counted as a pass (`PROJECT_PHILOSOPHY.md` P1).

### Individual checks

| Check | If it fails |
| --- | --- |
| `job-batch-succeeds` | A stage failed **or items were skipped**. Skipped-everything used to pass; it no longer does. Check storage wiring first. |
| `job-checkpoint-saves-money` | Resume re-bought a finished stage. Serious — see `ARCHITECTURE.md` §5. |
| `job-resume-same-row` | Resume created a new row instead of continuing. |
| `job-provider-down-stops` | The batch continued after the provider died. |
| `logs-have-no-secrets` | Something secret-shaped reached the logs. |
| `existing-responses-unchanged` | You changed a response shape. See `AI_RULES.md` R1. |
| `cost-of-a-job` | Cost/unpriced accounting drifted. |

### Empty database

`live-checks` needs seed rows. `scripts/seed-live-checks.mjs` creates them and
exports `IMAGE_IDS`. On a fresh DB, run migrations first, then seed, then start
the API, then run the checks — that is the order CI uses.

---

## 5. CI red, local green

CI is three jobs; find which one.

```
quality-gates   build · major-migrations · ci-gates · typecheck · lint · test
web-e2e         playwright · 252 e2e
live-checks     postgres service · stubs · migrate · seed · API · live:checks
```

**Historically, `live-checks` failures were ordering problems, not product
bugs:**

- storage not yet up when the seed ran → fixed with `scripts/wait-for.mjs`
- empty database had no OCR success history → seed now exports `IMAGE_IDS`

To reproduce CI locally, use an **empty database and empty storage**, and run
the steps in the workflow's order. A pass against your warm dev DB proves
nothing about CI.

**Note**: runs get cancelled when you push again (`cancel-in-progress: true`).
A `cancelled` conclusion is not a failure.

---

## 6. A job is stuck or failed

```bash
curl -s $API/jobs -b jar                     # recent jobs
curl -s $API/jobs/$ID -b jar                 # stages, metrics, log
curl -s -X POST $API/jobs/$ID/resume -b jar  # resume
curl -s $API/jobs/queue/status -b jar        # is auto-resume on? (read-only)
curl -s -X POST $API/jobs/queue/sweep -b jar # sweep now
```

**Read the message before acting** — it tells you whether retrying helps:

| Message | Meaning |
| --- | --- |
| `이어할 수 있습니다` | Safe to resume. Finished stages are not re-bought. |
| `이어해도 같은 결과가 나오는 실패입니다` | Fix the cause first. Retrying wastes money. |
| `서버가 멈춤` (interrupted) | **Not a failure** — "we don't know if it finished". |
| `건너뛴 항목` | Some items produced no result. Check why before declaring success. |

The queue deliberately ignores: live jobs · non-retriable failures · unknown
failures · jobs past 2 auto rounds · jobs older than a day.

---

## 7. Something says "unknown" / "확실하지 않음"

**This is the most misread state in the system.** It means one of two things,
and the UI distinguishes them:

```
못 읽음        the judgment could not be called          → a BUG to fix
판정 유보      it was called, sample too small           → wait / more traffic
```

Neither means "healthy". Neither means "broken". Do not convert either into a
pass to make a screen green — that inversion is the defect this whole codebase
is built to prevent.

---

## 8. Cost / budget looks wrong

```bash
curl -s $API/llm/budget -b jar              # today/month vs ceiling
curl -s $API/llm/pricing-health -b jar      # price age + unpriced models
curl -s $API/llm/cost-verification -b jar   # records vs price table
curl -s $API/ops/cost-forecast -b jar
```

**If `unpricedCalls > 0`, the spend total is a lower bound.** A model missing
from the 7-entry price table is not counted and the budget ceiling does not
apply to it. `pricing-health` names the model and the call count.

**Do not fix this by inventing a price** (`AI_RULES.md` R8). Register the real
one through propose → review → approve → apply.

429 on AI calls = budget ceiling. Waiting does not help; raise
`LLM_DAILY_BUDGET_USD` and restart, or stop calling.

---

## 9. All green, but it doesn't work

Expected. Read `PROJECT_PHILOSOPHY.md` P6.

Ask, in order:

```
1. Did I run it, or only test it?
2. Was the other side a stub?          → then nothing about the real provider
                                          was proven
3. Does my check look at the OUTCOME,
   or only at the status?              → Sprint 48: a job "succeeded" with
                                          every item skipped
4. Have I ever seen this check fail?   → if not, it is not a check
```

Then actually execute the path: bring infra up (§1), run the API, and drive it
with `curl`. Five of the last five significant defects were found this way and
none by the unit suite.

---

## 10. Release / validation questions

| Question | Answer |
| --- | --- |
| Why is `POST /ops/validation-run/execute` 403? | Preparation is incomplete. `GET /ops/validation-plan` lists the 11 steps. **There is no way to force it** — that is the point. |
| Why is `pnpm cutover` exit 1? | Dependencies are not the real ones (mock LLM, stub Vision, s3rver). |
| Why is readiness `recoverable: false`? | `GET /ops/readiness` → look at `checklist[]` entries with status `fail`. |
| Why isn't this v1.0.0? | `validation_runs` has 0 rows. See `RELEASE_CHECKLIST.md`. |

---

## 11. Useful one-liners

```bash
# Full route table
grep -rn "@\(Get\|Post\|Put\|Patch\|Delete\)(" apps/api/src --include=*.controller.ts

# Which test pins this behavior?
grep -rn "<behavior>" packages/core/src apps/api/src --include=*.spec.ts

# Was this decided deliberately?
grep -rn "결정 \|정책 " <file>

# Migration count / major migrations
ls apps/api/prisma/migrations | grep -c "^2"
pnpm check:major-migrations

# Restore-DB schema check
DATABASE_URL="postgresql://…/<restore-db>" pnpm --filter api exec prisma migrate status
```
