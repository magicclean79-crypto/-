# DECISION_LOG

> Every decision that shaped this system, Sprint 1 → 50.
>
> **This file has two halves.** §2 is written by hand and explains the
> load-bearing decisions. §3 is a **machine-generated index of all 162
> decision IDs cited in code** — use it to jump from an ID to the code that
> enforces it.
>
> Regenerate §3 with the script in §4 whenever code changes. Do not hand-edit
> it.

---

## 1. How decisions are recorded here

```
결정 NNNN-①      a decision made by the owner (CTO) in sprint NNNN
정책 NNNN-①      a standing policy from sprint NNNN
```

They appear in **code comments** at the place they constrain, which is why the
index in §3 is trustworthy: it is extracted from the code itself.

**162 decision IDs are cited 1,358 times across the codebase.**

A decision may not be silently reversed. If you believe one is wrong, say so
and get it reversed explicitly — with a new ID.

Narrative history (what each TASK did and why) lives in `TASKS.md`, 85
completed TASKs. Open questions live in `reports/CTO_REQUEST.md`.

---

## 2. The load-bearing decisions

Ranked by how much of the codebase depends on them.

### 2.1 Structure

**Hexagonal Port/Adapter — judgment in `@acos/core`, I/O in `apps/api`.**
Established Sprint 2-3 and never broken since. Consequence: 1,736 core tests
need no infrastructure.

**Project is the top-level root** (`결정` around Sprint 3). Everything —
products, cost attribution, memories — hangs off `Project`. Cost is attributed
per project, which is why upload asks which project an image belongs to: a
blank there is not "shared", it is **"unknown"**, and the money lands nowhere.

**Enums, not free strings**, for status/type fields (product object status,
decision type, knowledge category, memory scope). Decided repeatedly in
Sprints 3-4 after CTO review.

### 2.2 The human checkpoint

**`ProductObject` must be promoted to `READY` by a person before content can
be generated.** `DRAFT ⇄ READY → ARCHIVED`. This is the one deliberate stop in
an otherwise automated pipeline — the place a wrong AI reading can be caught
before it reaches published copy.

### 2.3 Publishing is gated, with no override (`2701-①②`, pinned `2801`)

`PUBLISHED` requires governance judgment: banned words, required notices,
product state. **No bypass flag exists**, and
`apps/api/src/contents/publish-boundary.spec.ts` asserts that absence.

`2601-①`: the official route for an already-published violation is
`PUBLISHED → ARCHIVED → fix → re-publish`. Since `ARCHIVED` was terminal, the
revive path `ARCHIVED → DRAFT` was opened so the procedure is actually
walkable. Re-publishing re-runs governance.

### 2.4 Cost truth (`2901-④`, `3101-①②③`, `3301-①…⑥`)

- **Budget ceiling blocks calls** (429) rather than warning after the fact.
- **Append-only pricing**: `apps/api/src/pricing/append-only.spec.ts` pins the
  things deliberately *not* built.
- **Price changes are 4-step**: propose → review → approve → apply. Automatic
  detection creates proposals only; a human applies.
- **A model missing from the price table means cost is not counted** and the
  budget ceiling does not apply to it. This is the intended behavior — an
  invented price is worse than a visible gap.

### 2.5 Judgments withhold when the sample is small (`2901`, `3201`, `3901`)

Below ~5 samples, provider health / KPI / experiment judgments return
`unknown`, not success. "판정 유보" is a distinct state from "정상".

### 2.6 Operational reality (`1601-②`, `1801-④`, `1901-③`, `3601-①`)

- `1601-②` — **the restore target must differ from the production database.**
  Enforced at boot: setting `BACKUP_RESTORE_DB_URL == DATABASE_URL` aborts
  startup, because restore erases the target and the verification would *be*
  the incident.
- `1801-④` / `1901-③` — **production object storage must be Amazon S3.**
  MinIO/s3rver cannot report versioning or replication, so protection status
  would forever read "check it yourself".
- `3601-①` — **production activation requires all three of** credentials,
  network, and cutover verdict. Two out of three is not activation.

### 2.7 Real vs stub (`3501-①`, `3701-①②`, `4501`, `4601-④`)

The rule the whole `/ops` platform protects:

> **A success recorded against a stub is not evidence of a connection.**

`3501-①` came from nearly counting stub successes as "connected".
`POST /ops/validation-run/execute` returns **403** until preparation is
complete, precisely so that no such record can exist.

### 2.8 Reliability (`4301`, `4401`, `4501`, `4601`)

- Batch work runs through `JobRunner` with checkpoints — a resumed job must
  not re-buy completed stages.
- `job_runs` **is** the queue; there is no broker.
- Auto-resume **defaults to off** — it spends money with nobody watching.
  Turning it on is a decision someone makes knowingly.
- The queue deliberately refuses: live jobs, non-retriable failures, unknown
  failures, jobs past 2 auto rounds, jobs older than a day.

### 2.9 Release discipline (Sprints 48-50)

- `v1.0.0-rc.1` was tagged; **`v1.0.0` was not** — real-provider validation had
  never run (`validation_runs` = 0 rows).
- Code Freeze from Sprint 48: no new features, no large refactors, no API
  changes, no DB changes.
- The final sprint produced **zero code changes**, by design.

### 2.10 Guards that pin absence

Because removed code leaves no trace, these tests assert that something is
*not* there:

```
apps/api/src/contents/publish-boundary.spec.ts        no publish override
apps/api/src/pricing/append-only.spec.ts              no retro-editing of prices
packages/core/src/ops/governance-boundary.spec.ts     governance scope
packages/core/src/ops/provider-rollout-boundary.spec.ts  rollout criteria fixed
packages/core/src/ops/no-markdown.spec.ts             no ** in UI strings
packages/core/src/reliability/no-markdown.spec.ts     same, reliability layer
apps/api/src/ops/runbook-routes.spec.ts               runbook paths must exist
```

---

## 3. Full index — all decision IDs cited in code

Generated 2026-08-01. `citations` counts every file:line mention (including
tests); `first source` prefers a non-test file.

| decision | citations | first source |
| --- | --- | --- |
| `0802-③` | 5 | `apps/api/src/auth/health-protection.guard.ts:13` |
| `0803-①` | 4 | `apps/api/src/auth/auth.controller.ts:43` |
| `0901-③` | 1 | `apps/api/src/llm/vision-production.spec.ts:32` |
| `1001-②` | 1 | `packages/core/src/llm/failover.ts:10` |
| `1001-③` | 4 | `apps/api/src/analysis/prisma-analysis-run.store.ts:61` |
| `1002-①` | 7 | `apps/api/src/llm/llm.service.ts:373` |
| `1002-④` | 5 | `apps/api/src/llm/llm.service.ts:232` |
| `1003-②` | 3 | `apps/api/src/llm/experiment-lifecycle.service.ts:27` |
| `1003-③` | 2 | `packages/core/src/llm/experiment-lifecycle.ts:32` |
| `1003-④` | 1 | `apps/api/src/llm/experiment-analytics.service.ts:22` |
| `1101-③` | 1 | `packages/core/src/llm/experiment-analytics.ts:5` |
| `1101-④` | 4 | `apps/api/src/llm/llm.controller.ts:245` |
| `1101-⑤` | 3 | `apps/api/src/llm/experiment-lifecycle.service.ts:100` |
| `1102-①` | 1 | `apps/api/src/llm/experiment-config.ts:56` |
| `1102-③` | 2 | `apps/api/src/llm/experiment-analytics.service.ts:34` |
| `1201-⑤` | 5 | `apps/api/src/health/health.controller.ts:14` |
| `1202-②` | 8 | `apps/api/src/llm/provider-production.service.ts:123` |
| `1202-④` | 1 | `scripts/deployment-gate.mjs:3` |
| `1301-①` | 10 | `apps/api/src/ops/ops.controller.ts:267` |
| `1301-②` | 6 | `apps/api/src/llm/provider-production.service.ts:308` |
| `1301-③` | 8 | `apps/api/src/llm/llm.service.ts:332` |
| `1301-⑤` | 6 | `packages/core/src/ops/alerts.ts:183` |
| `1302-①` | 6 | `apps/api/src/ops/alert.service.ts:99` |
| `1302-②` | 3 | `apps/api/src/ops/distributed-lock.service.ts:18` |
| `1302-③` | 4 | `apps/api/src/content-governance/governance-scan.service.ts:119` |
| `1302-④` | 10 | `apps/api/src/ops/alert.service.ts:275` |
| `1401-①` | 10 | `apps/api/src/ops/distributed-lock.service.ts:65` |
| `1401-②` | 7 | `apps/api/src/ops/alert.service.ts:245` |
| `1401-③` | 10 | `apps/api/src/ops/scheduled-checks.service.ts:215` |
| `1401-④` | 8 | `apps/api/src/ops/notification.service.ts:99` |
| `1501-①` | 9 | `apps/api/src/ops/scheduled-checks.service.ts:116` |
| `1501-②` | 11 | `apps/api/src/ops/distributed-lock.service.ts:37` |
| `1501-③` | 5 | `apps/api/src/ops/notification-queue.service.ts:286` |
| `1501-④` | 4 | `apps/api/src/ops/scheduled-checks.service.ts:285` |
| `1601-①` | 4 | `packages/core/src/ops/env-spec.ts:755` |
| `1601-②` | 11 | `apps/api/src/ops/backup.service.ts:154` |
| `1601-④` | 6 | `apps/api/src/storage/storage.service.ts:119` |
| `1601-⑤` | 5 | `apps/api/src/ops/backup.service.ts:189` |
| `1701-①` | 10 | `apps/api/src/ops/backup.service.ts:207` |
| `1701-②` | 9 | `apps/api/src/ops/backup.service.ts:549` |
| `1701-③` | 11 | `packages/core/src/ops/deployment-checklist.ts:257` |
| `1701-④` | 2 | `apps/api/src/ops/backup.service.ts:277` |
| `1701-⑤` | 15 | `apps/api/src/ops/ops.controller.ts:1039` |
| `1801-①` | 12 | `apps/api/src/ops/backup.service.ts:848` |
| `1801-②` | 3 | `packages/core/src/ops/deployment-checklist.ts:308` |
| `1801-③` | 3 | `packages/core/src/ops/disaster-recovery.ts:206` |
| `1801-④` | 7 | `packages/core/src/ops/backup-integrity.ts:669` |
| `1801-⑤` | 11 | `apps/api/src/ops/ops.controller.ts:1086` |
| `1901-①` | 2 | `apps/api/src/ops/recovery-drill.service.ts:235` |
| `1901-②` | 6 | `apps/api/src/ops/ops.controller.ts:1116` |
| `1901-③` | 6 | `apps/api/src/ops/recovery-evaluation.service.ts:99` |
| `1901-④` | 6 | `apps/api/src/ops/backup.service.ts:258` |
| `1901-⑤` | 4 | `apps/api/src/ops/recovery-drill.service.ts:157` |
| `2001-①` | 6 | `apps/api/src/ops/backup.service.ts:235` |
| `2001-②` | 16 | `apps/api/src/ops/backup.service.ts:247` |
| `2001-③` | 6 | `apps/api/src/ops/recovery-drill.service.ts:329` |
| `2001-④` | 3 | `apps/api/src/ops/ops.controller.ts:966` |
| `2101-①` | 8 | `apps/api/src/ops/backup.service.ts:294` |
| `2101-②` | 13 | `apps/api/src/ops/recovery-evaluation.service.ts:96` |
| `2101-③` | 4 | `packages/core/src/ops/ci-workflow.ts:84` |
| `2101-④` | 12 | `apps/api/src/ops/ops.controller.ts:1008` |
| `2201-①` | 9 | `apps/api/src/ops/migration-governance.service.ts:15` |
| `2201-②` | 4 | `packages/core/src/content-governance/preflight.ts:12` |
| `2201-③` | 3 | `apps/api/src/contents/publish-boundary.spec.ts:9` |
| `2201-④` | 8 | `apps/api/src/health/readiness.service.ts:102` |
| `2301-①` | 14 | `apps/api/src/content-governance/content-governance.service.ts:38` |
| `2301-②` | 10 | `apps/api/src/ops/alert.service.ts:273` |
| `2301-③` | 10 | `apps/api/src/health/readiness.service.ts:129` |
| `2301-④` | 6 | `apps/api/src/health/readiness.service.ts:193` |
| `2401-⑤` | 11 | `apps/api/src/ocr/ocr.module.ts:71` |
| `2501-①` | 8 | `apps/api/src/content-governance/governance-preflight.service.ts:46` |
| `2501-②` | 2 | `packages/core/src/content-governance/content-governance-boundary.spec.ts:12` |
| `2501-③` | 1 | `packages/core/src/content-governance/content-governance-boundary.spec.ts:67` |
| `2501-④` | 1 | `packages/core/src/content-governance/content-governance-boundary.spec.ts:87` |
| `2501-⑤` | 11 | `apps/api/src/content-governance/content-governance.service.ts:138` |
| `2601-①` | 12 | `apps/api/src/contents/contents.service.ts:172` |
| `2601-②` | 4 | `apps/api/src/ops/scheduled-checks.service.ts:180` |
| `2601-③` | 17 | `apps/api/src/content-governance/governance-scan.service.ts:100` |
| `2601-④` | 6 | `apps/api/src/content-governance/governance-preflight.service.ts:33` |
| `2601-⑤` | 6 | `apps/api/src/content-governance/content-governance.service.ts:77` |
| `2701-①` | 4 | `apps/api/src/contents/contents.controller.spec.ts:199` |
| `2701-②` | 8 | `apps/api/src/contents/content-generation.service.ts:47` |
| `2701-③` | 8 | `apps/api/src/content-governance/governance-scan.service.ts:146` |
| `2701-④` | 9 | `apps/api/src/content-governance/governance-scan.service.ts:155` |
| `2701-⑤` | 10 | `apps/api/src/content-governance/governance-preflight.service.ts:121` |
| `2801-①` | 3 | `packages/core/src/content-governance/governance-alert-boundary.spec.ts:15` |
| `2801-②` | 1 | `packages/core/src/content-governance/governance-alert-boundary.spec.ts:51` |
| `2801-③` | 1 | `packages/core/src/content-governance/governance-alert-boundary.spec.ts:70` |
| `2801-④` | 1 | `packages/core/src/content-governance/governance-alert-boundary.spec.ts:96` |
| `2801-⑤` | 14 | `apps/api/src/llm/provider-production.service.ts:358` |
| `2901-①` | 3 | `packages/core/src/ops/provider-rollout-boundary.spec.ts:13` |
| `2901-②` | 1 | `packages/core/src/ops/provider-rollout-boundary.spec.ts:81` |
| `2901-③` | 1 | `packages/core/src/ops/provider-rollout-boundary.spec.ts:109` |
| `2901-④` | 26 | `apps/api/src/llm/llm-budget.service.ts:186` |
| `3101-①` | 25 | `apps/api/src/llm/llm.module.ts:21` |
| `3101-②` | 17 | `apps/api/src/llm/provider-production.service.ts:199` |
| `3101-③` | 13 | `apps/api/src/llm/llm-budget.service.ts:83` |
| `3101-④` | 6 | `apps/api/src/ops/cost-intelligence.service.ts:33` |
| `3201-①` | 28 | `apps/api/src/ops/ops.controller.ts:1386` |
| `3201-②` | 11 | `apps/api/src/pricing/pricing.service.ts:1251` |
| `3201-③` | 15 | `apps/api/src/ops/ops.controller.ts:1378` |
| `3201-④` | 11 | `apps/api/src/ops/scheduled-checks.service.ts:184` |
| `3201-⑤` | 9 | `apps/api/src/pricing/pricing-cache.bus.ts:13` |
| `3301-①` | 30 | `apps/api/src/ops/scheduled-checks.service.ts:100` |
| `3301-②` | 20 | `apps/api/src/ops/ops.controller.ts:132` |
| `3301-③` | 15 | `apps/api/src/ops/ops.controller.ts:1356` |
| `3301-④` | 19 | `apps/api/src/ops/ops.controller.ts:1392` |
| `3301-⑤` | 19 | `apps/api/src/ops/scheduled-checks.service.ts:737` |
| `3301-⑥` | 9 | `apps/api/src/ops/scheduled-checks.service.ts:737` |
| `3501-①` | 16 | `apps/api/src/ops/production-cutover.service.ts:84` |
| `3501-②` | 4 | `apps/api/src/pricing/pricing.service.ts:319` |
| `3501-④` | 13 | `apps/api/src/llm/llm.service.ts:153` |
| `3501-⑤` | 13 | `apps/api/src/ops/production-cutover.service.ts:175` |
| `3601-①` | 15 | `apps/api/src/ops/ops.controller.ts:229` |
| `3601-②` | 15 | `apps/api/src/app.module.ts:68` |
| `3601-③` | 5 | `packages/core/src/ops/price-source.ts:197` |
| `3601-④` | 2 | `packages/core/src/ops/ci-workflow.ts:45` |
| `3701-①` | 12 | `apps/api/src/ops/activation-history.service.ts:23` |
| `3701-②` | 17 | `apps/api/src/ocr/ocr.module.ts:105` |
| `3701-④` | 9 | `apps/api/src/ops/incident.service.ts:133` |
| `3801-①` | 13 | `apps/api/src/ops/activation-history.service.ts:63` |
| `3801-②` | 19 | `apps/api/src/ops/incident.service.ts:140` |
| `3801-③` | 6 | `apps/api/src/ops/kpi.service.ts:21` |
| `3801-④` | 7 | `apps/api/src/ops/ops-audit.interceptor.ts:15` |
| `3901-①` | 4 | `apps/api/src/ops/ops-event.service.ts:48` |
| `3901-②` | 17 | `apps/api/src/ops/kpi.service.ts:36` |
| `3901-③` | 5 | `apps/api/src/ops/ops-settings.service.ts:66` |
| `3901-④` | 9 | `apps/api/src/ops/notification.service.ts:114` |
| `3901-⑤` | 15 | `apps/api/src/ops/incident-promotion.service.ts:108` |
| `4001-①` | 16 | `apps/api/src/ops/draft-lifecycle.service.ts:13` |
| `4001-②` | 10 | `apps/api/src/ops/kpi-trend.service.ts:26` |
| `4001-③` | 4 | `apps/api/src/ops/kpi-trend.service.ts:162` |
| `4001-④` | 11 | `apps/api/src/ops/diagnostics.service.ts:42` |
| `4001-⑤` | 9 | `apps/api/src/ops/diagnostics.service.ts:351` |
| `4001-⑥` | 8 | `apps/api/src/ops/ops.controller.ts:394` |
| `4101-①` | 11 | `apps/api/src/ops/diagnostics.service.ts:137` |
| `4101-②` | 12 | `apps/api/src/ops/diagnostics.service.ts:153` |
| `4101-③` | 16 | `apps/api/src/ops/diagnostics.service.ts:93` |
| `4101-④` | 10 | `apps/api/src/ops/draft-revival.service.ts:111` |
| `4101-⑤` | 7 | `apps/api/src/ops/ops.controller.ts:633` |
| `4101-⑥` | 4 | `apps/api/src/ops/ops.controller.ts:644` |
| `4201-①` | 12 | `apps/api/src/ops/diagnostics.service.ts:204` |
| `4201-②` | 11 | `apps/api/src/ops/neglect.service.ts:26` |
| `4201-③` | 4 | `apps/api/src/ops/ops-settings.service.ts:106` |
| `4201-④` | 7 | `apps/api/src/ops/ops.controller.ts:583` |
| `4301-①` | 11 | `apps/api/src/app.module.ts:74` |
| `4301-②` | 12 | `apps/api/src/llm/llm.service.ts:334` |
| `4301-③` | 7 | `apps/api/src/ops/neglect.service.ts:162` |
| `4301-④` | 6 | `apps/api/src/ops/ops.controller.ts:460` |
| `4301-⑤` | 4 | `packages/core/src/ops/validation-plan.ts:233` |
| `4401-①` | 8 | `apps/api/src/ops/host-discovery.service.ts:206` |
| `4401-②` | 6 | `apps/api/src/ops/ops.controller.ts:527` |
| `4401-③` | 7 | `apps/api/src/ops/ignore-escalation.service.ts:14` |
| `4401-⑤` | 7 | `apps/api/src/ops/activation-runbook.service.ts:13` |
| `4501-①` | 2 | `packages/core/src/ops/trusted-proxy.ts:31` |
| `4501-②` | 10 | `apps/api/src/ocr/prisma-ocr-run.store.ts:52` |
| `4501-③` | 4 | `apps/api/src/ops/notification.service.ts:310` |
| `4501-④` | 5 | `apps/api/src/ops/ops.controller.ts:661` |
| `4501-⑤` | 7 | `apps/api/src/ops/go-live.service.ts:15` |
| `4601-③` | 6 | `apps/api/src/ops/notification.service.ts:315` |
| `4601-④` | 26 | `apps/api/src/ops/go-live.service.ts:177` |
| `4601-⑤` | 6 | `apps/api/src/ops/ops-overview.service.ts:11` |
---

## 4. Regenerating §3

```bash
python3 - <<'PY'
import re,os,collections
pat=re.compile(r'(?:CTO )?(?:결정|정책) (\d{4}-[①②③④⑤⑥])')
hits=collections.defaultdict(list)
for base in ('packages/core/src','apps/api/src','scripts'):
    for root,_,files in os.walk(base):
        for f in files:
            if not (f.endswith('.ts') or f.endswith('.mjs')): continue
            p=os.path.join(root,f)
            for i,line in enumerate(open(p,encoding='utf-8',errors='ignore'),1):
                for m in pat.finditer(line):
                    hits[m.group(1)].append(f'{p}:{i}')
for k in sorted(hits):
    locs=sorted(set(hits[k]))
    src=[l for l in locs if '.spec.' not in l] or locs
    print(f'| `{k}` | {len(locs)} | `{src[0]}` |')
PY
```

## 5. How to read a decision you do not understand

```bash
grep -rn "결정 3301-①" packages/core/src apps/api/src --include=*.ts | head -5
```

Open the first non-test hit and read the doc comment above it. Decisions in
this repository are documented **at the constraint**, not in a separate file
that can drift. That is the point of the convention.

If the comment still does not explain it, search `TASKS.md` for the sprint
number — TASK entries carry the reasoning at length.
