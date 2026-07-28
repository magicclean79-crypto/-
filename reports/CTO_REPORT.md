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
| 보고 기준 TASK | **TASK-1002 — Provider Failover Engine** (Sprint 10) |
| 보고일 | 2026-07-28 |
| 브랜치 | `claude/ai-product-content-os-setup-jb5oai` |
| 핵심 성과 | **실행 중 실패 시 Provider 자동 전환**(우선순위·타임아웃·건강 상태 연동) + Failover 계측 + **이력 Provider 실제 값 기록**(CTO 결정 1001-③ 이행) |
| 구현 중단 상태 | **TASK-1002 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 전환 조건·모델 승계·건강 판정·계측 범위 → **CTO_REQUEST #39 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **409** — core 159(+10) · api 224(+8) · **web e2e 26(+2)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1002 — Provider Failover Engine

지시 5항목 + CTO 결정 1001-③ 전부 이행:

1. **Provider Priority**: `LLM_FAILOVER_PRIORITY`(예: `openai,anthropic,mock`).
   **라우팅이 정한 Provider가 항상 1순위**, 그 뒤에 우선순위 순서를 붙여
   체인을 만든다(중복 제거, 키 미설정 등 사용 불가 Provider 제외).
   **미설정이면 Failover 비활성** — 기존 동작이 그대로 보존된다.
2. **Retry Policy**: 기존 게이트웨이 지수 백오프(`LLM_MAX_ATTEMPTS`)를
   **Provider 안에서 먼저 소진**하고, 그래도 실패할 때만 다음 Provider로
   넘어간다(일시적 오류는 같은 Provider에서 해결하는 것이 비용·지연 모두 유리).
3. **Timeout Policy**: `LLM_TIMEOUT_MS`(기본 120000, `0`=무제한) — 응답이
   오지 않는 Provider에 갇히지 않도록 1회 호출을 제한하고, 초과 시 실패로
   간주해 다음 Provider로 전환한다.
4. **Health Check Integration**: `ProviderHealthTracker` — 연속 실패가
   `LLM_FAILOVER_HEALTH_THRESHOLD`(기본 3)에 닿으면
   `LLM_FAILOVER_HEALTH_COOLDOWN_SEC`(기본 60초) 동안 **체인 뒤로 밀린다**.
   **제외가 아니라 순서 강등**이므로 다른 후보가 모두 실패하면 여전히
   시도한다(가용성 우선). 쿨다운 경과 시 half-open으로 재시도하고 성공하면
   즉시 회복한다. `GET /llm/health?provider=`는 **Failover를 쓰지 않고**
   대상 Provider만 점검하되(진단 목적), 결과는 건강 상태에 반영된다.
5. **Failover Metrics**: `GET /llm/failover` — 우선순위·타임아웃·Provider별
   건강 상태와 `attempts`/`failovers`/`exhausted`/`skipped`·Provider별
   성공·실패 누계. 웹 **`/routing`** 하단에 섹션으로 표시(건강 배지·계측 카드).

**Failover 대상이 아닌 오류** (CTO 지시 준수):

| 오류 | 처리 | 근거 |
| --- | --- | --- |
| **예산 초과 (429)** | 즉시 실패, 호출 시도 자체가 없음(Execution 미기록) | Provider를 바꿔도 결과가 같다 — `markNoFailover()`로 명시 |
| **요청 검증 오류 (400)** | 즉시 실패, Execution 미기록 | 요청 자체가 잘못됨 — 재시도·전환 모두 무의미 |

둘 다 계측의 `skipped`로 집계해 "전환하지 않고 끝난 호출"을 구분한다.

**모델 승계 규칙**: 2순위부터는 **호출자가 지정한 모델을 버리고** 각
Provider의 기본 모델로 호출한다. 모델명은 Provider 간 호환되지 않으므로
(`gpt-4o`를 anthropic에 넘기면 확정 실패) 그대로 승계하면 Failover가
무의미해진다.

### CTO 결정 1001-③ — 이력 Provider 필드 정합

`AnalysisRecognition`에 `providerName`을 신설하고, 인식 Provider가 실제
호출된 Provider(`llm:<provider>`)를 반환하도록 했다. 이력 저장 시 이 값이
있으면 `AnalysisRun.provider`에 기록된다(없으면 기존 정적 값 — 하위 호환).
`VisionSummary.source`도 동일하게 실제 Provider를 기록한다. 이로써
**이력 Provider 필드와 Execution의 `provider`가 같은 의미**를 갖는다.

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 10 | **TASK-1002 — Provider Failover Engine** | **완료 — 승인 대기** |
| Sprint 10 | TASK-1001 — Cross-Provider Routing Engine | 승인 (`03dca0f`) |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 149 · **Failover 순수 로직 10** | 159 | ✅ |
| `apps/api` | Service+API — 기존 216 · **Failover 엔진 8** | 224 | ✅ |
| `apps/web` | Playwright e2e — 기존 24 · **Failover 대시보드 2** | 26 | ✅ |
| **합계** | | **409** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core**: 전환 대상 판별(검증 오류·`NO_FAILOVER` 표시는 제외) · 타임아웃
  래퍼(정상 통과/초과 시 오류) · 체인 구성(1순위 고정·중복 제거·사용 불가
  제외·불건강 후순위) · 건강 추적기(임계 도달·쿨다운 경과 half-open·성공 회복·
  스냅샷)
- **api**: 1순위 실패 → 다음 Provider 성공 + **각 시도가 Execution에 기록** ·
  우선순위 미설정 시 전환 없음(기존 동작) · **타임아웃 전환** ·
  **예산 초과는 전환 없음·호출 시도 0·Execution 0** · **검증 오류는 전환
  없음(400)** · 체인 소진 시 마지막 오류로 실패 · 건강 상태에 따른 체인 재정렬 ·
  health 점검은 Failover 미사용
- **웹 e2e**: 우선순위 체인·타임아웃·재시도 표기, 계측 4종, Provider 건강
  배지(건강/불건강)·성공/실패 누계 · 우선순위 미설정 시 "Failover 비활성"

라이브 검증 (실 PostgreSQL + 실스택, `LLM_ROUTE_ANALYSIS=openai`(무효 키) +
`LLM_FAILOVER_PRIORITY=anthropic,mock` + `LLM_TIMEOUT_MS=8000` +
`LLM_FAILOVER_HEALTH_THRESHOLD=2`):

- **실제 전환 성공**: 상품 분석 실행 → openai 실패(403 차단) → **mock으로
  전환해 SUCCESS**. Execution에 `product-analysis/openai/FAILED`와
  `product-analysis/mock/SUCCESS`가 **두 건 모두** 기록됨
- **이력 Provider 정합(결정 ③)**: 같은 실행의 `AnalysisRun.provider`가
  **`llm:mock`** — 정적 기본값이 아니라 실제 전환된 Provider
- **건강 상태 전이**: 2회 연속 실패 → openai `불건강`(연속 실패 2, 쿨다운
  시각 표기) → **다음 호출에서 체인 뒤로 밀려 openai 호출 없이 mock 성공**
  (계측 `attempts` +1만 증가)
- **진단 경로**: `GET /llm/health?provider=openai` → `provider=openai`,
  `status=error` — anthropic으로 넘어가지 않음
- 브라우저 `/routing` 하단 Failover 섹션 렌더링 확인 (스크린샷 첨부)

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 단일 관문에 전환 계층 추가**:

```
호출(feature) ─▶ LlmService (단일 관문)
                   ├─ 예산 검사 ─────────────▶ 초과 시 429 (markNoFailover, 전환 없음)
                   ├─ resolveRoute(1001)  ─▶ 1순위 Provider
                   ├─ buildFailoverChain(core 순수 로직)
                   │     [1순위] + 우선순위(중복 제거·사용 불가 제외·불건강 후순위)
                   └─ for 체인:
                        withTimeout(gateway.complete)   ※ 게이트웨이 재시도 소진 후
                          ├─ 성공 ─▶ health.recordSuccess · Execution SUCCESS · 반환
                          └─ 실패 ─▶ health.recordFailure · Execution FAILED
                                      ├─ 전환 제외 대상? ─▶ 즉시 throw (skipped)
                                      └─ 다음 후보 있으면 전환 (failovers) / 없으면 exhausted
```

① 전환 판단이 **core 순수 로직**(`buildFailoverChain`·`isFailoverEligible`·
`ProviderHealthTracker`)으로 분리돼 단위 테스트로 고정된다. ② 전환이
Execution 기록과 **같은 관문 안**에서 일어나므로 실패한 시도까지 빠짐없이
관측된다 — 대시보드의 경로별 성공률이 실제 전환 이력을 그대로 보여준다.
③ 라우팅(설정 시점 폴백)과 Failover(실행 시점 전환)가 코드상으로도
분리돼 CTO 결정 1001-②의 구분이 구조에 반영됐다. ④ 이력 Provider가 실제
호출 Provider가 되면서 **분석 이력과 Execution을 같은 기준으로 대조** 가능.

**유지되는 핵심 결정**: 단일 관문 · Code-first 설정 · 환경변수 미설정 시
기존 동작 보존 · 잘림/예산 정책 · Anthropic JSON 방식(0903 승인 ①) ·
가격표는 운영 모델만(0903 승인 ②) · Routing 단위 feature 3종(1001 승인 ①)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

스키마 변경 없음. `AnalysisRun.provider`에 **기록되는 값의 의미**가 바뀌었다
— 기동 시점 기본 Provider가 아니라 **실제 호출된 Provider**(CTO 결정 1001-③).
과거 이력은 그대로 두었다(소급 변경 없음).

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Failover | **`GET /llm/failover`** — 활성 여부·우선순위·타임아웃·Provider 건강 상태·계측 |
| 상태 점검 | `GET /llm/health` — **`?provider=` 추가**(특정 Provider 점검, Failover 미사용) |
| 그 외 | 변경 없음 (호출 계약 동일 — Failover는 내부 동작) |

웹: **`/routing`** 하단에 **Provider Failover** 섹션 추가

## 8. 리스크·기술 부채

1. **1002 해석 미확인** — 전환 조건·모델 승계·건강 판정·계측 범위
   (CTO_REQUEST #39)
2. **계측은 인메모리·프로세스 단위** — 재기동 시 초기화되고 다중 인스턴스
   합산이 안 된다(건강 상태도 동일). 영속 계측이 필요하면 Execution을
   원천으로 집계하는 방식이 대안 (Rate Limit 인메모리와 같은 성격의 부채)
3. **건강 상태는 인스턴스별로 학습** — 다중 인스턴스에서는 각자 따로
   불건강을 감지한다(공유 필요 시 Redis)
4. **전환 시 비용 이중 발생** — 1순위가 토큰을 소비하고 실패하면 그 비용도
   Execution에 남는다(정상 동작이나, 예산 소진 속도가 빨라질 수 있음)
5. **`/llm/health` 점검도 계측에 포함** — 진단 호출이 `attempts`·`exhausted`를
   증가시킨다. 단일 관문 일관성을 택했으나 분리 여부는 #39에 질문으로 올림
6. **실키 스모크(운영/스테이징)·Rate Limit 인메모리** — 기존 부채 유지

## 9. 다음 권장 사항 (Sprint 10 후속 후보)

1. **CTO_REQUEST #39 확인** — TASK-1002 해석 확인 및 다음 지시
2. **Failover 알림** — 전환 발생·체인 소진 시 운영 알림(현재는 로그·대시보드만)
3. **라우팅 A/B·비율 분배** — 동일 feature를 두 Provider에 나눠 품질·비용 비교
4. **Provider 설정 ADMIN 화면** — 라우팅·우선순위·예산의 화면 관리
   (현재 전부 환경변수 Code-first)
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)
