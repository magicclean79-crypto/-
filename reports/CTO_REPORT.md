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
| 보고 기준 TASK | **TASK-1302 — Production Automation & Alerting** (Sprint 13) |
| 보고일 | 2026-07-29 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **점검이 스스로 돌고, 문제가 사람을 찾아간다** — 예약 점검 3종·경보 4종(중복 억제·해소 알림)·CI/CD 배포 게이트 + 결정 1301-②③ 이행 |
| 구현 중단 상태 | **TASK-1302 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 경보 쿨다운·전달 채널·게이트 기본 정책 → **CTO_REQUEST #46 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **664** — core 308(+33) · api 302(+12) · **web e2e 54(+4)** — 전체 통과 |
| TypeScript | `tsc --noEmit` (4개 워크스페이스) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1302 — Production Automation & Alerting

지시 8항목 전부 이행. 이번 TASK의 축은 **"사람이 보고 있지 않을 때"** 다.
TASK-1301은 좋은 점검을 만들었지만 **사람이 화면을 열어야** 결과를 볼 수
있었다. 예산이 밤사이 터지거나 키가 폐기되면 다음 날 아침에야 안다.

**1~3. Scheduled Cost Verification / Provider Validation / Health Check**

| 점검 | 보는 것 | 책임지는 경보 | 기본 간격 |
| --- | --- | --- | --- |
| `cost-verification` | 비용 대조 + 예산 현황 | 예산 · 미산정 모델 | 15분 |
| `provider-validation` | 환경 검증 + Provider 키 | 설정 | 15분 |
| `health-check` | 운영 모니터링 | Provider 장애 | 1시간 |

- 간격은 `OPS_CHECK_*_INTERVAL`로 조정한다. `15m`·`1h`·`30s`·밀리초를 모두
  받는다 — 사람이 쓰는 값이라 단위 없는 숫자만 받으면 반드시 잘못 적는다.
  해석할 수 없으면 기본값으로 돈다(점검이 멈추거나 폭주하는 것보다 안전하다).
- **점검마다 책임지는 경보 종류를 나눴다.** 해소 판정은 "이번에 감지되지
  않았다"로 하는데, 비용 점검이 돌 때 Provider 경보까지 해소해 버리면
  **실제로는 죽어 있는 Provider가 조용히 사라진다**.
- **예약 점검은 Live Check를 하지 않는다** (CTO 결정 1301-①). 예약이 실 키를
  자동 호출하면 과금이 사람 모르게 발생한다. `health-check` 점검은 이미 쌓인
  Execution을 읽을 뿐 새 호출을 만들지 않는다.
- 겹쳐 돌지 않고(이전 실행 미완료 시 건너뜀), 타이머는 `unref()`라 프로세스
  종료를 붙잡지 않는다. **점검 자체가 실패한 것도 이력에 남긴다** — 조용히 안
  도는 점검이 가장 위험하다.

**4~7. Budget / Provider Failure / Unpriced Model / Configuration Alert**

| 종류 | 언제 | 심각도 |
| --- | --- | --- |
| `budget` | 경고 임계 도달 / 예산 초과 | warning / critical |
| `provider-failure` | 성공률 저하 / 사실상 중단 | warning / critical |
| `unpriced-model` | 가격표에 없는 모델 호출 | warning |
| `configuration` | 환경 오류 · Provider 키 문제 | critical |

경보 체계에서 가장 중요한 판단은 **"언제 알리지 않을 것인가"** 다.

- **같은 문제는 한 번만 알린다.** `key`가 같으면 같은 경보로 보고, 쿨다운
  (`ALERT_COOLDOWN_MS`, 기본 30분) 안에서는 다시 알리지 않는다. 같은 내용이
  반복해서 오면 사람이 경보를 무시하기 시작하고, **그 순간 경보 체계는 없는
  것과 같아진다**.
- **심각도가 올라가면** 쿨다운과 무관하게 알린다 — 나빠진 것은 새 정보다.
- **해소도 알린다.** 났다는 사실만 알리고 풀린 것을 알리지 않으면 지금 문제가
  있는지 없는지를 알 수 없다. 해소된 경보는 지우지 않고 `RESOLVED`로 남긴다 —
  언제 났다가 언제 풀렸는지가 사고 분석의 근거다.
- **판정할 수 없으면 경보하지 않는다** — 표본 부족(`unknown`)은 장애가 아니다.
  예산이 무제한이면 예산 경보도 없다(넘을 상한이 없다).
- `unpriced`는 **경보만 하고 호출을 막지 않는다** (CTO 결정 1301-⑤).
- 설정 경보를 둔 이유: 기동 시점 Fail Fast만으로는 **뜬 뒤의 변화**(키 폐기·
  콘솔 오버라이드)를 알 수 없다.

전달은 **로그**(항상) + **웹훅**(`ALERT_WEBHOOK_URL`). 웹훅 실패가 점검을
실패시키지 않는다 — 알림 채널이 죽었다고 감지까지 멈추면 상황이 더 나빠진다.
웹훅 **주소는 API로 노출하지 않는다**(설정 여부만).

**8. CI/CD Deployment Gate** — `scripts/deployment-gate.mjs` (CTO 결정 1202-④).

| exit | 뜻 |
| --- | --- |
| `0` | 배포 가능 |
| `1` | 배포 불가 (차단 항목 존재) |
| `2` | **판정 불가** (API 접근·인증 실패) |

판정할 수 없을 때 0을 돌려주면 게이트가 있으나 마나 하다 — **확인하지 못한
것은 통과가 아니다**(체크리스트의 `manual`, 스모크의 건너뜀 표시와 같은 태도).
`GATE_STRICT=1`은 직접 확인 항목까지, `GATE_ALERTS=1`은 활성 critical 경보까지
차단 사유로 본다.

**구현 중 발견해 고친 표시 결함 2건**

1. 주의 경보만 있을 때 경보 배지가 **"이상 없음"** 인데 바로 아래에 경보를
   나열했다 — **배지와 목록이 정면으로 모순**돼 읽는 사람이 목록을 무시하게
   된다(1202에서 고친 것과 같은 부류). `주의 N건`으로 분리하고 회귀 테스트를
   남겼다.
2. 비용 검증 메시지의 마크다운 강조(`**예산 상한…**`)가 화면에 **평문으로 그대로
   찍혔다**. core에서 강조를 빼고 "메시지에 마크다운을 넣지 않는다"를 테스트로
   고정했다.

### CTO 결정 1301-①~⑤ 반영

| 결정 | 반영 |
| --- | --- |
| ① Live Check는 기본 미실행·운영자 명시 실행 | 현행 유지 확정 + **예약 점검도 Live Check를 하지 않도록** 명시 구현 |
| ② 모니터링 기본값 유지 + 환경변수 조정 | **이번 TASK에서 이행** — `LLM_MONITOR_HEALTHY_RATE`/`DEGRADED_RATE`/`MIN_SAMPLES`/`P95_WARN_MS`. 미설정 시 확정 기본값(0.95/0.5/5/20000). 해석 불가·**순서가 뒤집힌 기준**(degraded>healthy)은 기본값으로 되돌린다 |
| ③ 진단 호출을 운영 통계에서 분리 (Feature 추가 금지) | **이번 TASK에서 이행** — `executions.diagnostic` 메타데이터 한 칸(마이그레이션 26). feature 4종은 그대로. 모니터링에서 제외하되 `diagnosticCalls`로 **숨기지 않고 표시** |
| ④ Cost Verification 수동 유지 + 다음 Sprint Scheduler | **이번 TASK에서 이행** — 수동 실행(`POST /ops/checks/run`)을 그대로 두고 예약 실행을 얹었다 |
| ⑤ Unpriced는 Alert만, 차단 없음 | 그대로 구현 — 경보 문구에 "차단하지 않습니다"를 명시하고 테스트로 고정 |

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 13 | **TASK-1302 — Production Automation & Alerting** | **완료 — 승인 대기** |
| Sprint 13 | TASK-1301 — Real AI Provider Production Integration | 승인 (`6d2bce6`) |
| Sprint 12 | 1201~1202 관리 콘솔·운영 준비 | 전체 승인 · 공식 종료 |
| Sprint 11 | 1101~1102 Sticky·Lifecycle·Analytics | 전체 승인 · 공식 종료 |
| Sprint 10 | 1001~1003 라우팅·Failover·실험 | 전체 승인 · 공식 종료 |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 275 · **경보 17 · 예약 11 · 모니터 기준 5** | 308 | ✅ |
| `apps/api` | Service+API — 기존 290 · **운영 자동화 12** | 302 | ✅ |
| `apps/web` | Playwright e2e — 기존 50 · **경보·진단 분리 4** | 54 | ✅ |
| **합계** | | **664** | **전체 통과** |

신규 테스트가 검증하는 것:

- **core(경보)**: 예산 임계 warning·초과 critical · **무제한이면 경보 없음** ·
  degraded/down 심각도 · **`unknown`은 경보하지 않음** · unpriced만 골라내고
  **"차단하지 않습니다"를 말함** · 환경/Provider 설정 경보 키 분리 ·
  raise/repeat/suppress/resolve 4경로 · **심각도 상승은 쿨다운 무시** ·
  해소 후 재발은 raise · **이미 해소된 경보를 다시 해소하지 않음** ·
  한 번도 안 알린 활성 경보는 쿨다운을 기다리지 않음
- **core(예약)**: `30s`/`15m`/`1h`/ms 해석 · **해석 불가·0·음수는 기본값** ·
  환경변수 조정 · 전체·개별 중단 · **Health Check가 가장 긴 간격** ·
  한 번도 안 돌았으면 실행 · 꺼져 있으면 실행 안 함
- **core(모니터 기준)**: 확정 기본값 · 환경변수 조정 · 해석 불가 복구 ·
  **순서가 뒤집힌 기준은 둘 다 기본값** · 해석된 기준이 실제 판정에 적용
- **core(Execution)**: 일반 호출은 `diagnostic=false` · **진단 호출은 feature를
  바꾸지 않고 `diagnostic=true`만 붙는다**(성공·실패 모두)
- **api**: 비용 점검이 미산정·예산 경보를 만듦 · **설정 점검이 Live Check를
  하지 않음** · Health 점검이 새 호출을 만들지 않음 · **점검마다 자기 종류의
  경보만 해소** · 점검 실패도 이력에 남기고 예외를 던지지 않음 · 쿨다운 억제 ·
  해소 처리 · **웹훅 주소 비노출** · 3종 점검 구성·마지막 결과 · 알 수 없는
  점검 400 · **미인증 401 · EDITOR 403**(조회·실행 모두)
- **웹 e2e**: 활성 경보·예약 점검 구성·전달 채널 안내 · "지금 점검" 실행 후
  결과 반영 · **진단 호출 제외 표시** · **주의 경보만 있을 때 배지가
  "이상 없음"이 아님**(모순 회귀)

라이브 검증 (실 PostgreSQL + s3rver + 실스택, 마이그레이션 26 적용):

- **접근 제어**: `GET /ops/alerts` · `POST /ops/checks/run` 미인증 **401 2/2**
- **예약 점검이 스스로 돌았다**: `OPS_CHECK_COST_INTERVAL=60s`로 기동 →
  미산정 Execution 삽입 후 개입 없이 `trigger=schedule` 실행이
  **미산정 경보를 자동 감지**(`alertsRaised=1`)
- **중복 억제**: 이후 수동 실행 2회는 `alertsRaised=0`, `occurrences`만 3→5로
  누적 (같은 경보를 반복해 알리지 않음)
- **경보 생애주기**: 콘솔에서 일 예산을 0.01로 낮춤 → `raise [critical] 일 예산
  초과` → 99로 복구 → `resolve 해소 — 일 예산 초과`, `resolvedAt` 기록
- **진단 분리 (결정 1301-③)**: 사용자 호출 8건 + Health Check 3건 →
  모니터링 `calls=8`, `diagnosticCalls=3`, 상태 `healthy`
- **배포 게이트 3경로**: 정상 → `exit 0` / s3rver 중단 → 차단 사유 표시 후
  `exit 1` / 잘못된 자격 → **`exit 2`(판정 불가, 통과로 처리하지 않음)**.
  `GATE_ALERTS=1`에서 활성 경보 1건(critical 0)은 통과로 판정
- 브라우저 `/admin/production` 경보 섹션 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 관측 위에 자동화·경보 계층**:

```
                    ┌─ verifyCost ──┐
예약 타이머 ─▶ ScheduledChecks ─┼─ validateProviders ─┼─▶ detect*Alerts (core)
(unref, 겹침 방지)  └─ monitor ─────┘                        │
                                                     reconcileAlerts (core)
                                                             │
                              ┌──────────────────────────────┴─────┐
                        AlertService                          check_runs
                    (alerts 테이블 · kind 단위 해소)          (실행 이력)
                              │
                    ┌─────────┴─────────┐
                  로그(항상)      웹훅(설정 시, 실패해도 점검 계속)

Execution.diagnostic ─▶ Production Monitoring에서 제외 (결정 1301-③)
                     └▶ diagnosticCalls로 표시 (숨기지 않음)
```

① 감지·중복·해소 판정이 전부 **core 순수 로직**이라 타이머와 DB 없이
경계 조건까지 테스트로 고정된다. ② **점검이 자기 종류의 경보만 해소**해서
다른 점검의 문제를 지우지 않는다. ③ **알림 실패가 감지를 멈추지 않는다.**
④ **확인하지 못한 것을 통과로 처리하지 않는다**(게이트 exit 2, 표본 부족
`unknown`, 스모크 건너뜀 표시).

**유지되는 핵심 결정**: Code-first + DB Override(1201-①) · `/admin/*`·`/ops/*`
ADMIN 전용(1201-⑤) · Fail Fast(1202-①) · 스모크/백업 Manual(1202-③) ·
Live Check 수동(1301-①) · Unpriced 비차단(1301-⑤) · feature 4종(0601)

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 26건**,
drift 없음

## 6. 데이터 모델

**마이그레이션 26** (`20260729000000_production_alerting`):

| 대상 | 변경 | 이유 |
| --- | --- | --- |
| `executions` | `diagnostic BOOLEAN NOT NULL DEFAULT false` + 인덱스 | 결정 1301-③ — **feature를 늘리지 않고** 진단 호출을 구분 |
| `alerts` (신규) | kind·**key UNIQUE**·level·status·occurrences·firstRaisedAt/lastRaisedAt/notifiedAt/resolvedAt | `key`가 중복 판정의 축. 해소해도 지우지 않고 `RESOLVED`로 남긴다 |
| `check_runs` (신규) | job·ok·detail·alertsRaised·durationMs·trigger | "언제 마지막으로 확인했는가"의 근거 — **점검 실패도 기록** |

기존 행은 `diagnostic=false`로 채워진다(과거 진단 호출은 소급 구분되지
않는다 — 8항 참고).

## 7. API 표면

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | **`/ops/alerts`** | **경보 현황 (ADMIN)** — 활성·최근 경보, 예약 점검 구성·마지막 결과, 웹훅 설정 여부(주소 비노출) |
| `POST` | **`/ops/checks/run`** | **점검 수동 실행 (ADMIN)** — `?job=`으로 하나만, 없으면 전부 |

- `GET /llm/monitoring` 응답에 **`diagnosticCalls`** 추가 (제외된 진단 호출 수)
- 신규 스크립트: `scripts/deployment-gate.mjs`
- 웹: **`/admin/production`** 상단 "경보" 섹션 (지금 점검 버튼)
- 기존 API 계약 변경 없음

## 8. 리스크·기술 부채

1. **1302 해석 미확인** — 쿨다운·전달 채널·게이트 기본 정책 (CTO_REQUEST #46)
2. **예약 점검은 인스턴스마다 돈다** — 다중 인스턴스에서는 같은 점검이 N번
   실행되고, 경보 중복은 DB의 `key` 유니크로 막히지만 **알림은 경합 조건에서
   중복될 수 있다**. 분산 락은 넣지 않았다(#46 ②)
3. **웹훅은 단일 URL·재시도 없음** — 실패하면 로그만 남는다. 사람이 받았는지
   확인할 방법이 없다(#46 ①)
4. **과거 진단 호출은 소급 구분되지 않는다** — `diagnostic` 컬럼 도입 이전의
   Health Check 이력은 `false`로 남아 관측에 섞인다. 관측 창이 60분 기본이라
   실무 영향은 곧 사라지지만, 장기 조회에는 남는다
5. **쿨다운 30분이 모든 종류에 동일** — 예산 초과는 더 자주, 미산정 모델은 더
   드물게 알리는 편이 나을 수 있다(#46 ①)
6. **경보 상태가 DB에만 있다** — DB가 죽으면 경보 자체가 동작하지 않는다.
   DB 장애는 `/health/ready`와 로그로만 드러난다
7. **실키 스모크·모니터링 기준 조율·백업 자동화** — 기존 부채

## 9. 다음 권장 사항 (Sprint 13 후속 후보)

1. **CTO_REQUEST #46 확인** — TASK-1302 해석 확인 및 다음 지시
2. **다중 인스턴스 예약 조율** — 분산 락 또는 리더 선출(현재는 인스턴스마다
   중복 실행)
3. **운영/스테이징 실키 스모크 + 배포 게이트 파이프라인 연결** — 게이트
   스크립트를 실제 CI 단계에 넣는 것은 인프라 작업이라 코드에는 없다
4. **경보 채널 다양화** — 메일·Slack 등, 재시도·수신 확인
5. **Sprint 13 종료 판단** — 실 Provider 통합(1301)과 운영 자동화(1302)로
   Sprint 목표가 채워졌는지 CTO 판단 요청
