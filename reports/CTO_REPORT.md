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
| 보고 기준 TASK | **TASK-1001 — Cross-Provider Routing Engine** (Sprint 10) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `03dca0f` |
| 핵심 성과 | **feature별 Provider 분리 라우팅**(동적 해석·폴백) + Routing Dashboard + Routing Metrics |
| 구현 중단 상태 | **TASK-1001 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 라우팅 단위·폴백 정책·이력 provider 표기 → **CTO_REQUEST #38 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **389** — core 149(+7) · api 216(+6) · **web e2e 24(+3)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-1001 — Cross-Provider Routing Engine (`03dca0f`)

지시 4항목 전부 이행 (**Provider Failover는 지시대로 범위 제외**):

1. **Feature별 Provider Mapping**: `LLM_ROUTE_CONTENT` /
   `LLM_ROUTE_ANALYSIS` / `LLM_ROUTE_VISION` — 값은 `provider` 또는
   `provider:model`. 0902의 "Provider 내부 모델 선택"에서 **Provider 자체를
   feature별로 분리**하는 단계로 확장(0902 승인 ②의 후속)
2. **Dynamic Routing**: **호출 시점마다 환경을 해석** — 라우팅 변경이
   재기동 없이 다음 호출부터 반영된다. 매핑된 Provider를 쓸 수 없으면
   (키 미설정) **기본 Provider로 내려가고 경고 로그**(`source: "fallback"`)
   — 호출을 실패시키지 않는 설정 해석 시점의 폴백이며, **호출 실패 시
   전환(Failover)은 범위 밖**(CTO 지시)
   - 우선순위: 호출자 `model` 명시 > 규칙의 `:model` > `LLM_MODEL_*`
     (**같은 Provider일 때만** — 타 Provider 모델명 오적용 방지) >
     Provider 기본 모델. `dev`(개발용 호출·health)는 항상 기본 Provider
3. **Routing Dashboard**: `GET /llm/routing` + 웹 **`/routing`** 신설 —
   feature별 Provider·모델과 **결정 근거 배지**(Feature 매핑 / 기본
   Provider / 폴백 + 사유), 지정 환경변수명, 사용 가능 Provider 목록
4. **Routing Metrics**: `GET /executions/stats`에 **`byRoute`** 추가 —
   실제 실행된 경로(`feature→provider`)별 호출·성공률·평균 지연·토큰·비용.
   기존 통계와 동일 스키마·필터를 그대로 사용
- **Provider 인스턴스 맵**(`createLlmProviderMap`): 키가 설정된 Provider를
  전부 준비해 두고, `LlmService`(Execution 기록과 같은 단일 관문)가 경로별
  게이트웨이를 고른다. Provider 맵이 없으면 단일 Provider로 동작(하위 호환)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 10 | **TASK-1001 — Cross-Provider Routing Engine** | **완료 (`03dca0f`) — 승인 대기** |
| Sprint 9 | 0901~0903 실 Provider 연결·비용 거버넌스 | 전체 승인 · 공식 종료 |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 142 · **라우팅 해석 7** | 149 | ✅ |
| `apps/api` | Service+API — 기존 210 · **라우팅 엔진 6**(기존 stats 스펙 1건 갱신) | 216 | ✅ |
| `apps/web` | Playwright e2e — 기존 21 · **Routing Dashboard 3** | 24 | ✅ |
| **합계** | | **389** | **전체 통과** |

신규 테스트가 검증하는 것:
- **core**: 규칙 파싱(`provider` / `provider:model` / 불량 값) · 매핑 적용 ·
  **타 Provider 라우팅 시 모델 오버라이드 무시** · 사용 불가 → 폴백+사유 ·
  feature 미지정(dev) · 라우팅 표 3종
- **api**: feature별 실제 Provider 호출 + **Execution에 경로 기록** ·
  **Dynamic**(같은 인스턴스에서 환경 변경 → 다음 호출부터 반영) ·
  폴백 시 호출 성공(실패 아님) · 호출자 model 우선 · `/llm/routing` 원천
  (결정 근거·환경변수명) · Provider 맵 없을 때 하위 호환
- **웹 e2e**: 매핑·배지 3종·폴백 사유·경로 메트릭 렌더링 · 매핑 없음 상태 ·
  API 오류 안내

라이브 검증 (실 PostgreSQL + 실스택):
- `LLM_ROUTE_ANALYSIS=anthropic`(키 설정) + `LLM_ROUTE_VISION=gemini`(키 없음)
  재기동 → `/llm/routing`이 각각 **feature / fallback(사유 포함)** 으로 해석
- **실제 호출 경로 확인**: 분석 실행 → Execution
  `product-analysis → anthropic / claude-opus-5`(무효 키라 FAILED — 라우팅은
  정상 동작) · Vision 조립 → `vision-analysis → mock`(폴백, SUCCESS)
- **Routing Metrics**: `byRoute`에 `product-analysis→anthropic`,
  `vision-analysis→mock` 등 7개 경로 집계 · 브라우저 `/routing` 렌더링 확인
  (스크린샷 첨부)
- 기본 모드 복귀 후 `/llm/routing` 전부 `default` · **스모크 10/10 PASS**

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — feature별 Provider 분리**:

```
호출(feature) ─▶ LlmService (단일 관문)
                   ├─ resolveRoute(core 순수 로직, 호출 시점 해석)
                   │     rules(LLM_ROUTE_*) → 사용 가능? → feature / fallback / default
                   ├─ gateways[route.provider] 선택   ※ createLlmProviderMap: 키 있는 Provider 전부
                   └─ Execution 기록(feature, provider, model)
                          └─▶ byRoute 집계 ─▶ /routing 대시보드(매핑 + 경로 메트릭)
```

① 라우팅 해석이 **순수 로직(core)** 으로 분리돼 조합 규칙이 단위 테스트로
고정됨. ② 선택 지점이 Execution 기록 지점과 동일 — **설정과 실제 실행이
같은 데이터로 대조** 가능(대시보드의 매핑 표 ↔ 경로 메트릭). ③ 폴백은
"설정 해석 시점"으로 한정 — Failover와 명확히 구분(CTO 범위 지시 준수).

**유지되는 핵심 결정**: 단일 관문 · Code-first 설정 · 잘림/예산 정책 ·
Anthropic JSON 방식(0903 승인 ①) · 가격표는 운영 모델만(0903 승인 ②)

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음 — Execution의 기존 `feature`/`provider` 조합을 경로로 집계

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 라우팅 | **`GET /llm/routing`** — 기본/사용 가능 Provider + feature별 결정(근거·환경변수명) |
| 메트릭 | `GET /executions/stats` — **`byRoute`** 추가 (`feature→provider`) |
| 그 외 | 변경 없음 (호출 계약 동일 — 라우팅은 내부 동작) |

웹: **`/routing`** (신설 — 홈 내비 "🔀 Routing 현황")

## 8. 리스크·기술 부채

1. **1001 해석 미확인** — 라우팅 단위(feature 3종)·폴백 정책·모델
   오버라이드 규칙 (CTO_REQUEST #38)
2. **분석/Vision 이력의 `provider` 표기** — `AnalysisRun.provider`는
   기동 시점 기본 Provider 이름(`llm:mock`)으로 고정돼, 라우팅으로 실제
   호출된 Provider와 다를 수 있다. **Execution에는 실제 경로가 정확히
   기록**되므로 운영 관측에는 영향 없으나, 이력 필드 의미 변경은 CTO
   결정 사항이라 #38에 질문으로 올림
3. **Provider Failover 미구현** — 이번 지시로 범위 제외 (호출 실패 시
   대체 Provider 전환)
4. **라우팅 설정은 환경변수 전용** — ADMIN 화면 관리·A/B 비율 라우팅은
   스펙 대기
5. **실키 스모크(운영/스테이징)·Rate Limit 인메모리** — 기존 부채 유지

## 9. 다음 권장 사항 (Sprint 10 후속 후보)

1. **CTO_REQUEST #38 확인** — TASK-1001 해석 확인 및 다음 지시
2. **Provider Failover** — 호출 실패/rate limit 시 대체 Provider 전환
   (라우팅 엔진에 정책 계층 추가)
3. **분석/Vision 이력 provider 정합** — 실제 라우팅 Provider 반영 여부 결정
4. **라우팅 A/B·비율 분배** — 동일 feature를 두 Provider에 나눠 품질·비용 비교
5. **운영/스테이징 실키 스모크** — 3사 각 1회 (0901 승인 ③ 정책)
