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
| 보고 기준 TASK | **TASK-0501 — LLM Gateway Foundation** (Sprint 5 "AI Execution" 첫 TASK) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `9a5a3e2` |
| Sprint 상태 | Sprint 4 **공식 종료**(0404 승인·Advisory Mode·비저장 확정) → Sprint 5 시작 |
| 구현 중단 상태 | **TASK-0501 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 기본 모델 선택·API 노출 범위 등 → **CTO_REQUEST #16 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 185/185 통과 (core 64 · api 121) — 이번 TASK +17 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — TASK-0501, `9a5a3e2`)

- **LLM Port + Gateway** (@acos/core `llm/`, 프레임워크 무관):
  - `LlmProvider` Port: `name` · `defaultModel` · `complete(messages, model?, maxTokens?)`
  - `LlmGateway`: 요청 검증(빈 메시지·role·공백 content·maxTokens) +
    지수 백오프 재시도(`LLM_MAX_ATTEMPTS`, 기본 3) — OcrExecutionService와 같은 결
  - `MockLlmProvider` (**기본**): 결정적 응답·추정 usage — **실제 API 미호출**
- **Provider 어댑터 3종** (지시 사항 — 공식 SDK 사용, `apps/api/src/llm/providers/`):
  - **OpenAI** (`openai` SDK, 기본 모델 `gpt-4o`)
  - **Anthropic** (`@anthropic-ai/sdk`, 기본 모델 `claude-opus-5`)
  - **Google Gemini** (`@google/genai`, 기본 모델 `gemini-2.5-flash`)
  - 각 어댑터는 provider별 요청 형태 차이(system 분리, role 매핑 등)를 흡수
- **교체 가능 구조** (지시 사항): `LLM_PROVIDER` 환경변수 하나로 선택
  (`mock` 기본) — **API 키 미설정 시 경고 후 mock 폴백**이라 테스트·CI 등
  어떤 환경에서도 실제 호출 없이 기동. 모델은 `LLM_*_MODEL`로 덮어쓰기
- **API**: `GET /llm`(선택된 Provider 확인) · `POST /llm/complete`(200) —
  `LlmService`는 모듈 export되어 향후 소비 모듈의 단일 진입점
- DB 변경 없음(호출 이력 비저장 — 스펙 없음). `.env.example` 갱신
- 문서: docs/architecture/llm.md, README 섹션
- 반영된 Sprint 4 결정: 검사 6종 유지·Advisory Mode·검증 결과 비저장 (코드 변경 불요, 기록 정리)

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1~3 | 기반 전체 — 최종 승인 완료 (상세는 TASKS.md) | — |
| Sprint 4 | Company Brain Integration (0401~0404) — **공식 종료** | `0e028ec`~`817ead4` |
| **TASK-0501** | **LLM Gateway Foundation (Sprint 5)** | **`9a5a3e2`** |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 58 · **LLM(게이트웨이·mock) 6** | 64 | ✅ |
| `apps/api` | Service+API — 기존 110 · **LLM 11** | 121 | ✅ |
| **합계** | | **185** | **전체 통과** |

신규 테스트가 검증하는 것:
- MockLlmProvider: 결정성(동일 입력 → 동일 출력), 마지막 user 반영, model 덮어쓰기
- LlmGateway: 검증 4종(빈 메시지/role/content/maxTokens) 400 매핑,
  **지수 백오프 재시도**(2회 실패 후 성공, 지연 100→200ms 확인), 전체 실패 시 마지막 오류
- **Provider 선택 팩토리**: 기본 mock · 키 없는 실제 Provider 3종 → mock 폴백 ·
  키 있으면 해당 Provider 선택(호출 없이 생성만) · 알 수 없는 이름 → mock
- API: GET /llm, POST /llm/complete 200/400

라이브 검증 (dev 서버):
- `GET /llm` → `{provider: "mock", defaultModel: "mock-llm-1"}` (기본 mock 확인)
- `POST /llm/complete` → mock 완성 텍스트(system 지침 반영) + usage 반환
- model 덮어쓰기, 검증 400 3종 확인 · 실제 외부 API 호출 0건
- 회귀: health / company-brain query / ready-validation / sop-runs / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution의 기반 계층 신설**:

```
소비 모듈 (향후: 콘텐츠 생성·분석 — 스펙 대기)
   └─▶ LlmService ─▶ LlmGateway (@acos/core — 검증·재시도)
                        └─▶ LlmProvider Port
                              ├── Mock (기본 — 실제 API 미호출)
                              ├── OpenAI · Anthropic · Gemini (공식 SDK, 키 필요)
```

① 5번째 Port/Adapter 계층 — 기존 OCR/Analysis/Vision/Content Provider 패턴과
동일한 결로, **모든 LLM 호출이 통과할 단일 게이트웨이**가 생김 (Sprint 5 Goal의 기반).
② 실제 AI API 미연결 원칙 유지 — mock 기본 + 키 없으면 폴백. 실연결은 키 설정만으로 가능.
③ 소비 계층은 의도적으로 미연결 — 기존 mock Generator들의 LLM Gateway 전환은
다음 TASK 스펙 대기 (CTO_REQUEST #16-④).

**유지되는 핵심 결정**: Port/Adapter 도메인 계층 · mock 기본 원칙 · 이력 보존 모델

**현황**: 모노레포(web·api·core/shared/agents/ui), 파이프라인(업로드→OCR→분석→조립→검증(Advisory)→READY→상세페이지 + SOP 실행 + Company Brain Query), 인프라(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 15건, drift 없음

## 6. 데이터 모델

(TASK-0501은 스키마 변경 없음 — LLM 호출 이력 비저장)

```
Project(루트) ──< Product ──< Image ──< OcrResult
      │             └──< AnalysisResult
      ├──< ProductObject · Content · SopRun · Decision · ProjectMemory

Memory (scope Enum 4종)    Knowledge (category Enum 8종)    — Company Brain
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health / 프로젝트 / 업로드 / OCR / 상품 / 분석 | (기존 유지) |
| Product Object / 상세페이지 / SOP 실행 | (기존 유지) |
| Decision / ProjectMemory / Memory / Knowledge | (기존 유지 — Company Brain) |
| Company Brain / READY 검증 | `POST /company-brain/query` · `POST /projects/:id/ready-validation` |
| **LLM Gateway** | **`GET /llm` · `POST /llm/complete`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행)

## 8. 리스크·기술 부채

1. **0501 해석 미확인** — 기본 모델 3종, /llm/complete 공개 범위, 이력·비용 추적 (CTO_REQUEST #16)
2. **실제 Provider 미검증** — 어댑터 3종은 공식 SDK로 구현했으나 API 키가 없어
   실 호출 검증은 미수행 (mock 폴백 경로는 검증 완료). 키 확보 시 스모크 테스트 권장
3. **소비 계층 미연결** — 기존 Analysis/Vision/Content mock이 아직 LLM Gateway를
   쓰지 않음 (전환은 스펙 대기)
4. **인증/권한 없음** — /llm/complete 공개 API (로컬 개발 전제; 실키 설정 시 비용 리스크)
5. 스트리밍·프롬프트 템플릿·호출 이력 미구현 (스펙 없음)

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #16 확인** — 기본 모델 3종, API 노출 범위, 이력·비용 추적 여부
2. **Content Generator의 LLM Gateway 전환** — 상세페이지 생성을 실모델로 바꾸는
   최단 경로 (READY Product Object → LLM 프롬프트 → Markdown). Company Brain
   컨텍스트(query) 주입과 결합하면 Sprint 5 Goal "AI Execution"의 완결 루프
3. **Analysis/Vision의 LLM/멀티모달 전환** — 같은 게이트웨이 구조로 확장
4. **API 키 확보 및 실 Provider 스모크 테스트** — 키 설정만으로 활성화되는 상태
