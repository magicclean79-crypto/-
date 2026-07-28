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
| 보고 기준 TASK | **TASK-0504 — Analysis Engine Integration** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `74e9fbb` |
| 핵심 성과 | Mock 분석을 **LLM 기반 공식 엔진으로 교체** — Prompt Engine·LLM Gateway·Company Brain 3계층을 사용하는 두 번째 AI 기능 완성(공용 설계 검증) |
| 구현 중단 상태 | **TASK-0504 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | mock LLM 초안 설계·responseFormat 추가 등 → **CTO_REQUEST #19 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 215/215 통과 (core 87 · api 128) — 이번 주기 +16 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0504 — Analysis Engine Integration (`74e9fbb`)

- **공식 분석 엔진 = `LlmAnalysisProvider`** (@acos/core, 구 MockAnalysisProvider 제거).
  CTO 지시대로 세 계층을 사용:
  - ① **Prompt Engine**: 신규 `product-analysis` 템플릿 렌더링 — 상품/OCR/
    Company Brain 컨텍스트 + **규칙 기반 초안 JSON**(OCR 첫 줄→이름)을 담아
    "검증·보강 후 최종 JSON만 출력"을 지시
  - ② **LLM Gateway**: `responseFormat: "json"`으로 호출 — 모델 선택은
    `LLM_PROVIDER` 하나로 일원화 (구 `ANALYSIS_PROVIDER` 환경 변수 제거)
  - ③ **Company Brain**: 상품 이름 질의·PROJECT 스코프 조회(0502 결정과 동일
    기준) — 지식/결정/설정이 프롬프트에 반영되고 rawJson에 요약 기록
- **응답 엄격 파싱**: JSON 미발견·name 누락 시 오류 → 지수 백오프 재시도 →
  FAILED 기록. 나머지 필드는 타입 보정(confidence 0~1 클램프 등)
- **오프라인 결정성 유지**: `LlmRequest.responseFormat`("text"|"json") 추가 —
  mock LLM은 json 모드에서 프롬프트의 마지막 ```json 블록(=초안)을 그대로
  반환. 키 없는 환경에서도 전체 파이프라인(Company Brain→렌더링→Gateway→파싱)이
  결정적으로 동작
- **유지된 것 (CTO 지시)**: AnalysisResult 모델·분석 API 3종·1:N 이력·재시도
  구조 변경 없음. 구 mock 이력(provider "mock")은 보존되고 새 실행은
  `llm:<provider>`(예: llm:mock)로 기록
- DB 변경 없음. 문서: analysis.md 재작성, prompt.md/llm.md/README/.env.example 갱신

### 누적 완료 TASK (Sprint 5)

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| TASK-0501 | LLM Gateway Foundation — 승인 | `9a5a3e2` |
| TASK-0502 | Content Generation Engine — 승인·공식 엔진 확정 | `e147aef` |
| TASK-0503 | Prompt Engine — 승인 (Code-first·버전 관리 없음 확정) | `9f44b87` |
| **TASK-0504** | **Analysis Engine Integration** | **`74e9fbb`** |

(Sprint 1~4는 최종 승인·공식 종료 — 상세는 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 72 · **분석 15 신규/개편** (LlmAnalysisProvider 5 · 초안/파서/템플릿 11 · mock LLM json 2, 구 mock provider 3 대체) | 87 | ✅ |
| `apps/api` | Service+API — 기존 127 · **Company Brain 로드 1 추가** (분석·프롬프트 스펙 신 엔진 기준 개편) | 128 | ✅ |
| **합계** | | **215** | **전체 통과** |

신규·개편 테스트가 검증하는 것:
- LlmAnalysisProvider: mock LLM 경로 성공(이름 `llm:mock`), Company Brain
  로드·raw 반영, 파싱 불가 응답 reject → ExecutionService FAILED 기록
- 초안/파서: OCR 첫 줄 규칙, 코드 펜스·해설 혼합 응답 파싱, name 누락 오류,
  필드 보정·클램프, attributes 문자열 변환
- 템플릿: 기본 엔진 등록, 상품/OCR/지식/결정/설정 반영, 초안 JSON 포함,
  결정적 렌더링
- mock LLM: json 모드에서 마지막 json 블록 반환 / 블록 없으면 "{}"

라이브 검증 (실 PostgreSQL + mock LLM):
- `POST /products/:id/analysis` → SUCCESS, provider `llm:mock`, rawJson에
  llm 모델·응답 텍스트·companyBrain 카운트 기록
- Knowledge(BRAND) 등록 후 재실행 → **knowledgeCount 1로 컨텍스트 반영 확인**
- 이력 조회 → 구 `mock` 레코드와 새 `llm:mock` 레코드 공존 (이력 보존)
- 회귀: `GET /prompt/templates` 2건 노출 · 상세페이지 생성 201 · /llm/complete 200

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution 공용 설계의 두 번째 소비자**:

```
AI 기능
 ├─ Content Generation (0502) ─┐
 └─ Analysis (0504) ← 교체 완료 ┤→ Prompt Engine (0503) : 템플릿 렌더링
                               ├→ LLM Gateway (0501)   : responseFormat "json" 지원 ← 확장
                               └→ Company Brain (S4)   : 컨텍스트 원천
```

① CTO가 예고한 "모든 AI 기능은 같은 엔진" 설계가 **두 기능에서 실증**됨 —
Analysis는 템플릿 1개 + Provider 1개 추가로 합류. ② 구조화 출력 계약 수립:
초안 JSON 포함 프롬프트 + 엄격 파서 + mock 초안 에코 — 향후 Vision 등
구조화 AI 기능의 표준 패턴. ③ 분석 모델 선택이 LLM Gateway로 일원화
(`ANALYSIS_PROVIDER` 제거) — Provider 교체 지점이 한 곳으로 줄어듦.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 15건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0504는 스키마 변경 없음 — AnalysisResult 모델 유지, CTO 지시)

```
Project ──< Product ──< AnalysisResult (provider "llm:<llm>" — 구 "mock" 이력 보존)
        ──< ProductObject (READY) ──▶ Content
        ──< SopRun · Decision · ProjectMemory
Memory · Knowledge — Company Brain (생성·분석 공용 컨텍스트 원천)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| AI 분석 | `POST /products/:id/analysis` (apply 옵션) · `GET …/analysis` · `GET …/analysis/history` — **경로·계약 변경 없음, 내부 엔진만 교체** |
| 상세페이지 생성 | `POST /projects/:id/contents/generate` (공식) · `POST …/contents` (⚠️ Deprecated) |
| LLM Gateway | `GET /llm` · `POST /llm/complete` (개발용, responseFormat 지원) |
| Prompt Engine | `GET /prompt/templates` — `content-generation` · **`product-analysis`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인) — 변경 없음

## 8. 리스크·기술 부채

1. **0504 해석 미확인** — 초안 에코 설계·responseFormat 추가·ANALYSIS_PROVIDER
   제거 등 (CTO_REQUEST #19)
2. **실모델 구조화 출력 미매핑** — 실제 어댑터 3종은 responseFormat을 프롬프트
   지침으로만 강제 (Provider별 json_schema 옵션 매핑은 실연결 시)
3. **이미지(Vision) 입력 미사용** — 분석은 OCR 텍스트 기반. `getBytes()` 로더는
   준비되어 있으나 멀티모달 프롬프트는 스펙 없음
4. **구 mock 경로 통합 대기** — 상세페이지 구 경로 Deprecated 상태 유지 (CTO 지시)
5. **생성물 사후 검증 부재 · 인증/권한 없음** — 이전 보고와 동일

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #19 확인** — TASK-0504 해석 확인 및 다음 지시
2. **구 mock Generator 내부 통합** — CTO 예고 사항: POST /contents가 내부적으로
   공식 엔진 호출
3. **Vision 멀티모달 분석** — 이미지 바이트를 LLM에 전달하는 템플릿/게이트웨이
   확장 (구조화 출력 패턴 재사용)
4. **실모델 스모크 테스트** — API 키 확보 시 responseFormat 매핑 + 소량 검증
5. **Execution 도메인** — LLM 호출 이력·비용 (CTO 결정 사항의 후속 스펙)
