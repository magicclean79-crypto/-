# CTO_REPORT — AI Product Content OS 공식 기술 보고서

> 이 문서는 AGENTS.md의 TASK 완료 절차에 따라 모든 TASK 완료 시 갱신된다.
> 형식(섹션 구성)은 항상 동일하게 유지한다:
> 1. 보고 요약 → 2. 품질 게이트 → 3. **변경 사항** → 4. **테스트 결과**
> → 5. **아키텍처 변경**(+현황) → 6. 데이터 모델 → 7. API 표면
> → 8. 리스크·기술 부채 → 9. **다음 권장 사항**
> (굵은 항목 4가지는 AGENTS.md가 요구하는 필수 포함 항목)

---

## 1. 보고 요약

| 항목 | 값 |
| --- | --- |
| 보고 기준 TASK | **TASK-5401 — 출시 선행 작업 완료 및 요구사항 확정** (TASK-5301 연속) |
| 보고일 | 2026-08-05 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 커밋 | `5bf88b7` (fix) · `ad17ecc` (docs) · 이번 주기 |
| **결론** | **정식 `v1.0.0`은 이 환경에서 원리적으로 붙일 수 없습니다** — 제품이 직접 "development는 전환 대상이 아니다"라고 판정합니다 |
| `validation_runs` | **0건** (DB에서 직접 셌습니다) |
| 코드 변경 | **테스트 1파일 · 실질 1줄.** 제품 코드 · API · DB 변경 **0건**, 새 기능 **0건** |
| 실행 환경 | **Windows 로컬** — 앞선 보고(TASK-5001~5201)는 Linux 컨테이너였고, **그 실측값은 이 환경의 값이 아닙니다** |
| 이번 주기 전진 | Go-Live **0/8 → 2/8** · 검증 계획 **0/11 → 1/11** · readiness pass **3 → 10** |

> **이번 보고의 핵심은 두 가지입니다.**
>
> 1. **판정값의 출처를 바꿨습니다.** 지금까지 인용해 온 `readiness` pass 13 ·
>    `cutover` 1/3 · `preflight` 4/11은 다른 환경의 3일 전 값이었고, 이
>    머신에서는 한 번도 측정된 적이 없었습니다. 런타임을 세워 실제로
>    측정했습니다.
> 2. **이 환경에서 자동으로 할 수 있는 것을 전부 소진했습니다.** 남은 것은
>    사람이 주는 것(7건) · 시간이 지나야 되는 것(3건) · 앞 단계에 막힌 것
>    (4건)뿐이고, **우리 몫으로 지금 할 수 있는 단계는 0건**입니다.

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 |
| Test | `pnpm test` | ✅ **2,963** — core 1,736 · api 975 · web e2e 252 |
| TypeScript | `pnpm typecheck` | ✅ 10/10, 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0 |
| Playwright | `pnpm test:e2e` | ✅ 252 |
| `/health` | `GET /health` | ✅ 200 |
| 마이그레이션 | `prisma migrate deploy` | ✅ **57건** · 테이블 **49개** |
| 백업 | `POST /ops/backup/run` | ✅ 116,223B · **269항목** · 체크섬 · 무결성 통과 |
| 복원 검증 | `POST /ops/backup/verify-restore` | ✅ **49테이블** · 1,601ms · 대상 DB 직접 대조 |
| **복구 리허설** | `POST /ops/drills` | ✅ **성공** — 복원본으로 서비스 기동까지 확인 (§4-6) |
| `/ops/readiness` | `GET /ops/readiness` | ⚠️ pass **10** · fail 1(`backup-chain`) · warn 3 · manual 4 |
| `/ops/cutover` | `pnpm cutover` | ❌ 전환 0/4 · 운영 활성화 **0/3** |
| 검증 사전 점검 | `pnpm validation:preflight` | ❌ 준비 **1/11** (사람 5 · 우리 **0** · 막힘 4) |
| 운영 활성화 런북 | `GET /ops/runbook` | ❌ **1/8** |
| **`/ops/go-live`** | `GET /ops/go-live` | ❌ **`not-started` — 충족 2/8** |
| **Production Validation** | `POST /ops/validation-run/execute` | ❌ **미실행 — 사전 조건 미충족** |
| 운영 환경변수 감사 | `validateEnvironment(production)` | ❌ **error 7건 · warning 9건** (ENV_SPECS 96개 중) |

**막고 있는 것은 코드가 아닙니다.** 코드 게이트 4종은 전부 초록이고,
빨간 것은 전부 **환경·자격 증명·배포 등급**입니다.

## 3. 변경 사항 (이번 보고 주기)

### TASK-5301 — 출시 저지 항목 재실측

**제품 코드 변경 0건입니다.** 지시가 "새 기능은 절대 추가하지 않는다"이고,
실제로 고칠 제품 결함이 발견되지 않았습니다.

유일한 코드 변경은 **테스트 1줄**입니다.

| 파일 | 변경 |
| --- | --- |
| `packages/core/src/ops/ci-workflow.spec.ts:94` | `/.*playwright install.*\n/` → `\r?\n` |

Windows에서 `core.autocrlf=true`로 체크아웃하면 `ci.yml`이 CRLF로 오고,
`.`은 `\r`을 매치하지 않아 `replace`가 조용히 무효가 됩니다. 지우지 못한
원본이 그대로 `judgeCiWorkflow`에 들어가 `ok=true`가 되므로 —
**판정이 아니라 테스트가 거짓말하는** 상태였습니다. 제품 코드
`ci-workflow.ts:117`의 `/playwright install/`는 이미 줄바꿈에 무관하므로
고치지 않았습니다.

### 구축한 것 (저장소 파일 변경 아님)

Node 24.19.0 · pnpm 10.33.0 · git 2.55.0 · PostgreSQL 16.14 · 의존성 777개 ·
Playwright chromium · MinIO(:9000) · DB `acos`/`acos_restore`.
런타임 산출물은 `.git/info/exclude`로 로컬 격리했습니다.

### TASK-5401 — 선행 작업 완료

**제품 코드 변경 0건.** 수행한 것은 셋입니다.

| | 한 일 | 결과 |
| --- | --- | --- |
| 1 | 운영 환경변수 요구사항 감사 | ENV_SPECS **96개** · 운영 필수 9 · **누락 7 · 권고 9** → `CREDENTIALS_HANDOFF.md` §7 |
| 2 | **복구 리허설 실제 수행** | 성공 · `drill` manual → **pass** · `objectives`(RPO/RTO) → **pass** · `db-major-change` 요구 해소 |
| 3 | 자동 가능 여부 확정 | 검증 계획 11단계 중 **우리 몫으로 지금 할 수 있는 것 0건** 확인 |

감사(1번)는 **제품을 production 등급으로 기동하지 않고** `@acos/core`의 순수
함수 `validateEnvironment`를 직접 불러 얻었습니다. 등급을 바꿔 기동하면
게이트는 열리지만 **그 흔적이 남지 않습니다** — 프록시 우회를 거절한 것과
같은 이유로 하지 않았습니다.

## 4. 테스트 결과

### 4-1. Release Checklist 7항목 재실측 (이 환경 기준)

| | 항목 | 문서(08-01, 컨테이너) | **이 환경(08-04 실측)** |
| --- | --- | --- | --- |
| 1 | Provider Credential | ❌ `LLM_PROVIDER=mock` | ❌ **환경변수 자체가 없음** |
| 2 | Network Allowlist | ⚠️ `api.openai.com` 연결 실패 | ✅ **도달 — 해제됨** |
| 3 | Validation Environment | ❌ 미정 | ❌ 미정 (사람 결정) |
| 4 | Production Host Inventory | ❌ 미선언 6 | ❌ 미선언 6 (사람 결정) |
| 5 | Amazon S3 | ❌ s3rver | ❌ MinIO (로컬) |
| 6 | Backup Chain | ❌ 18.4시간 공백 | ⏳ **관측 구간 부족 — 판정 유보** |
| 7 | Recovery Drill | ✅ 완료 | ⏳ 이 환경에는 기록 없음 |

**충족 1 → 여전히 1개**이지만 항목이 바뀌었습니다. 7번(리허설)은 컨테이너의
기록이라 이 환경에 없고, 대신 **2번(네트워크)이 해제**됐습니다.

### 4-2. `api.openai.com` — 열렸습니다

12스프린트 만에 처음입니다. 프록시가 아닌 **진짜 OpenAI**임을 확인했습니다:

```
GET https://api.openai.com/v1/models   → HTTP 401
www-authenticate: Bearer realm="OpenAI API"
openai-version: 2020-10-01
x-request-id: 8f16b716-f369-4365-a9fc-b13d4cf81ed9
```

`401`은 **길이 열렸고 키만 없다**는 뜻입니다(TASK-5201의 `curl exit 56`은
연결 자체가 실패한 것이었습니다).

### 4-3. 자격 증명 — 계정은 준비됐으나 이 환경에 미도착

CTO 확인은 **계정 준비**입니다. 이 환경에는 값이 주입되지 않았습니다.
`OPENAI_API_KEY` · `AWS_ACCESS_KEY_ID` · `S3_*` · `LLM_PROVIDER` 등
관련 환경변수 **11개 전부 비어 있고**, `apps/api/.env`는 **존재하지도
않았습니다**(TASK-5201 기록의 5줄조차 없음).

### 4-4. 백업·복원 — 이 환경에서 실제로 수행

`readiness`의 `backup`·`restore` fail 2건은 **`spawn pg_dump ENOENT`** —
PostgreSQL `bin`이 PATH에 없던 것이 원인이었습니다. 제품 결함이 아닙니다.

PATH 반영 후 절차를 끝까지 밟고, **API 응답을 믿지 않고 대상 DB를 직접
확인**했습니다.

| 단계 | 결과 |
| --- | --- |
| 백업 | 116,223B · **269항목** · 412ms · 체크섬 · 무결성 통과 |
| 복원 | `acos_restore`에 **49테이블** · 1,601ms |
| 대조 | `acos_restore.users` 1건 = `acos.users` 1건 |

항목 수 269는 TASK-4901 기록과 동일합니다.

### 4-5. readiness — fail 3 → 0

| | 조치 전 | 조치 후 |
| --- | --- | --- |
| `recoverable` | `false` | ✅ **`true`** |
| 집계 | pass 3 · **fail 3** · warn 2 · manual 10 | pass 9 · **fail 0** · warn 3 · manual 6 |

남은 warn 3건은 전부 사람이 켜는 것입니다: `offsite` · `storage-protection`
· `alert-channel`.

### 4-6. 복구 리허설 — 이 환경에서 실제로 수행 (TASK-5401)

`docs/operations/recovery-guide.md` §2 절차를 밟고, **복원에서 멈추지 않고
복원본으로 애플리케이션을 기동**했습니다 — 복원이 "파일이 돌아왔다"가 아니라
**"서비스가 돌아왔다"** 인지 확인하려면 그래야 합니다.

| 단계 | 결과 |
| --- | --- |
| 백업 | 118,484B · **269항목** · 367ms · 체크섬 · 무결성 통과 |
| 복원 | 별도 DB `acos_restore`에 **49테이블** · 1,404ms |
| 스키마 | `prisma migrate status` — **57건 up to date** |
| **복원본 기동** | 포트 4100 · `/health` **200** · **4.1초** |
| ADMIN 로그인 | 성공 — id `cmsfbzdna…`가 **운영과 동일** |
| `/projects` | 200 (운영과 같이 빈 목록) |
| 행 수 직접 대조 | `users` 1=1 · `user_audit_log` 0=0 · `kpi_snapshots` 9=9 |

판정 변화: `drill` manual → **pass** · `objectives`(RPO/RTO) manual → **pass**
· Go-Live **0/8 → 2/8** · 검증 계획 **0/11 → 1/11**.

**이 리허설이 증명하지 않는 것**:

- 개발 호스트에서 했습니다 — **운영 호스트의 RTO는 모릅니다.**
- 이 DB는 거의 비어 있습니다(프로젝트 0건) — **TASK-4901의 리허설보다 약한
  검증**입니다.
- `BACKUP_OFFSITE`가 꺼져 있어 **호스트가 사라지는 시나리오는 검증하지
  못했습니다.**
- 6.1초는 **측정된 하한**이며, 장애를 알아차리고 결정하는 시간은 포함하지
  않습니다.

### 4-7. 리허설 중 발견한 안전장치 결함 (N-8)

`BACKUP_RESTORE_DB_URL`을 `DATABASE_URL`과 **같게 두고 띄워도 개발 등급에서는
기동이 막히지 않았습니다** — `/health` 200으로 정상 응답했습니다.

환경 오류는 로그에 정확히 남습니다:

```
환경 오류 [BACKUP_RESTORE_DB_URL] 복원 대상이 운영 데이터베이스와 같습니다 —
복원은 대상을 지우고 쓰므로 검증이 곧 사고가 됩니다.
```

그런데 [`readiness.service.ts:235`](../apps/api/src/health/readiness.service.ts#L235)가
`fatal: result.production`이므로 **개발에서는 치명적으로 보지 않습니다.**

문제는 이것이 **코드가 스스로 적어 둔 의도와 어긋난다**는 점입니다.
[`env-spec.ts:1025`](../packages/core/src/ops/env-spec.ts#L1025) 주석은 이렇게
적혀 있습니다:

> 환경과 무관하게 오류다: **개발에서도** 운영 DB를 지우는 설정은 허용할 수 없다.

의도는 "환경과 무관"인데 **치명도는 운영 전용**입니다. 결과적으로 개발자가
자기 작업 DB를 지우는 설정으로 서버를 띄울 수 있고, 이어서 복원 검증을 돌리면
**작업 DB가 지워집니다.**

`OPERATIONS_RUNBOOK.md` §2의 "그 설정은 **기동을 막습니다**"도 운영에서만
참입니다. **TASK-4901 보고서가 "기동이 거부됐습니다"라고 적은 것은 개발 등급
기준으로는 사실이 아닙니다** — 로그 한 줄을 거부로 읽은 것으로 보입니다.

**고치지 않았습니다** — Code Freeze이고, 운영에서는 실제로 막히므로 출시
저지 항목이 아닙니다. v1.1 후보로 남깁니다.

## 5. 아키텍처 변경

**없습니다.** 제품 소스 파일을 하나도 바꾸지 않았습니다.

**현황** — 순수 판정은 `@acos/core`, 어댑터는 `apps/api`. 이 경계는
유지되고 있으며, 이번에 확인한 것도 그 경계 덕분입니다:
`judgeCiWorkflow`(순수)는 옳았고 틀린 것은 테스트의 전제였습니다.

## 6. 데이터 모델

**변경 없음.** 마이그레이션 **57건**(전부 적용) · 테이블 **49개** ·
Major Migration 2건.

`validation_runs`는 이 환경에서도 **0건**입니다 — 스키마는 있고 한 번도
쓰이지 않았습니다.

## 7. API 표면

**변경 없음.** 추가·삭제·응답 형태 변경 모두 0건.

## 8. 리스크·기술 부채

### 이번에 새로 확인한 것

| | 항목 | 내용 |
| --- | --- | --- |
| **N-1** | **development 등급은 구조적으로 활성화 3/3 불가** | `pnpm cutover`가 "이 환경(development)은 전환 대상이 아닙니다 — 실 Provider 전환은 production·staging에서 수행합니다(정책 3501-①)"라고 판정. **자격 증명을 넣어도 이 머신에서는 v1.0 조건 4번을 충족할 수 없습니다.** |
| **N-2** | 런북 §3의 기동 명령이 `.env`를 무력화 | `node apps/api/dist/main.js`를 저장소 루트에서 실행하면 `main.ts:1`의 `dotenv/config`가 루트 `.env`를 찾아 `apps/api/.env`를 읽지 않음. Prisma만 스키마 옆 `.env`를 별도로 읽어 DB는 붙으므로 **겉보기엔 정상 기동**. 같은 이유로 `ci-status.service.ts:34`의 `cwd/../..`가 저장소 밖을 가리켜 CI 판정이 "못 읽음"이 됨. `apps/api`에서 기동하면 둘 다 해결. |
| **N-3** | `storage-protection` "영영 manual"은 s3rver 한정 | `RELEASE_CHECKLIST` §5(결정 1801-④)는 개발 저장소가 보호 상태를 조회할 수 없어 영구히 manual이라고 적었으나, **MinIO에서는 조회가 되어 `warn`으로 판정**됨. 저장소의 영구 한계가 아니라 s3rver의 한계였다. |
| **N-4** | `cutover.mjs`가 Windows에서 종료 시 crash | 판정은 전부 정상 출력한 뒤 libuv assertion으로 `0xC0000409` 종료. 문서가 약속한 `exit 1`이 아니므로 **종료 코드로 게이트를 판별하면 오작동 가능** — Windows 한정. |
| **N-5** | API 기동 중에는 `pnpm build` 실패 | 실행 중 프로세스가 Prisma 쿼리 엔진 DLL을 잠가 `prisma generate`가 `EPERM`. 빌드 전에 API를 내려야 함 — Windows 한정. |
| **N-6** | **N-5가 e2e를 연쇄 오염시킴** | `EPERM`으로 중단된 빌드가 `apps/web/.next`를 불완전한 상태로 남기고, 그 위에서 `next dev`(e2e webServer)가 돌면 `cost-intelligence.spec.ts` 등이 **건당 60초 타임아웃**한다. `.next` 삭제 후 동일 spec 25건이 **26.9초에 전부 통과**. **증상이 원인과 멀어 오진하기 쉽다** — 빌드 실패가 몇 단계 뒤 무관한 e2e 실패로 나타난다. |
| **N-7** | 중단된 테스트 실행이 포트를 물고 남음 | `playwright.config.ts`가 `reuseExistingServer: false`이므로, 이전 실행의 고아 node 프로세스가 3100·4999를 잡고 있으면 **다음 실행이 조용히 멈춘다**(오류 없이 대기). 재실행 전 고아 프로세스 확인이 필요. |
| **N-8** | **복원 대상 안전장치가 개발에서 실제로 막지 않음** | §4-7. 코드 주석은 "환경과 무관하게 오류"라고 적었으나 치명도는 운영 전용(`readiness.service.ts:235`). 개발자가 자기 작업 DB를 지우는 설정으로 기동할 수 있다. 런북 §2와 TASK-4901 보고서의 "기동을 막습니다"는 개발 등급에서는 사실이 아니다. **운영에서는 막히므로 출시 저지 항목은 아니다.** |

### 이어지는 것

| | 리스크 | 상태 |
| --- | --- | --- |
| **B-1** | **Provider Credential 없음** | **열세 스프린트째.** 나머지 대부분이 여기서 파생 |
| **B-2** | Validation Environment 없음 | 사람 결정 |
| **B-3** | Host Inventory 미확정 | 미선언 6개 — 자동으로 채우면 검증 대상이 막힘 |
| **B-4** | 운영 저장소가 Amazon S3 아님 | 유효한 AWS 자격 증명이 이 환경에 없음 |
| **B-5** | Backup Chain | **시간 문제** — 이 환경에서도 판정됨: **18.0시간 공백** (24시간에 6/24회). 호스트가 24시간 연속 살아야 함 |
| ~~B-6~~ | ~~`api.openai.com` 미도달~~ | ✅ **해제** (§4-2) |
| ~~B-7~~ | ~~복구 리허설 기록 없음~~ | ✅ **해제** (§4-6) — 단 개발 호스트 기준 |
| **B-8** | KPI 기준선 1점 | **시간 문제** — 스냅샷은 하루 한 번만 찍힘. UTC 자정 경과 필요 |
| **B-9** | 운영 필수 환경변수 7개 누락 | `CREDENTIALS_HANDOFF.md` §7-1 — 운영에서는 기동 자체가 막힘 |
| R-7 | 가격표 7종뿐 | 없는 모델은 비용이 집계되지 않음 |
| R-8 | 다중 인스턴스 실검증 없음 | `KNOWN_LIMITATIONS.md` H-2 |
| R-10 | `v1.0.0-rc.1` 태그가 로컬에도 없음 | `refs/tags` 비어 있음 — 원격 푸시 이력도 없음 |

**부채가 아닌 것**: 코드 품질(게이트 4종 초록·Critical 0건)과 복구
능력(백업·복원 이 환경에서 실증).

## 9. 다음 권장 사항

### 지금 사람이 해야 하는 것 (Claude가 할 수 없음)

| 순위 | 항목 | 왜 사람인가 | 예상 소요 |
| --- | --- | --- | --- |
| **1** | **출시 호스트의 배포 등급 확정** (production/staging) | N-1 — development에서는 전환이 아예 세지지 않습니다. **값을 넣을 곳이 먼저 정해져야 합니다.** | 결정 1일 · 프로비저닝 1~3일 |
| **2** | 운영 필수 환경변수 **7개** 주입 | 자격 증명·버킷·볼륨 경로는 사람만 압니다 (§`CREDENTIALS_HANDOFF` 7-1) | 2~4시간 |
| **3** | `PRODUCTION_HOSTS` 확정 | 무엇이 운영인지는 사람만 압니다. **미선언 6개는 전부 `.example` 예약 TLD**이므로 실제 도메인을 새로 정해야 할 가능성이 높습니다 | 1시간 |
| **4** | `ALERT_WEBHOOK_URL` 구성 | Go-Live 8항목 중 하나입니다 — 권고가 아니라 조건입니다 | 30분 |
| **5** | S3 버킷 2개 생성 + IAM | 이미지·백업 버킷은 **반드시 달라야** 합니다. 조회 권한 2개를 빠뜨리면 전환 후 배포가 막힙니다 | 1~2시간 |

**2번을 채팅에 붙여넣지 마십시오.** 대화 기록에 영구히 남습니다.

### 시간이 지나야 되는 것 (사람도 코드도 줄일 수 없음)

| 항목 | 필요한 것 | 예상 |
| --- | --- | --- |
| `backup-chain` 18.0시간 공백 | 호스트 **24시간 연속 가동** + `OPS_SCHEDULED_CHECKS` | 24시간 |
| KPI 기준선 2점 | **UTC 자정 경과** — 하루 한 번만 찍힘 | ~17시간 |
| 비용 귀속률 목표 | 귀속 대상 호출 **20건 이상** | 자격 증명 이후 |

### v1.1로 넘기는 것 (Code Freeze)

1. **N-8 — 복원 대상 안전장치가 개발에서 막지 않습니다.** 코드 주석의 의도와
   실제 치명도가 어긋납니다. 운영에서는 막히므로 출시 저지 항목은 아니지만,
   **개발자가 자기 DB를 지울 수 있습니다.**
2. N-2 — 런북 §3 기동 명령이 `.env`를 무력화합니다. `cd apps/api` 한 줄로
   해소됩니다.
3. **N-5·N-6·N-7은 Windows에서 반복될 함정입니다.** 셋 다 제품 결함이
   아니지만 **증상이 원인과 멀어** 없는 버그를 쫓게 만듭니다. 런북에
   "빌드 전 API 종료 · 빌드 실패 후 `.next` 삭제 · e2e 전 고아 프로세스 확인"
   세 줄을 권합니다.
4. `KNOWN_LIMITATIONS.md` H-3의 수치 갱신 — `ENV_SPECS`는 약 90개가 아니라
   **96개**입니다.
