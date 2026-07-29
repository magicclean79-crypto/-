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
| 보고 기준 TASK | **TASK-1501 — High Availability & Operations Reliability** (Sprint 15) |
| 보고일 | 2026-07-29 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **알림이 재시작을 견디고, 멈춘 점검이 스스로 드러난다** — 영속 큐·Retry Worker·Dead Letter Queue + Scheduler Stopped Alert + 보관 예약화 |
| 구현 중단 상태 | **TASK-1501 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 보관 시각의 시간대·Redis 장애 시 서비스 범위·DLQ 보존 → **CTO_REQUEST #48 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **758** — core 376(+25) · api 322(+10) · **web e2e 60(+3)** — 전체 통과 |
| TypeScript | `tsc --noEmit` (4개 워크스페이스) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1501 — High Availability & Operations Reliability

CTO 결정 1401-①~④가 이번 TASK의 실질 범위였다. 넷 다 **지난 보고에서 스스로
올린 부채이거나 그에 대한 판단**이라, 이번 주기는 앞선 두 Sprint가 남긴 구멍을
닫는 일이었다.

**1. Scheduler Stopped Alert** (결정 1401-①)

Redis 장애 시 **단일 모드로 자동 폴백하지 않는다**. 폴백하면 여러 인스턴스가
동시에 점검을 돌리고, 그것이 잠금을 넣은 이유를 무효로 만든다. 대신 **멈춘 사실
자체를 알린다**.

- **감시자는 잠금 없이 돈다.** 멈춘 원인이 대개 잠금을 못 잡는 것인데, 감시까지
  잠금을 요구하면 **정작 알려야 할 때 알리지 못한다**. 여러 인스턴스가 동시에
  감지해도 경보 `key`가 같아 중복되지 않는다 — 이미 있는 중복 판정을 그대로 썼다.
- **판정은 관대하게** — 간격의 3배(`OPS_SCHEDULER_GRACE_FACTOR`)를 넘겨야 멈춘
  것으로 본다. 한 번 늦었다고 경보하면 사람이 경보를 무시하게 된다.
- 한 번도 안 돌았으면 **기동 시점부터** 센다 — 방금 뜬 서버를 장애라 하지 않는다.
- **원인이 잠금이면 그렇게 적는다** — 원인을 모르면 어디부터 봐야 할지 알 수 없다.

**2. Persistent Notification Queue · Retry Worker · Dead Letter Queue**
(결정 1401-②)

TASK-1401의 재시도는 프로세스 안에서만 돌아, 인스턴스가 재시작하면 진행 중이던
재시도가 사라졌다. 이제 경보는 큐에 담기고 워커가 꺼내 보낸다.

| 상태 | 뜻 |
| --- | --- |
| `PENDING` | 대기 — `nextAttemptAt`이 지나면 워커가 집어 간다 |
| `SENT` | 전송 성공 |
| `DEAD` | **Dead Letter** — 사람이 고쳐야 나간다. **지우지 않는다** |

- **워커는 리더만 돌린다** — 여러 인스턴스가 같은 항목을 집으면 같은 알림이
  여러 번 간다. 잠금을 못 잡으면 조용히 넘긴다(정상 동작이라 소음이 될 이유가 없다).
- **Dead Letter로 가는 경우는 둘**이다: 되돌릴 수 없는 실패(4xx)와 최대 시도 소진.
  `requeue`로 **시도 횟수를 되돌려** 다시 보낸다 — 설정을 고친 뒤 쓰는 절차다.
- **큐 적재 실패는 알림이 아예 사라지는 것**이라 로그로 크게 남긴다.

**3. Alert Archive 예약화** (결정 1401-③)

보관이 네 번째 예약 점검(`alert-archive`)이 되어 **매일 04:00 UTC**에 돈다.

이를 위해 스케줄러를 **단일 티커**로 재구성했다. 점검마다 타이머를 두면 "매일
몇 시"를 표현할 수 없고, 재기동할 때마다 시점이 밀린다. 짧은 주기로 한 번 깨어나
각 점검의 `shouldRun`을 묻는 편이 간격·시각을 한 규칙으로 다룬다.

- **그 시각 전에는 한 번도 안 돌았어도 돌지 않는다** — "새벽에 돌리라"는 지시를
  기동 시점에 어기지 않기 위해서다.
- 보관은 **경보를 만들지 않는다** — 정리 작업이다.

**4. 운영 기본 채널 정책** (결정 1401-④)

| 채널 | 최소 심각도 | 해소 알림 |
| --- | --- | --- |
| Slack | Warning 이상 | 포함 |
| **Email** | **Critical 이상** | 포함 |
| Webhook | Warning 이상 | 포함 |

메일만 Critical인 이유는 분명하다 — 메일은 지우기 번거롭고 쌓이면 읽지 않게 된다.
`ALERT_*_MIN_LEVEL`·`ALERT_*_RESOLVED`로 전부 바꿀 수 있고, **알 수 없는 값은
기본값으로 되돌린다**(이상한 정책으로 조용히 도는 것보다 안전하다).

**웹 `/admin/production`** — 알림 큐 섹션(대기·전송 완료·Dead Letter·워커 상태·
"지금 보내기"·"실패분 다시 보내기"), 보관 점검의 시각 표시, 잠금을 못 쓸 때
"예약 점검이 돌지 않습니다" 경고.

### CTO 결정 1401-①~④ 반영

| 결정 | 반영 |
| --- | --- |
| ① 자동 폴백 금지 + Scheduler Stopped Alert | **이행** — 폴백 코드 없음. `lockHealthy`를 감시자에 넘겨 원인까지 적는 critical 경보 |
| ② Persistent Queue + Retry Worker + DLQ | **이행** — `notification_queue`(마이그레이션 28). 라이브에서 **재시작 생존** 확인 |
| ③ Archive를 Scheduler에 편입 (하루 1회 새벽) | **이행** — `alert-archive` 점검, 기본 04:00 **UTC**(시간대는 #48 ①에서 확인 요청) |
| ④ 운영 기본 채널 정책 | **이행** — core `DEFAULT_CHANNEL_POLICY`로 선언, 환경변수 우선 |

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 15 | **TASK-1501 — High Availability & Operations Reliability** | **완료 — 승인 대기** |
| Sprint 14 | 1401 운영 플랫폼 | 승인 · 공식 종료 |
| Sprint 13 | 1301~1302 실 Provider 통합·운영 자동화 | 전체 승인 · 공식 종료 |
| Sprint 12 | 1201~1202 관리 콘솔·운영 준비 | 전체 승인 · 공식 종료 |
| Sprint 11 | 1101~1102 Sticky·Lifecycle·Analytics | 전체 승인 · 공식 종료 |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · 공식 종료 |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 351 · **시각 점검·정지 판정 9 · 채널 정책 5 · 큐 6 · 정지 경보 4 · 기타 1** | 376 | ✅ |
| `apps/api` | Service+API — 기존 312 · **HA 운영 10** | 322 | ✅ |
| `apps/web` | Playwright e2e — 기존 57 · **큐·DLQ·보관 시각·잠금 불가 3** | 60 | ✅ |
| **합계** | | **758** | **전체 통과** |

신규 테스트가 검증하는 것:

- **core(시각 점검)**: `HH:MM` 해석과 거부(24:00·04:60·"새벽"·0400) ·
  **그 시각 전에는 한 번도 안 돌았어도 돌지 않는다** · 지나면 돈다 · 오늘 이미
  돌았으면 다시 돌지 않는다 · 해석 불가 시각은 기본값(04:00)
- **core(정지 판정)**: 간격 3배 경계 · **한 번도 안 돌았으면 기동 시점 기준** ·
  꺼 둔 점검은 멈춘 것이 아니다 · 여유 배수 조정
- **core(정지 경보)**: 멈춘 것만 critical · **원인이 잠금이면 그렇게 적는다** ·
  실행 이력 없음을 말한다 · 멈춘 것이 없으면 경보도 없다
- **core(채널 정책)**: 공식 기본값(메일만 critical) · 환경변수 변경 ·
  **알 수 없는 값은 기본값** · 주소 없는 채널은 꺼짐 ·
  **기본 정책에서 warning은 메일로 가지 않는다**
- **core(큐)**: 성공/재시도/Dead Letter 3경로 · 다음 시도 시각 계산 ·
  **4xx는 즉시 Dead Letter** · 최대 시도 소진 · `isDue`(SENT/DEAD는 다시 집지
  않는다) · 요약 집계
- **api**: 경보가 **즉시 전송되지 않고 큐에 담긴다** · 워커가 꺼내 보내고 시도를
  기록 · 최대 시도 소진 시 DEAD로 남고 **지워지지 않는다** · requeue가 시도
  횟수를 되돌린다 · **워커는 리더만**(잠금 실패 시 skip) · 보관이 예약 점검으로
  돌고 **경보를 만들지 않는다** · 보관은 시각 기반 구성 · **정지 경보 발생/미발생**
  · 감시 끄기 · **기본 채널 정책이 API에 그대로 반영**(주소는 여전히 비노출) ·
  신규 API 전부 ADMIN 전용
- **웹 e2e**: Dead Letter 표시와 "지우지 않고 남깁니다" 문구 · 워커 중단 표시 ·
  재시도 버튼 동작 · 보관의 **매일 04:00 UTC** 표시 · 잠금 불가 시 경고

라이브 검증 (실 PostgreSQL + 실 Redis + s3rver, 마이그레이션 28 적용):

- **큐 + 재시도**: 503을 두 번 반환하는 수신 서버에 대해 워커가 **2회째 시도로
  SENT**(`attempts=2, lastStatus=200`)
- **재시작 생존 (결정 1401-② 핵심)**: 워커를 끈 채 경보 발생 → 큐에 `PENDING`
  적재 → **프로세스 강제 종료** → 워커를 켜고 재시작 → **큐에서 꺼내 전송
  성공**(`SENT`). TASK-1401에서는 여기서 알림이 사라졌다
- **Dead Letter**: 404 주소 → 재시도하지 않고 **1회 시도 후 `DEAD`**,
  `lastError="HTTP 404"`. `requeue` 후 `PENDING`·`attempts=0`으로 복귀
- **Scheduler Stopped Alert (결정 1401-①)**: 정상 시 20초에 예약 실행 4회 →
  **Redis 중단** → 15초간 예약 실행 **0회**(자동 폴백 없음) → 정지 경보
  **CRITICAL** 발생, 메시지에 "분산 잠금(Redis)을 사용할 수 없습니다" 포함 →
  **Redis 복구** → 예약 실행 3회 재개 · 경보 **RESOLVED**
- **보관 예약화**: `alert-archive` 점검이 "보관 0건 … **삭제하지 않습니다**"로
  실행, 화면에 "매일 04:00 UTC" 표시
- 브라우저 `/admin/production` 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 전달의 영속화와 자기 감시**:

```
              ┌── 단일 티커 (간격 + 시각 통합) ──┐
              │   shouldRun → run(job)          │
ScheduledChecks                                 └─▶ alert-archive (매일 04:00 UTC)
   │                │
   │                └── watchdog (잠금 없이) ─▶ isSchedulerStopped
   │                                              └─▶ scheduler-stopped 경보
   ▼
AlertService ─▶ enqueue ─▶ notification_queue (PENDING)
                                │
                    Retry Worker (리더만) ─▶ sendOnce ─▶ decideQueueOutcome
                                │                          ├─ sent  → SENT
                                │                          ├─ retry → nextAttemptAt
                                └─ Dead Letter (DEAD) ◀────┘ 4xx·시도 소진
                                        │
                                    requeue (사람이 고친 뒤)
```

① **전달이 프로세스 수명과 분리**됐다 — 재시작해도 알림이 사라지지 않는다.
② **감시가 잠금과 분리**됐다 — 잠금이 죽어도 감시는 돈다(그게 알려야 할 상황이다).
③ 간격·시각 점검이 **한 규칙**(`shouldRun`)으로 통일됐다.
④ **자동 폴백을 넣지 않았다** — 조용한 중복 실행보다 시끄러운 정지가 낫다는
   결정을 코드가 그대로 지킨다.

**유지되는 핵심 결정**: Alert 정책 4종(1302-①) · 종류별 쿨다운(1302-①) ·
게이트 운영 기본 ON(1302-③) · 보관 90일·삭제 금지(1302-④) · Live Check 수동
(1301-①) · 진단 분리(1301-③) · Unpriced 비차단(1301-⑤) · `/ops/*` ADMIN 전용

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 28건**,
drift 없음

## 6. 데이터 모델

**마이그레이션 28** (`20260729120000_notification_queue`):

| 대상 | 변경 | 이유 |
| --- | --- | --- |
| `NotificationQueueStatus` (신규 enum) | PENDING / SENT / **DEAD** | Dead Letter를 상태로 남긴다 |
| `notification_queue` (신규) | alertKey·channel·level·**payload(Json)**·attempts·**nextAttemptAt**·lastStatus·lastError·sentAt·deadAt | 재시작을 견디는 전달. `payload`를 통째로 담아 재시도 때 그대로 다시 쓴다 |

`notification_deliveries`(시도 이력)는 그대로 남는다 — 큐가 "무엇을 보낼 것인가",
이력이 "무엇을 보내려 했고 어떻게 됐는가"로 역할이 다르다.

## 7. API 표면

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | **`/ops/notifications/queue`** | **큐 현황 (ADMIN)** — 대기·성공·Dead Letter·워커 상태 |
| `POST` | **`/ops/notifications/queue/drain`** | **지금 보내기 (ADMIN)** — 워커를 기다리지 않는다 |
| `POST` | **`/ops/notifications/queue/requeue`** | **Dead Letter 재시도 (ADMIN)** — `{ ids? }` |

- `GET /ops/alerts`의 `coordination`에 **`lockHealthy`** 추가 (false면 예약
  점검이 돌지 않는다), `schedules[]`에 **`dailyAtMinutes`** 추가
- 경보 종류에 **`scheduler-stopped`** 추가
- 기존 API 계약 변경 없음

## 8. 리스크·기술 부채

1. **1501 해석 미확인** — 보관 시각의 시간대·Redis 장애 시 서비스 범위·DLQ 보존
   (CTO_REQUEST #48)
2. **보관 시각은 UTC 기준** — "새벽"이 운영자의 현지 시각이라면 `04:00 UTC`는
   한국 기준 오후 1시다. 시스템의 다른 시간 계산(예산 창)이 전부 UTC라 맞췄으나,
   의도와 다를 수 있다(#48 ①)
3. **Redis 장애 시 LLM 호출은 계속된다** — 멈추는 것은 예약 점검뿐이다. 즉
   **비용은 계속 나가는데 비용 점검은 멈춘 상태**가 될 수 있다. 이 조합을
   어디까지 허용할지 판단이 필요하다(#48 ②)
4. **Dead Letter는 무한 보존** — 경보 보관(90일)과 달리 큐 정리 정책이 없다.
   실패가 반복되면 계속 쌓인다(#48 ③)
5. **워커 처리량은 한 바퀴 20건 고정** — 대량 경보 시 배출이 느릴 수 있다.
   현재 경보 발생량에서는 문제가 없다
6. **실 SMTP 발송은 여전히 미검증** — 샌드박스에 SMTP 서버가 없다.
   본문 생성·정책 판정·배선까지만 확인했다(TASK-1401에서 올린 항목 그대로)
7. **실키 스모크·백업 자동화** — 기존 부채

## 9. 다음 권장 사항 (Sprint 15 후속 후보)

1. **CTO_REQUEST #48 확인** — TASK-1501 해석 확인 및 다음 지시
2. **Redis 장애 시 LLM 호출 정책** — 비용 점검이 멈춘 채로 호출을 계속할지
3. **Dead Letter 보존 정책** — 경보 보관(90일)과 같은 규칙을 적용할지
4. **운영/스테이징 실 SMTP·실키 스모크** — 남은 미검증 경로
5. **경보 발생량 기반 워커 튜닝** — 지금은 필요 없으나 채널이 늘면 재검토
