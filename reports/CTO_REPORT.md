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
| 보고 기준 TASK | **TASK-5301 — v1.0 출시 저지 항목 재실측 및 로컬 검증 환경 구축** |
| 보고일 | 2026-08-04 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 커밋 | `5bf88b7` |
| **결론** | **정식 `v1.0.0`은 이 환경에서 원리적으로 붙일 수 없습니다** — 제품이 직접 "development는 전환 대상이 아니다"라고 판정합니다 |
| `validation_runs` | **0건** (DB에서 직접 셌습니다) |
| 코드 변경 | **테스트 1파일 · 실질 1줄.** 제품 코드 · API · DB 변경 **0건**, 새 기능 **0건** |
| 실행 환경 | **Windows 로컬** — 앞선 보고(TASK-5001~5201)는 Linux 컨테이너였고, **그 실측값은 이 환경의 값이 아닙니다** |

> **이번 보고의 핵심은 판정값의 출처를 바꾼 것입니다.** 지금까지 인용해 온
> `readiness` pass 13 · `cutover` 1/3 · `preflight` 4/11은 다른 환경의
> 3일 전 값이었고, 이 머신에서는 **한 번도 측정된 적이 없었습니다.**
> 이번에 런타임을 세워 처음 실제로 측정했습니다.

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
| `/ops/readiness` | `GET /ops/readiness` | ⚠️ pass 9 · **fail 0** · warn 3 · manual 6 · `recoverable: true` |
| `/ops/cutover` | `pnpm cutover` | ❌ 전환 0/4 · 운영 활성화 **0/3** |
| 검증 사전 점검 | `pnpm validation:preflight` | ❌ 준비 **0/11** |
| **`/ops/go-live`** | `GET /ops/go-live` | ❌ **`not-started` — 충족 0/8** |
| **Production Validation** | `POST /ops/validation-run/execute` | ❌ **미실행 — 사전 조건 미충족** |

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

### 이어지는 것

| | 리스크 | 상태 |
| --- | --- | --- |
| **B-1** | **Provider Credential 없음** | **열세 스프린트째.** 나머지 대부분이 여기서 파생 |
| **B-2** | Validation Environment 없음 | 사람 결정 |
| **B-3** | Host Inventory 미확정 | 미선언 6개 — 자동으로 채우면 검증 대상이 막힘 |
| **B-4** | 운영 저장소가 Amazon S3 아님 | 유효한 AWS 자격 증명이 이 환경에 없음 |
| **B-5** | Backup Chain | **시간 문제** — 호스트가 24시간 이상 살아야 함 |
| ~~B-6~~ | ~~`api.openai.com` 미도달~~ | ✅ **해제** (§4-2) |
| R-7 | 가격표 7종뿐 | 없는 모델은 비용이 집계되지 않음 |
| R-8 | 다중 인스턴스 실검증 없음 | `KNOWN_LIMITATIONS.md` H-2 |
| R-10 | `v1.0.0-rc.1` 태그가 로컬에도 없음 | `refs/tags` 비어 있음 — 원격 푸시 이력도 없음 |

**부채가 아닌 것**: 코드 품질(게이트 4종 초록·Critical 0건)과 복구
능력(백업·복원 이 환경에서 실증).

## 9. 다음 권장 사항

1. **출시 환경을 먼저 정해 주십시오 — 이것이 지금 최상위 저지 항목입니다.**
   N-1 때문에 로컬·development에서는 자격 증명을 넣어도 `v1.0.0`을 붙일 수
   없습니다. **production 또는 staging 등급의 실제 호스트가 필요합니다.**
   이 결정 없이는 자격 증명 주입도 소용이 없습니다.
2. **자격 증명은 그 환경에 주입해 주십시오** — 이 로컬 머신이 아닙니다.
   넣을 값과 위치는 `CREDENTIALS_HANDOFF.md` §2·§3에 있습니다.
   **채팅에 붙여넣지 마십시오.**
3. **`PRODUCTION_HOSTS` 미선언 6개를 판정해 주십시오** — 자격 증명과
   무관하게 지금 결정할 수 있는 유일한 항목입니다.
4. **Backup Chain은 그 호스트에서 `OPS_SCHEDULED_CHECKS`를 켜고 24시간 이상
   가동**해야 해소됩니다. 코드로 줄일 수 없습니다.
5. N-2는 런북 문장 한 줄(`cd apps/api`)로 해소되지만 Code Freeze라 손대지
   않았습니다 — v1.1에서 처리를 권합니다.
6. **N-5·N-6·N-7은 Windows에서 개발할 때 반복될 함정입니다.** 셋 다 제품
   결함이 아니지만, **증상이 원인과 멀어** 없는 버그를 쫓게 만듭니다.
   v1.1에서 런북에 "빌드 전 API 종료 · 빌드 실패 후 `.next` 삭제 · e2e 전
   고아 프로세스 확인" 세 줄을 넣는 것을 권합니다.
