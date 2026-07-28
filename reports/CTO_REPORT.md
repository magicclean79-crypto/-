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
| 보고 기준 TASK | **TASK-0503 — Prompt Engine** (+ TASK-0502 승인 결정 사항 반영) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `9f44b87` |
| 핵심 성과 | 프롬프트가 **독립 계층**으로 분리 — 모든 AI 기능이 같은 엔진으로 프롬프트를 만드는 구조 확립. 웹 버튼 공식 엔진 전환 완료 |
| 구현 중단 상태 | **TASK-0503 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 템플릿 관리 방식 등 → **CTO_REQUEST #18 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 199/199 통과 (core 72 · api 127) — 이번 주기 +4 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0502 승인 결정 반영 (`9f44b87`에 포함)

- **웹 상세페이지 생성 버튼 → 공식 엔진 전환**: `/projects/[id]` 파이프라인 버튼이
  `POST …/contents/generate`를 호출 — **브라우저 클릭 테스트(Playwright)로
  엔진 경로 호출·Content 저장 확인**
- **구 Mock Generator 경로 Deprecated 표시**: 컨트롤러 라우트·서비스·
  ContentGenerator Port에 `@deprecated` 주석 + README/문서 명시
  (제거·내부 통합은 CTO 지시대로 다음 Sprint)
- Company Brain 검색 기준(상품 제목)은 유지 — 확장(브랜드/카테고리/OCR/Vision)은 향후

### TASK-0503 — Prompt Engine (`9f44b87`)

- **선언적 템플릿 구조** (@acos/core `prompt/`, 프레임워크 무관):
  - `PromptTemplate<TInput>`: `key` · `name` · `description` · `build(input) → 메시지`
  - `PromptEngine`: 레지스트리 + 렌더러 — `render(key, context)` / `list()` / `has()`,
    중복 key·미등록 key는 즉시 오류. **렌더링은 결정적** — LLM 호출 없이 단위 테스트
- **프롬프트 로직 분리** (지시 사항): 상세페이지 프롬프트(TASK-0502)를
  `content-generation` 템플릿으로 이관 — ContentGenerationService는 이제
  `PROMPT_ENGINE.render("content-generation", context)`만 호출 (출력 동일성 검증)
- **모든 AI 기능 공용 설계** (지시 사항): 새 AI 기능은 ①core에 템플릿 선언
  ②`createDefaultPromptEngine()` 등록 ③`PROMPT_ENGINE` 주입 후 render —
  서비스 안 프롬프트 직접 조립 금지 규칙을 docs/architecture/prompt.md에 명문화
- **API**: `GET /prompt/templates` (등록 템플릿 조회). `PROMPT_ENGINE`은 DI 토큰으로
  export — LLM Gateway(호출)·Prompt Engine(프롬프트)의 대칭 구조
- DB 변경 없음. 문서: docs/architecture/prompt.md, content-generation/README 갱신

### 누적 완료 TASK (Sprint 5)

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| TASK-0501 | LLM Gateway Foundation — 승인 | `9a5a3e2` |
| TASK-0502 | Content Generation Engine — 승인·공식 엔진 확정 | `e147aef` |
| **TASK-0503** | **Prompt Engine** | **`9f44b87`** |

(Sprint 1~4는 최종 승인·공식 종료 — 상세는 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 66 · **PromptEngine 3 + content-generation 템플릿 3** (프롬프트 테스트는 엔진 스펙으로 이관) | 72 | ✅ |
| `apps/api` | Service+API — 기존 126 · **Prompt 1** | 127 | ✅ |
| **합계** | | **199** | **전체 통과** |

신규·이관 테스트가 검증하는 것:
- 엔진: key 렌더링, 미등록 key 오류(등록 목록 안내), 중복 key 생성 시점 오류, list()
- content-generation 템플릿: 기존 프롬프트 테스트 전부 이관 — 상품/OCR/Vision/지식/
  결정/설정/금지어 반영, 빈 컨텍스트 성립 (**분리 후에도 출력 동일 보장**)
- ContentGenerationService: 엔진 주입 후 기존 테스트 전부 통과 (동작 불변)

라이브 검증 (실 PostgreSQL + mock LLM):
- `GET /prompt/templates` → content-generation 템플릿 노출
- 엔진 경로 생성 → Prompt Engine 렌더링 결과가 LLM까지 전달됨(본문 에코로 확인)
- **웹 버튼 클릭(Playwright)** → `/contents/generate` 호출 확인 + Content 7→8건 증가
- 회귀: deprecated 구 경로 201 / 웹 200 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution 3계층 완성**:

```
AI 기능 (Content Generation — 공식 엔진 · 향후 Analysis/Vision/…)
   ├─▶ Prompt Engine (0503)   : 템플릿 레지스트리 → 결정적 렌더링   ← 신설
   └─▶ LLM Gateway (0501)     : Provider 교체(mock 기본) → 호출
        └─ Company Brain (S4) : 컨텍스트 원천 (지식·결정·설정·금지어)
```

① **프롬프트가 독립 계층**이 됨 — 호출(LLM Gateway)과 프롬프트(Prompt Engine)가
분리된 대칭 구조로, 새 AI 기능은 템플릿 하나로 합류. ② 프롬프트는 core에서
결정적으로 단위 테스트됨 — 렌더링 결과가 곧 계약. ③ 공식 생성 경로 확정:
웹/API 모두 엔진 경로 사용, 구 mock 경로는 Deprecated(다음 Sprint 통합).

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 15건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0503은 스키마 변경 없음 — 템플릿은 코드 선언)

```
Project ──< ProductObject (READY) ──▶ Content (공식 엔진/구 경로 공용 저장)
        ──< SopRun · Decision · ProjectMemory
Memory · Knowledge — Company Brain (생성 컨텍스트 원천)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| 상세페이지 생성 | `POST /projects/:id/contents/generate` (**공식**) · `POST …/contents` (⚠️ Deprecated) |
| LLM Gateway | `GET /llm` · `POST /llm/complete` (개발용) |
| **Prompt Engine** | **`GET /prompt/templates`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 — **상세페이지 버튼이 공식 엔진 사용**)

## 8. 리스크·기술 부채

1. **0503 해석 미확인** — 템플릿 코드 선언 vs DB 관리, 버전 관리 여부 (CTO_REQUEST #18)
2. **구 mock 경로 통합 대기** — Deprecated 표시만 완료, 내부 엔진 호출 통합은 다음 Sprint (CTO 지시)
3. **실모델 미검증** — mock LLM로만 검증 (키 확보 시 스모크 테스트 권장)
4. **생성물 사후 검증 부재** — 금지어는 프롬프트 지침만 (실모델 전환 전 사후 스캔 권장)
5. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #18 확인** — 템플릿 관리 방식·버전·다음 확장 대상
2. **구 mock Generator 내부 통합** — CTO 예고 사항 (다음 Sprint): POST /contents가
   내부적으로 공식 엔진 호출
3. **생성물 사후 금지어 검증** — ready-validation 스캔 재활용 안전망
4. **Analysis/Vision 템플릿화** — Prompt Engine에 두 번째·세 번째 템플릿 등록으로
   공용 설계 검증
5. **Execution 도메인** — LLM 호출 이력·비용 (CTO 결정 사항의 후속 스펙)
