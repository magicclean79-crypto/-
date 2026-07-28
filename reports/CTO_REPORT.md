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
| 보고 기준 TASK | **TASK-0502 — Content Generation Engine** (Sprint 5 "AI Execution") |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `e147aef` |
| 핵심 성과 | **AI Execution 첫 완결 루프**: READY 검수 통과 상품 + 회사 지식(Company Brain) → LLM Gateway → Markdown 상세페이지 → Content 저장 |
| 구현 중단 상태 | **TASK-0502 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 구 mock 경로 일원화 여부 등 → **CTO_REQUEST #17 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 195/195 통과 (core 69 · api 126) — 이번 TASK +10 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — TASK-0502, `e147aef`)

CTO 지시 3요소를 **모두 사용**해 구현:

- **① READY Product Object**: TASK-0303과 동일 규칙 — READY 상태만 입력 허용
  (버전 지정 시 READY 아니면 400, 미지정 시 최신 READY, 없으면 400)
- **② Company Brain** (CompanyBrainService 사용):
  - 금지어(Memory GLOBAL `banned-words`) → system 지침 "절대 사용하지 않는다"로 강제
  - 상품 제목 검색(PROJECT 스코프) → Knowledge("반드시 준수")·Decision(근거 포함)·
    Memory(구조화 설정) 섹션을 프롬프트에 주입 — 비어 있으면 섹션 생략(생성은 성립)
- **③ LLM Gateway** (LlmService 사용): Provider 교체 구조 그대로 —
  기본 mock(실제 API 미호출), 실모델 전환은 `LLM_PROVIDER`+키 설정만으로 가능
- **프롬프트 조립은 @acos/core** (`content-generation/`, 프레임워크 무관):
  system(카피라이터 지침·Markdown 출력 규칙·금지어) + user(상품 속성/OCR/Vision/
  프로젝트/회사 지식) 구성, 생성 결과의 첫 `# 헤딩`으로 제목 추출(없으면
  "<상품명> 상세페이지")
- **Content 저장**: 기존 Content 모델 그대로 — 목록/단건 API에서 즉시 조회 가능
- **API**: `POST /projects/:id/contents/generate`. 구 mock Generator 경로
  (`POST /contents`)는 기존 기능 보호 원칙으로 유지 (일원화 여부 CTO_REQUEST #17-①)
- DB 변경 없음. 반영된 0501 승인 결정: 모델 env 관리 · /llm/complete 개발용 · 이력/비용 Execution 도메인 분리
- 문서: docs/architecture/content-generation.md, README 갱신

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1~4 | 기반 전체 — 최종 승인·공식 종료 (상세는 TASKS.md) | — |
| TASK-0501 | LLM Gateway Foundation — 승인 | `9a5a3e2` |
| **TASK-0502** | **Content Generation Engine** | **`e147aef`** |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 64 · **ContentGeneration(프롬프트·제목 추출) 5** | 69 | ✅ |
| `apps/api` | Service+API — 기존 121 · **엔진 4 + 라우팅 1** | 126 | ✅ |
| **합계** | | **195** | **전체 통과** |

신규 테스트가 검증하는 것:
- 프롬프트 조립: system+user 2메시지, 상품 속성/OCR/Vision/지식/결정/설정/금지어
  전부 반영, 컨텍스트 비어도 성립(섹션 생략)
- 제목 추출: 첫 `#` 헤딩 우선, 없으면 fallback
- 엔진: 생성 결과 Content 저장·버전 연결, **Company Brain 2회 조회 검증**
  (banned-words GLOBAL + 제목 PROJECT), **LLM 호출 프롬프트에 지식·금지어 포함 검증**,
  READY 규칙 3종(400/400/404), 없는 프로젝트 404
- 컨트롤러: /contents/generate 라우팅

라이브 검증 (실 PostgreSQL + mock LLM):
- `POST …/contents/generate` → 최신 READY v6 사용, 생성 본문이 Content로 저장
  (목록 4건 확인). mock LLM이 프롬프트를 에코하므로 **상품 정보·OCR 텍스트가
  게이트웨이까지 전달됨을 본문에서 직접 확인**. fallback 제목 적용
- 오류: DRAFT v3 → 400 · 없는 버전 → 404 · 없는 프로젝트 → 404
- 회귀: 구 mock 경로 201 / GET /llm / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution 루프 개통**:

```
업로드 → OCR → 조립 → READY 검수(0404, Advisory)
                         │ READY Product Object
                         ▼
     Content Generation Engine (0502)
       ├── Company Brain 조회 (0403 Query — 지식·결정·설정·금지어)
       ├── 프롬프트 조립 (@acos/core)
       ├── LLM Gateway (0501 — mock 기본, OpenAI/Anthropic/Gemini 교체)
       └── Content 저장 (Markdown 상세페이지)
```

① Sprint 4(Company Brain)와 Sprint 5(LLM Gateway)가 실제 생성물에서 합류 —
**회사 지식이 프롬프트 규칙으로 강제되는 생성 파이프라인** 완성.
② 프롬프트 규칙은 core(테스트 가능·프레임워크 무관), 데이터 수집·저장은 api 계층 —
기존 결 유지. ③ 실모델 전환 준비 완료: `LLM_PROVIDER`+키만 설정하면 이 엔진이
그대로 실제 LLM으로 상세페이지를 생성한다.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 15건(이번 TASK 변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0502는 스키마 변경 없음 — 기존 Content 모델에 저장)

```
Project ──< ProductObject (READY) ──▶ Content (상세페이지 — mock 경로/엔진 경로 공용)
        ──< SopRun · Decision · ProjectMemory
Memory (scope Enum) · Knowledge (category Enum)  — Company Brain (생성 컨텍스트 원천)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조: projects/uploads/ocr/products/analysis/product-object/sop-runs/decisions/memories/memory/knowledge/company-brain/ready-validation/llm) |
| **상세페이지 생성** | **`POST /projects/:id/contents/generate`** (엔진 — TASK-0502) · `POST /projects/:id/contents` (구 mock 경로) · `GET …/contents`(+`/:contentId`) |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 실행 — 웹 버튼은 아직 구 경로 사용, CTO_REQUEST #17-②)

## 8. 리스크·기술 부채

1. **0502 해석 미확인** — 경로 이원화(구 mock vs 엔진), 웹 버튼 전환, Company Brain
   검색 기준(상품 제목) (CTO_REQUEST #17)
2. **실모델 미검증** — mock LLM로만 검증(키 없음). 실키 설정 시 프롬프트 품질·
   출력 형식(코드 펜스 등) 재점검 필요
3. **LLM 호출 이력·비용 비저장** — CTO 결정대로 Execution 도메인 분리 대기
4. **생성물 검수 부재** — 생성된 Markdown에 대한 금지어 사후 검사(0404 재활용) 없음 —
   프롬프트 지침만으로는 실모델에서 보장 불가
5. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #17 확인** — 경로 일원화·웹 버튼 전환·검색 기준
2. **생성물 사후 검증** — 생성된 Markdown에 ready-validation의 금지어 스캔을 재활용해
   FAIL 시 재생성/차단하는 안전망 (실모델 전환 전 권장)
3. **Execution 도메인** — LLM 호출 이력·비용 추적 (CTO 결정 사항의 후속 스펙)
4. **실키 스모크 테스트** — Provider 3종 중 1종이라도 실키로 엔진 경로 검증
5. Analysis/Vision의 LLM Gateway 전환 (동일 패턴 확장)
