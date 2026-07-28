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
| 보고 기준 TASK | **TASK-0902 — Cost Governance & Multi-Provider Foundation** (Sprint 9) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `5b39867` |
| 핵심 성과 | 일/월 예산·**초과 시 429 차단**·80% 경고 + Provider Registry + Model Routing + **`/providers` 대시보드** |
| 구현 중단 상태 | **TASK-0902 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 초과 시 차단 정책·라우팅 범위 등 → **CTO_REQUEST #36 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ **362** — core 142(+4) · api 199(+7) · **web e2e 21(+3)** — 전체 통과 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0902 — Cost Governance & Multi-Provider Foundation (`5b39867`)

지시 6항목 전부 이행:

1. **Daily Budget**: `LLM_DAILY_BUDGET_USD` — Execution cost(USD) 합계를
   **UTC 당일** 기준으로 비교 (시계열 표준과 동일 경계)
2. **Monthly Budget**: `LLM_MONTHLY_BUDGET_USD` — UTC 당월 기준.
   두 예산 모두 **미설정 = 무제한**(기존 동작·검사 오버헤드 없음 — mock
   개발 흐름 무영향)
3. **Cost Alert**: 예산의 **80%**(`LLM_BUDGET_ALERT_RATIO` 조정) 도달 시
   경고 — **상태 전이 시 서버 로그**(반복 로그 없음) + 대시보드 배지.
   **초과 시 새 LLM 호출을 429로 차단** — LlmService 단일 관문에서
   호출 전 검사(Execution 미기록 — 검증 오류와 동일 원칙), 예산 상향
   또는 기간 경과로 자동 해제
4. **Provider Registry**: Code-first 중앙 정의(`LLM_PROVIDER_REGISTRY`,
   core) — mock/openai(official)/anthropic·gemini(adapter-ready)의 연결
   상태·기본 모델·키 환경변수. `GET /llm/providers` — **키는 설정 여부만
   노출**(값 비노출)
5. **Model Routing**: feature별 모델 지정 —
   `LLM_MODEL_CONTENT/ANALYSIS/VISION`. 우선순위: **호출자 명시 > 라우팅 >
   Provider 기본**. 현 단계는 선택된 Provider 안의 모델 선택(예: 분석만
   gpt-4o-mini로 비용 절감) — cross-provider 라우팅은 Foundation 다음 단계
6. **Provider Dashboard**: 웹 **`/providers`** 신설 — 일/월 예산 카드
   (진행 바·상태 배지), 선택 Provider·라우팅 표, Provider Registry 표
   (연결 배지·키·선택됨), Provider별 호출 통계(비용 포함).
   **Playwright 3종** 포함(공식 게이트)
- 예산 판정은 core 순수 함수(`evaluateBudgetWindow`), 합산·차단·로깅은
  `LlmBudgetService`(api) — 계층 원칙 유지. 스키마 변경 없음(Execution
  집계 기반)

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 9 | 0901 OpenAI Production | 승인 (상한·잘림·스모크 정책 확정) |
| Sprint 9 | **TASK-0902 — Cost Governance & Multi-Provider Foundation** | **완료 (`5b39867`) — 승인 대기** |
| Sprint 1~8 | Foundation ~ 인증/보안 | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 138 · **예산 판정 4** | 142 | ✅ |
| `apps/api` | Service+API — 기존 192 · **예산 4 + Registry/budget API 2 + 라우팅 1** | 199 | ✅ |
| `apps/web` | Playwright e2e — 기존 18 · **Provider Dashboard 3** | 21 | ✅ |
| **합계** | | **362** | **전체 통과** |

신규 테스트가 검증하는 것:
- core: off(미설정/0)·ok→alert(80%)→exceeded(100%) 판정·임계 조정·UTC 경계
- api: status 계산(일 alert/월 ok) · 미설정 시 **조회 없이 통과** ·
  초과 429 + **LlmService 차단 시 Execution 미기록** · 월 초과 차단·임계
  조정 · GET /llm/providers(Registry 4종·라우팅·키 값 비노출·선택 상태) ·
  GET /llm/budget · Model Routing(라우팅 적용·호출자 우선·기본 폴백)
- 웹 e2e: Registry/라우팅/예산 경고/통계 렌더링 · 예산 미설정 표시 ·
  API 오류 안내

라이브 검증 (실 PostgreSQL + 실스택):
- **초과 차단**: 비용 $20 시드 + 일 예산 $10 재기동 → `/llm/budget`
  daily exceeded(ratio 2) → `POST /llm/complete` **429** + 서버 로그
  "예산 초과 — 새 호출을 차단합니다"
- **경고 상태**: 일 예산 $25 → daily alert(정확히 0.8) · monthly ok
- **Model Routing**: `LLM_MODEL_ANALYSIS=gpt-4o-mini` → 분석 실행 →
  Execution model=**gpt-4o-mini** 기록 확인
- `/llm/providers` 라이브 확인(Registry 4종·키 설정 여부·라우팅) ·
  브라우저에서 `/providers` 전체 렌더링(경고 배지·진행 바 — 스크린샷 첨부)
- **스모크 리허설 10/10 PASS** (회귀 없음) · 시드 데이터 정리 완료

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 비용 통제 계층 + Provider 확장 기반**:

```
LLM 호출 ─▶ LlmService (단일 관문)
              ├─ 출력 상한 주입 (0901) → Model Routing (0902) → 예산 검사 (0902)
              │     예산 초과 → 429 차단 (Execution 미기록)
              └─ Provider 호출 → Execution 기록 (cost) ─┐
   ┌──────────────────────────────────────────────────┘
   └▶ 일/월 cost 합계 (UTC) ─▶ off/ok/alert(80%)/exceeded ─▶ /providers 대시보드
Provider Registry (Code-first): mock · openai(official) · anthropic/gemini(adapter-ready)
```

① 비용 통제가 기록과 같은 단일 관문에 위치 — 우회 경로 없음.
② Registry가 멀티 Provider 확장의 선언적 기준점 — 새 Provider 공식 연결은
Registry+어댑터 팩토리+가격표 3곳 갱신으로 완결. ③ 라우팅으로 feature별
비용 최적화 준비(분석·Vision을 mini 모델로).

**유지되는 핵심 결정**: 단일 관문(LlmService) · Code-first(가격표·Registry) ·
UTC 표준 · 조회 비보호 · Playwright 공식 게이트

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 21건
(이번 TASK 스키마 변경 없음), drift 없음

## 6. 데이터 모델

변경 없음 — 예산은 Execution cost 집계(aggregate) 기반

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Provider | **`GET /llm/providers`** — Registry·라우팅·선택 상태 (키 값 비노출) |
| 예산 | **`GET /llm/budget`** — 일/월 지출·예산·상태 (UTC) |
| 차단 | 모든 LLM 경유 호출 — 예산 초과 시 **429** (message에 해제 방법 안내) |

웹: **`/providers`** (신설 — 홈 내비 "🔌 Provider 현황")

## 8. 리스크·기술 부채

1. **0902 해석 미확인** — 초과 시 차단(429) 정책·80% 기본 임계·라우팅
   범위(Provider 내 모델 선택) (CTO_REQUEST #36)
2. **경고 알림 채널** — 현재 서버 로그 + 대시보드 배지. 이메일/슬랙 등
   외부 알림은 메일 인프라 부재로 미구현 (스펙 대기)
3. **모델 기준 가격표** — 라우팅으로 가격표 등록 모델명을 mock에서 쓰면
   비용이 계산되어 표기됨(개발 데모 시 유의 — mock 기본 모델은 0)
4. **cross-provider 라우팅 미구현** — 현 단계는 LLM_PROVIDER 하나 + 모델
   선택. feature별 Provider 분리는 어댑터 다중 기동 설계 필요
5. **실키 스모크(운영/스테이징 배포 직후)** — 정책 확정됨, 실행 대기

## 9. 다음 권장 사항 (Sprint 9 후속 후보)

1. **CTO_REQUEST #36 확인** — TASK-0902 해석 확인 및 다음 지시
2. **Anthropic/Gemini 공식 연결** — Registry 기반: 구조화 출력 매핑·
   가격표·통합 검증 (OpenAI 패턴 재적용)
3. **cross-provider Model Routing** — feature별 Provider 분리 (Registry
   이미 준비됨)
4. **예산 알림 채널** — 메일/웹훅 (Cost Alert 확장)
5. **Sprint 9 종료 여부 판단** — 실 Provider 운영 준비 완성도 리뷰
