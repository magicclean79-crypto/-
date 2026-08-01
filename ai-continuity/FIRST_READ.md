# FIRST_READ

> **You are an AI that just received this repository. Read this file completely
> before doing anything else. Do not run commands until you reach §6.**
>
> 이 문서는 사람이 아니라 **AI**를 위한 것입니다. 설명이 아니라 **구조**를
> 전달합니다.

---

## 1. What this is — in 5 lines

```
name        AI Product Content OS (ACOS)
does        상품 이미지 → OCR → AI 분석 → Product Object(사람 확정)
            → 상세페이지 생성 → 거버넌스 검토 → 발행
stack       pnpm 10 + Turborepo · Next.js 16 (web:3000) · NestJS 11 (api:4000)
            · PostgreSQL + Prisma 6 · Redis · S3
state       v1.0.0-rc.1 — NOT released. Real-provider validation never ran.
scale       ~48 DB models · 179 API routes · 2,963 tests · 57 migrations
```

## 2. The single most important fact

**`LLM_PROVIDER=mock` is the default, and this system has NEVER been run
against a real AI provider.** `validation_runs` has **0 rows**.

Everything green you will see — CI, tests, live checks — was earned **against
our own stubs**. The codebase knows this and says so at every judgment point.
If you find yourself about to write "verified" or "working" about a provider
path, stop: you cannot verify it either.

## 3. Read these next, in this order

| # | File | Why |
| --- | --- | --- |
| 1 | `ASK_AI_FIRST.md` | **The procedure you must run before any change.** Not optional. |
| 2 | `AI_RULES.md` | Hard rules. Violating them breaks tests, or worse, breaks them silently. |
| 3 | `PROJECT_PHILOSOPHY.md` | Why the code looks like this. Ignore it and your PR will look wrong to everyone. |
| 4 | `SYSTEM_MAP.md` | Where things are. Folder → module → DB → API. |
| 5 | `ARCHITECTURE.md` | How the layers relate. Port/Adapter boundary. |
| 6 | `AI_HANDOVER.md` | Full project description, domain by domain. |
| 7 | `DECISION_LOG.md` | 162 decisions, with the code that enforces each. |
| 8 | `TROUBLESHOOTING.md` | When something is broken. |
| 9 | `PROMPT_GUIDE.md` | Only if you touch prompts. |

**Minimum viable read to start work: 1, 2, 3, 4.** That is ~15 minutes.

## 4. The five rules you will most likely break

These are ranked by how often a fresh contributor gets them wrong.

1. **Do not treat "unknown" as "pass."** If a check cannot determine an answer,
   it must report *unknown* — never success. Half this codebase exists to
   enforce that distinction.
2. **Do not change existing API responses.** Add fields; never rename, remove,
   or repurpose. A test pins the exact 404 body.
3. **Do not add a bypass flag.** No `force`, no `skip`, no `--yes-i-am-sure`.
   If a gate can be opened, it is not a gate. Tests assert the *absence* of
   such flags.
4. **Do not call AI providers outside `JobRunner`** for batch work. Checkpoints
   exist so a resumed job does not pay twice.
5. **Do not count a stub success as a real connection.** This is the mistake
   the whole `cutover`/`validation` subsystem was built to prevent.

Full list with enforcement points: `AI_RULES.md`.

## 5. What "done" means here

A change is not done when it compiles. It is done when:

```
pnpm build            6/6 workspaces
pnpm typecheck        0 errors
pnpm lint             0 errors, 0 warnings
pnpm test             2,963 passing
pnpm live:checks      11/11   (needs local infra — see TROUBLESHOOTING.md)
```

CI runs three parallel jobs: `quality-gates`, `web-e2e`, `live-checks`.

## 6. Now do this

```bash
cat ai-continuity/ASK_AI_FIRST.md     # then follow it, step by step
```

Do not skip to the code. The procedure in `ASK_AI_FIRST.md` takes about 10
minutes and will stop you from making the four most expensive mistakes in
this repository.

---

## 7. Things that will confuse you, pre-empted

**"Why are there 69 routes under `/ops`?"**
Because operational judgment is a first-class product here, not an
afterthought. Backup, recovery, cost, alerts, validation, cutover — each is a
judged, testable surface.

**"Why is so much Korean?"**
User-facing strings, doc comments, and reports are Korean. Identifiers, types,
and file names are English. Keep that split.

**"Why does every judgment return a verdict object instead of a boolean?"**
Because `true/false` cannot express "I could not tell." See
`PROJECT_PHILOSOPHY.md` §2.

**"The tests pass but the feature doesn't work."**
Expected, and the reason `live:checks` exists. In the last three sprints,
**five defects passed the entire unit suite** and were caught only by running
the thing. See `PROJECT_PHILOSOPHY.md` §6.

**"Can I refactor this large file?"**
`ops.controller.ts` is ~69 routes and yes, it is big. Splitting it has been
deferred deliberately. Do not do it as a side effect of another task.
