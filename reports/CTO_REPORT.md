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
| 보고 기준 TASK | **TASK-1601 — Production Verification & Operational Readiness** (Sprint 16) |
| 보고일 | 2026-07-29 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **"복구할 수 있다"를 주장에서 증거로 바꿨다** — 실 백업·실 복원 검증·재해 복구 체크리스트 + **메일 경로 실서버 검증(부채 상환)** |
| 구현 중단 상태 | **TASK-1601 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 백업 저장 위치·복원 검증 대상 DB 운영 준비·백업 신선도 기준 → **CTO_REQUEST #49 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **808** — core 405(+29) · api 334(+12) · **web e2e 69(+9)** — 전체 통과 |
| TypeScript | `tsc --noEmit` (4개 워크스페이스) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1601 — Production Verification & Operational Readiness

지난 Sprint까지는 **"잘 돌고 있는가"** 를 봤다. 이번 주기의 질문은 하나다 —
**"지금 무너지면 되살릴 수 있는가."**

이 질문이 중요한 이유는 지금까지의 모든 운영 기능이 **한 번도 확인되지 않은
전제** 위에 서 있었기 때문이다. 백업은 받은 적이 없고, 복원은 해 본 적이 없고,
메일 경로는 살아 있는 서버로 검증된 적이 없었다. 화면에는 "정상"이라 적혀
있었지만, 그것은 **확인한 정상이 아니라 확인하지 않은 정상**이었다.

**1. Real SMTP Validation — 오래된 부채를 갚았다**

`POST /ops/notifications/verify-smtp`가 실제 SMTP 서버에 연결하고 인증한다.

- **메일은 보내지 않는다.** `verify()`는 EHLO → AUTH → QUIT까지만 한다. 점검이
  수신함을 채우면 사람이 점검 메일을 무시하게 되고, 그러면 진짜 경보도 함께
  묻힌다.
- 설정이 없으면 `configured:false`로 알린다 — **미구성과 실패는 다르다.**
- 결과에 `ALERT_EMAIL_TO`를 담지 않는다 — 수신자 주소는 비밀이다.

**이번 세션에서 처음으로 살아 있는 SMTP 서버와 실제 대화를 주고받아
검증했다**(EHLO → AUTH → QUIT, 12ms). TASK-1401부터 세 번의 보고서에 "실 SMTP
미검증"으로 올렸던 부채를 갚았다.

**2. Backup Automation — 크기를 기록하는 이유**

`pg_dump --format=custom`으로 매일(`OPS_CHECK_BACKUP_AT`, 기본 03:00 로컬) 받는다.

- **크기를 기록한다.** `pg_dump`는 부분 실패에도 0에 가까운 파일을 남길 수 있고,
  그걸 "성공"으로 세면 **복구 계획이 통째로 거짓이 된다.** 1KB 미만은 `failed`다.
- 보존 기간(기본 14일)이 지난 덤프만 지우되, **최근 3개(`BACKUP_KEEP_MINIMUM`)는
  나이와 무관하게 남긴다** — 정리가 마지막 백업을 지우는 일은 없어야 한다.
- 실패해도 **예외를 던지지 않고 이력에 남긴다.** 예약 실행이 죽으면 다음 백업도
  못 받는다.
- 화면·API에는 **파일명만** 노출한다. 절대 경로는 서버 구조를 드러낸다.

**3. Restore Verification — 복원해 보지 않은 백업은 백업이 아니다**

매일(`OPS_CHECK_RESTORE_AT`, 기본 03:30 로컬) 최신 덤프를 **별도 DB**에 복원하고
테이블 수를 센다.

- 복원은 **반드시 `BACKUP_RESTORE_DB_URL`** 에 한다. 운영 DB에 복원하는 자동화는
  만들지 않았다 — **검증하려다 데이터를 잃는 것이 최악이다.**
- 대상이 없으면 `configured:false`. **하지 못한 것을 실패로 세지 않는다.**
- `pg_restore`는 무해한 경고에도 비영점 종료할 수 있어, 판정은 종료 코드가 아니라
  **복원 후 테이블 수**로 한다. 0개면 실패다.
- 이력이 없으면 `missing`이고, **그것은 통과가 아니다.**

**4. Disaster Recovery Checklist — 배포 체크리스트와 다른 질문**

1202의 배포 체크리스트가 "지금 배포해도 되는가"라면, 이쪽은 "지금 무너지면
되살릴 수 있는가"다.

| 항목 | 복구 좌우 | 판정 |
| --- | --- | --- |
| 백업 존재·신선도 | ○ | 자동 |
| 복원 검증 | ○ | 자동 |
| 데이터베이스 연결 | ○ | 자동 |
| 이미지 저장소 접근 | ○ | 자동 |
| 분산 잠금(Redis) | × | 자동 |
| 경보 전달 채널 | × | 자동 |
| 복구 절차 숙지·연락 체계 | × | **직접 확인** |

`복구 가능`은 ○ 항목에 실패가 없을 때만 true다. Redis가 죽어도 복구는 할 수
있으므로 복구 가능성을 낮추지 않는다. 마지막 항목은 자동 판정이 불가능하므로
**`manual`로 남긴다** — 모르는 것을 통과로 처리하지 않는다.

**5. Provider Smoke Automation — 자리는 만들되 켜지 않는다**

예약 자리(`OPS_CHECK_SMOKE_AT`)는 있지만 **기본은 꺼져 있다**. 실제 API를 호출해
과금되기 때문이다(CTO 결정 1301-①). 구현 중 **`runAll`("지금 점검")이 꺼진
작업까지 실행하는 것을 발견해 고쳤다** — 과금되는 동작이 "전체 점검" 버튼에
딸려 도는 일은 없어야 한다.

**6. CTO 결정 1501-①~④ 반영**

| 결정 | 구현 |
| --- | --- |
| ① 보관은 04:00 **로컬** | 일 1회 점검 4종을 로컬 시각 판정으로 전환(`TZ`) |
| ② Redis 장애 시 LLM 계속·Scheduler만 중단·30분 이상이면 Critical 반복 | `detectLockOutageAlert` + `OPS_LOCK_OUTAGE_THRESHOLD_MS`(기본 30분), 잠금 장애 시작 시각 추적 |
| ③ Dead Letter 삭제 금지·90일 후 Archive | `NotificationQueueStatus.ARCHIVED` + `archiveDeadLetters()`를 `alert-archive` 점검에 편입 |
| ④ Grace Factor 3배 유지·Job별 조정 | `resolveGraceFactor` — 종류별(`OPS_SCHEDULER_GRACE_<JOB>`) ?? 전체 ?? 3 |

**7. Operations Dashboard / Redis Health Dashboard**

웹 `/admin/operations`(ADMIN 전용) — 체크리스트·백업 이력·복원 이력·Redis·SMTP를
한 화면에. "지금 백업"·"지금 복원 검증"·"메일 경로 확인" 버튼을 두되, 각 화면이
**하지 않는 일**(메일을 보내지 않음, 운영 DB에 복원하지 않음)을 명시한다.

**8. 스스로 발견해 고친 결함 4건**

라이브 검증에서 나온 것들이다. 단위 테스트로는 구조적으로 잡히지 않았다.

| 결함 | 증상 | 조치 |
| --- | --- | --- |
| `runAll`이 꺼진 작업 실행 | "지금 점검"이 **과금되는 스모크**를 돌림 | `!schedule.enabled`면 건너뜀 + 테스트 |
| Prisma URL을 `pg_dump`가 거부 | `invalid URI query parameter: "schema"` — 백업 100% 실패 | `toLibpqUrl()`로 libpq 파라미터만 남김 + 단위 테스트 |
| 시각 표시가 "04:00 UTC" | 실제로는 **로컬**로 도는데 기동 로그·화면은 UTC라 표기 — 운영자가 다른 시각을 기다린다 | 로컬 표기로 수정(시간대까지 표기) + 회귀 테스트 |
| 경보 문구의 마크다운 `**` | Slack·메일·화면에 별표가 그대로 노출 | 제거 + `not.toContain("**")` 회귀 테스트 |

추가로 **"0분째 사용할 수 없습니다"** 라는 문구가 나올 수 있음을 발견해
`1분 넘게`로 고쳤다 — 상태와 설명이 어긋나면 안 된다.

## 4. 테스트 결과

| 워크스페이스 | 결과 | 이번 증분 |
| --- | --- | --- |
| `@acos/core` | **405 통과** (44 suites) | +29 |
| `api` | **334 통과** (48 suites) | +12 |
| `web` (Playwright) | **69 통과** | +9 |

**core 신규 — `disaster-recovery.spec.ts`(14) · `alerts`·`schedule`·`env-spec` 증분**

- 백업 이력 없음 → `missing`(통과 아님) · 1KB 미만 → `failed`(빈 덤프 의심)
- 복원 이력 없음 → `missing` · 복원 후 테이블 0개 → `failed`
- `복구 가능`은 critical 실패가 없을 때만 · Redis 장애는 `warn`이고 복구를 막지 않음
- `runbook` 항목은 항상 `manual` — 자동으로 통과시키지 않는다
- 잠금 장애 30분 미만은 경보 없음 · 이상이면 critical, 문구에 마크다운 없음
- **1분 미만 장애도 "0분째"라고 하지 않는다**
- 일 1회 점검은 **로컬 자정 기준** — 03:59는 아직, 04:00은 실행
- Job별 Grace Factor: 종류별 ?? 전체 ?? 3
- 복원 검증 대상 미설정은 운영에서 **경고**(오류 아님), 주소는 비밀로 취급

**api 신규 — `ops.spec.ts` 12건**

- `toLibpqUrl`이 `?schema=public`을 걷어내고 `sslmode`는 남긴다
- 복원 검증 **미구성 ≠ 실패**(`configured:false`)
- 백업 실패는 **예외 없이 이력에 기록**된다
- `alert-archive`가 경보와 Dead Letter를 **함께** 정리한다
- `GET /ops/readiness`가 이력 없음을 **복구 불가**로 판정한다
- SMTP·Redis 상태에 **`ALERT_EMAIL_TO`가 새지 않는다**
- 잠금 장애 30분 이상 → critical(문구에 "비용은 나가는데 비용 점검은 멈춘 상태")
- 일 1회 점검 설명이 **로컬**이라고 말한다(UTC 아님)
- 새 API 4종 전부 **ADMIN 전용**(401/403)

**web e2e 신규 — `operations.spec.ts` 8건 + `production-ops.spec.ts` 1건**

- 정상: 체크리스트 `복구 가능` · 백업/복원/Redis/SMTP 판정
- 복원 이력 없음 → **`복구 불가`** 와 "복원해 보지 않은 백업은 백업이 아닙니다"
- `runbook`은 **`직접 확인`** 으로 남고 통과로 세지 않는다
- Redis 장애 시 "LLM 호출은 계속됩니다"와 30분 기준 표시
- 복원 미구성 클릭 → "실패가 아니라 하지 못한 것입니다"
- "지금 백업" → 복구 지점 생성 후 판정 전환
- 백업·복원 예약은 **로컬** 시각, **과금되는 스모크는 `중단`**
- ADMIN 토큰 없으면 권한 안내만

### 라이브 검증 (실 PostgreSQL + 실 Redis + 실 SMTP + 실 `pg_dump`/`pg_restore`)

| 확인 | 결과 |
| --- | --- |
| 초기 판정 | `recoverable:false` — 백업·복원 이력 없음(통과 4·실패 2·직접 확인 1) |
| **실 SMTP** | `configured:true, ok:true, 12ms` — 서버 로그에 **EHLO → AUTH → QUIT**, 메일 발송 없음 |
| **실 백업** | 4회 전부 성공 — 수동 1회(98,673B/1.1초) + **예약 3회**(99,076~99,989B/약 0.11초) |
| **실 복원 검증** | 4회 전부 성공 — 별도 DB에 복원 후 **테이블 30개** 확인(수동 1·예약 3) |
| 백업 후 재판정 | `recoverable:true` — 통과 6 · 실패 0 · **직접 확인 1** |
| 경로 비노출 | 응답 어디에도 절대 경로 없음(파일명·디렉터리명만) |
| **Redis 중단** | Scheduler 중단 + `scheduler-stopped:lock` **CRITICAL** 발생 |
| **Redis 중단 중 LLM** | `POST /llm/complete` → **HTTP 200** (결정 1501-② 그대로) |
| Redis 복구 | 경보 **RESOLVED** → 재중단 시 **재발생**(마크다운 없는 문구로) |
| 체크리스트 | Redis 장애 시 `warn`이고 `recoverable`은 여전히 true |

화면: `/admin/operations` 스크린샷 첨부.

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 확인되지 않은 전제를 증거로 대체**:

```
ScheduledChecks (단일 티커, 로컬 시각)
   ├── backup         03:00 ─▶ pg_dump ─▶ backup_runs(크기 기록) ─▶ prune(최근 N개 보존)
   ├── restore-verify 03:30 ─▶ pg_restore ─▶ 별도 DB ─▶ 테이블 수 ─▶ restore_runs
   ├── alert-archive  04:00 ─▶ 경보 보관 + Dead Letter 보관 (삭제 아님)
   ├── provider-smoke 05:00 ─▶ 【기본 꺼짐 — 과금】
   └── watchdog (잠금 없이) ─▶ detectLockOutageAlert (30분↑) ─▶ critical 반복

GET /ops/readiness
   └─▶ judgeBackup + judgeRestore + DB + Storage + Redis + 채널 수
          └─▶ buildDisasterRecoveryChecklist ─▶ summarizeDisasterRecovery
                 └─ critical 실패 0 → recoverable
                 └─ 자동 판정 불가 → manual (통과로 세지 않음)
```

① **판정과 실행이 분리**됐다 — 크기·나이·테이블 수 경계는 core의 순수 함수라
   시계·디스크 없이 시험할 수 있고, `pg_dump` 호출은 api 어댑터에만 있다.
② **복원 검증이 백업과 한 쌍**이 됐다 — 어느 한쪽만 통과해서는 `복구 가능`이
   되지 않는다.
③ **과금되는 동작은 기본으로 돌지 않는다** — 예약에 자리는 있지만 꺼진 채다.
④ **일 1회 점검의 기준 시각이 운영자의 시간대**가 됐다.

**유지되는 핵심 결정**: Alert 정책 4종(1302-①) · 게이트 운영 기본 ON(1302-③) ·
보관 90일·삭제 금지(1302-④) · Live Check 수동(1301-①) · 진단 분리(1301-③) ·
Unpriced 비차단(1301-⑤) · 자동 폴백 없음(1401-①) · 워커는 리더만(1401-②) ·
`/ops/*` ADMIN 전용

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 29건**,
drift 없음

## 6. 데이터 모델

**마이그레이션 29** (`20260729180000_operational_readiness`):

| 대상 | 변경 | 이유 |
| --- | --- | --- |
| `backup_runs` (신규) | ok · **sizeBytes(BigInt)** · fileName · durationMs · trigger · error | 크기를 기록해야 빈 덤프를 성공으로 세지 않는다 |
| `restore_runs` (신규) | ok · **tables** · fileName · durationMs · trigger · error | 복원 결과를 종료 코드가 아니라 테이블 수로 판정 |
| `NotificationQueueStatus` | **`ARCHIVED` 추가** | Dead Letter를 지우지 않고 비켜 둔다(결정 1501-③) |
| `notification_queue.archivedAt` | 신규 컬럼 | 보관 시각 |

`sizeBytes`를 `BigInt`로 둔 이유는 덤프가 2GB를 넘길 수 있기 때문이다 —
DTO 경계에서 `Number`로 변환한다.

## 7. API 표면

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | **`/ops/readiness`** | **운영 대시보드 (ADMIN)** — 체크리스트·백업·복원·Redis·SMTP |
| `POST` | **`/ops/backup/run`** | **지금 백업 (ADMIN)** |
| `POST` | **`/ops/backup/verify-restore`** | **지금 복원 검증 (ADMIN)** — 별도 DB |
| `POST` | **`/ops/notifications/verify-smtp`** | **메일 경로 확인 (ADMIN)** — 메일은 보내지 않는다 |

- 예약 점검 종류에 **`backup` · `restore-verify` · `provider-smoke`** 추가
  (스모크는 기본 꺼짐)
- `NotificationQueueStatusDto`에 **`archived`** 추가
- 웹 신규 라우트 **`/admin/operations`**(ADMIN 전용)
- 기존 API 계약 변경 없음

## 8. 리스크·기술 부채

1. **1601 해석 미확인** — 백업 저장 위치·복원 검증 대상 DB·신선도 기준
   (CTO_REQUEST #49)
2. **`BACKUP_DIR` 기본값은 컨테이너 안이다** — 볼륨을 붙이지 않으면 컨테이너와
   함께 백업이 사라진다. 운영에서 미설정이면 경고하지만 **막지는 않는다**(#49 ①)
3. **복원 검증 대상 DB는 운영자가 만들어야 한다** — 미구성이면 "복원해 본 적
   없는 백업" 상태로 남는다. 이 DB를 어디에 둘지 결정이 필요하다(#49 ②)
4. **이미지 저장소는 백업 대상이 아니다** — S3 호환 저장소의 버킷 정책(버전
   관리·복제)에 의존한다. DB만 복원하면 이미지 참조가 깨질 수 있고, 이 부분은
   체크리스트가 **자동 판정하지 않는다**(#49 ④)
5. **실 Provider 스모크는 여전히 미검증** — 샌드박스에서 `api.openai.com`이
   차단되어 있고, 과금되므로 기본으로 켜지 않았다
6. **백업은 전체 덤프뿐이다** — 증분·PITR(WAL 아카이빙)은 없다. 최대 손실
   구간은 마지막 백업 이후 전부다(#49 ③)
7. **복원 검증은 테이블 수만 본다** — 행 수·무결성까지 보지 않는다. 스키마가
   복원됐다는 것 이상은 보장하지 않는다

## 9. 다음 권장 사항 (Sprint 16 후속 후보)

1. **CTO_REQUEST #49 확인** — TASK-1601 해석 확인 및 다음 지시
2. **백업 보관 위치 결정** — 볼륨/오브젝트 스토리지 중 어디에 둘지, 원격 복제 여부
3. **복원 검증 대상 DB 준비** — 운영 인프라에 검증 전용 인스턴스 배치
4. **이미지 저장소 백업 정책** — 버킷 버전 관리·복제를 켜고 체크리스트에 편입할지
5. **PITR 필요 여부** — 최대 손실 구간을 하루에서 분 단위로 줄일지
6. **운영/스테이징 실키 스모크** — 남은 마지막 미검증 경로
