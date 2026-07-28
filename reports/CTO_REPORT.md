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
| 보고 기준 TASK | **TASK-0601 — Execution Domain** (Sprint 6 첫 TASK) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `fcbf6ce` |
| 핵심 성과 | **모든 LLM 호출이 관측 가능해짐** — 호출 1건당 Execution 1건 (Provider/Model/Token/Cost/Latency/Status), 기록 지점 단일화 |
| 구현 중단 상태 | **TASK-0601 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 실모델 가격표·feature 범위 등 → **CTO_REQUEST #22 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 246/246 통과 (core 109 · api 137) — 이번 주기 +15 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### Sprint 5 종료 반영

- CTO 결정: TASK-0506 승인 (Wrapper 구조·CONTENT_GENERATOR 제거 유지,
  Deprecated Generator는 **Sprint 6 이후 제거 검토 대상**으로 유지),
  **Sprint 5 공식 종료** — TASKS.md에 기록

### TASK-0601 — Execution Domain (`fcbf6ce`)

- **Execution 모델 신설** (`executions` 테이블 + `ExecutionStatus` enum):
  feature · provider · model · inputTokens/outputTokens · **cost(Decimal, USD)** ·
  latencyMs · status(SUCCESS/FAILED) · error · createdAt,
  인덱스 (feature, createdAt) — 마이그레이션 1건(신규 테이블, 기존 데이터
  무영향), drift 없음
- **모든 LLM 호출이 Execution 생성** (지시 사항): 기록 지점을 모든 호출의
  유일한 통로인 `LlmService.complete(request, { feature })`로 단일화 —
  - Content: `content-generation` (공식 경로·구 Wrapper 경로·SOP 전부 포함)
  - Analysis: `product-analysis` / Vision: `vision-analysis`
  - 개발용 `POST /llm/complete`: `dev`
- **`ExecutionTracker`** (@acos/core, 프레임워크 무관): 호출을 감싸 지연을
  측정하고, 성공 시 실제 응답의 provider/model/usage/비용을, 실패 시 폴백
  provider/model + 오류를 기록 후 원래 오류를 그대로 전파.
  **기록 실패는 호출을 실패시키지 않는다**(가용성 우선, 경고 로그).
  검증 오류(400)는 호출 시도가 아니므로 기록하지 않음
- **비용 계산**: 코드 선언 가격표(`estimateLlmCost`, USD/1M 토큰) — mock 0,
  **가격표에 없는 모델은 null 기록** (임의 단가를 만들어 기록하지 않음 —
  실모델 공식 단가는 #22로 스펙 요청)
- **조회 API**: `GET /executions?feature=&limit=` (읽기 전용, 최신순) —
  기록용 쓰기 API는 없음
- 문서: docs/architecture/execution.md 신설, llm.md(0501의 "호출 이력 비저장"
  경계를 Execution 관측으로 갱신)/README 반영

### 누적 완료 TASK

| Sprint | TASK | 상태 |
| --- | --- | --- |
| Sprint 6 | **TASK-0601 — Execution Domain** | **완료 (`fcbf6ce`) — 승인 대기** |
| Sprint 5 | 0501~0506 (LLM Gateway → Legacy 통합) | 전체 승인 · **공식 종료** |
| Sprint 1~4 | Foundation ~ Company Brain Integration | 전체 승인 · 공식 종료 |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 102 · **Execution 7** (Tracker 3 · 비용 계산 4) | 109 | ✅ |
| `apps/api` | Service+API — 기존 129 · **LlmService 기록 5 + Execution API 3** | 137 | ✅ |
| **합계** | | **246** | **전체 통과** |

신규 테스트가 검증하는 것:
- Tracker: 성공 시 SUCCESS(usage/cost/latency, 가짜 시계), 실패 시 FAILED
  (폴백+오류) 후 원래 오류 전파, **저장소 장애 시에도 호출 성공 유지**
- 비용: mock 0 · 미등록 모델 null · 사용량 미상 null · 가격표 단가 계산
- LlmService: feature 태깅(미지정 시 dev), FAILED 기록, 검증 오류 비기록,
  저장소 미주입(단독 구성) 동작
- Execution API: 최신순 목록(cost 숫자/null 직렬화), feature 필터, limit 400

라이브 검증 (실 PostgreSQL — 마이그레이션 적용 후):
- 5개 경로 호출(공식 생성·구 경로·분석·조립(Vision)·/llm/complete) →
  `GET /executions`에 **feature별로 정확히 기록** (mock, cost 0, token·latency 포함)
- 구 Wrapper 경로도 content-generation으로 집계됨 (생성 코어 단일화 효과)
- `?feature=vision-analysis` 필터 정상, drift 체크 empty

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution에 관측 계층 추가**:

```
Content Generation ─┐                        ┌─▶ Execution (기록: feature/model/
Analysis ───────────┼─▶ LlmService.complete ─┤    token/cost/latency/status)
Vision ─────────────┤   (유일한 LLM 통로)     └─▶ LLM Gateway → Provider
POST /llm/complete ─┘
```

① 0501 승인 시 예고된 "LLM 호출 이력·비용의 별도 Execution 도메인"이 구현됨 —
모든 호출이 이미 LlmService 한 지점을 지나도록 Sprint 5에서 수렴시켜 두었기에
**기록 지점이 정확히 한 곳**. ② 관측은 부수 기능이라는 원칙: 기록 실패가
호출을 막지 않고, 요청/응답 본문은 저장하지 않음(비용·성능 지표만).
③ 새 AI 기능 합류 규칙 확장: 템플릿 등록 + `feature` 태그 지정.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증

**현황**: 모노레포(web·api·core/shared/agents/ui), **마이그레이션 16건**(+1), drift 없음

## 6. 데이터 모델

```
Project ──< Product ──< AnalysisResult
        ──< ProductObject ──▶ Content
        ──< SopRun · Decision · ProjectMemory
Memory · Knowledge — Company Brain
Execution — LLM 호출 관측 (독립 테이블, FK 없음 — 호출 1건당 1레코드)  ← 신설
```

Execution 필드: feature/provider/model/inputTokens/outputTokens/
cost(Decimal 12,6)/latencyMs/status/error/createdAt

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| **Execution** | **`GET /executions?feature=&limit=`** (조회 전용) |
| LLM Gateway | `GET /llm` · `POST /llm/complete` (개발용 — 이제 feature "dev"로 기록됨) |

웹: 변경 없음 (Execution 화면은 스펙 없음 — API만 제공)

## 8. 리스크·기술 부채

1. **0601 해석 미확인** — 가격표 코드 선언·미등록 모델 cost null·feature 4종
   범위 (CTO_REQUEST #22)
2. **실모델 단가 미확정** — 실제 Provider 모델의 공식 단가 스펙이 없어
   실모델 호출 시 cost가 null로 기록됨 (단가 확정 즉시 가격표 1곳에 추가)
3. **재시도 세분 미기록** — LlmGateway 내부 재시도는 1건으로 집계 (attempts
   세분 기록은 스펙 없음)
4. **집계/대시보드 부재** — 원시 이력 조회만 제공 (기간별 비용 합계 등은 후속)
5. **실모델 연결 준비 항목** — 이미지 용량 가드(CTO 결정: 실연결 전)·구조화
   출력 매핑·스모크 테스트 — 이전 보고와 동일

## 9. 다음 권장 사항 (Sprint 6 후속 후보)

1. **CTO_REQUEST #22 확인** — TASK-0601 해석 확인 및 다음 지시
2. **실모델 단가 스펙 확정** — 가격표 등록으로 실모델 cost 기록 활성화
3. **Execution 집계 API/화면** — 기간·기능별 토큰/비용 합계 (운영 가시성)
4. **실모델 연결 준비 TASK** — 이미지 용량 가드 + 구조화 출력 매핑 + 스모크
   테스트 묶음 (API 키 확보 필요, CTO_REQUEST #6)
5. **Deprecated Generator 제거 검토** — CTO 결정대로 Sprint 6 이후 검토 대상
