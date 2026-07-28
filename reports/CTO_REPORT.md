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
| 보고 기준 TASK | **TASK-0505 — Vision Multimodal Integration** |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `d63a975` |
| 핵심 성과 | Vision이 **LLM 기반 멀티모달 공식 엔진**으로 교체 — LLM Gateway가 이미지 입력을 지원하게 되어 AI Execution 3계층이 텍스트+이미지를 모두 처리 |
| 구현 중단 상태 | **TASK-0505 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | 이미지 첨부 상한·초안 설계 등 → **CTO_REQUEST #20 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 229/229 통과 (core 101 · api 128) — 이번 주기 +14 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0504 승인 결정 반영

- Mock JSON Echo(프롬프트 초안 블록 반환)를 **공식 Mock 전략**으로 유지
- `responseFormat`(text/json) 유지 — Provider별 구조화 출력 매핑은 실제
  Provider 연결 시 적용 (docs/architecture/llm.md에 CTO 결정으로 명문화)
- `ANALYSIS_PROVIDER` 제거 상태 유지 — `LLM_PROVIDER` 하나만 사용

### TASK-0505 — Vision Multimodal Integration (`d63a975`)

- **공식 Vision 엔진 = `LlmVisionProvider`** (@acos/core, 구 MockVisionProvider
  제거). CTO 지시대로 네 가지를 사용:
  - ① **Image Bytes**: `getBytes()`로 원본을 읽어 base64로 LLM 요청에 첨부
    (최대 5장 — 초과분은 raw.omittedImageCount 기록)
  - ② **Prompt Engine**: 신규 `vision-analysis` 템플릿 — 프로젝트/OCR/
    Company Brain 컨텍스트 + 규칙 기반 초안 JSON(0504와 동일 패턴)
  - ③ **LLM Gateway**: `images` + `responseFormat: "json"` 호출
  - ④ **Company Brain**: 프로젝트 이름 질의·PROJECT 스코프 조회
- **LLM Gateway 멀티모달 확장**: `LlmRequest.images`(`{mimeType, base64}[]`)
  추가 + 검증(image/* · base64 비어있지 않음). **어댑터 3종 이미지 매핑 구현**:
  Anthropic image content block · OpenAI image_url(data URL) · Gemini
  inlineData — 마지막 user 메시지에 첨부. mock LLM은 이미지를 해석하지 않고
  개수만 raw에 기록(결정성 유지)
- **유지된 것 (CTO 지시)**: `VisionSummary` 모델(source/labels/brand/category/
  suggestedTitle/confidence)·저장 위치(ProductObject.visionSummary)·API·
  **실패 시 null 폴백**(Vision 실패는 조립을 막지 않음) 모두 변경 없음.
  새 결과는 source `llm:<provider>`(예: llm:mock), 기존 버전의 "mock" 이력 보존
- `VISION_PROVIDER` 환경 변수 제거 — 모델 선택은 `LLM_PROVIDER` 하나 (0504
  승인 결정과 동일 원칙)
- DB 변경 없음. 문서: vision.md 재작성, llm.md/prompt.md/README/.env.example 갱신

### 누적 완료 TASK (Sprint 5)

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| TASK-0501 | LLM Gateway Foundation — 승인 | `9a5a3e2` |
| TASK-0502 | Content Generation Engine — 승인·공식 엔진 확정 | `e147aef` |
| TASK-0503 | Prompt Engine — 승인 (Code-first 확정) | `9f44b87` |
| TASK-0504 | Analysis Engine Integration — 승인 (Mock Echo 공식 전략) | `74e9fbb` |
| **TASK-0505** | **Vision Multimodal Integration** | **`d63a975`** |

(Sprint 1~4는 최종 승인·공식 종료 — 상세는 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 87 · **Vision 12 신규/개편** (LlmVisionProvider 6 · 초안/파서/템플릿 9 중 신규, 구 mock 3 대체) · **LLM 멀티모달 2** | 101 | ✅ |
| `apps/api` | Service+API — 기존 128 유지 (Product Object 스펙을 신 엔진 기준 개편) | 128 | ✅ |
| **합계** | | **229** | **전체 통과** |

신규·개편 테스트가 검증하는 것:
- LlmVisionProvider: mock LLM 경로 성공(source `llm:mock`), **이미지 바이트
  →base64 첨부 확인**, 최대 5장 제한(초과분 미로드), Company Brain 로드·raw
  반영, 파싱 불가 응답 reject
- 초안/파서: OCR 첫 줄 → labels/제안 제목 규칙, labels 누락 오류, 필드 보정
- LLM Gateway: images 검증(mimeType/base64), mock의 imageCount 기록
- ProductObjectService: 신 엔진 주입 후 조립·버전 이력·**실패 시 null 폴백 +
  제목 폴백** 기존 테스트 전부 통과 (구조 불변)

라이브 검증 (실 PostgreSQL + S3 mock + mock LLM):
- 조립 실행 → visionSummary `{source: "llm:mock", labels: [...], suggestedTitle:
  OCR 첫 줄, ...}` 저장 확인 — **실제 이미지 바이트를 스토리지에서 읽어 첨부**
- 스토리지 중단 상태에서 실행 → Vision 3회 재시도 후 **null 폴백으로 조립 성공**
  (graceful degradation 실증)
- 회귀: `GET /prompt/templates` 3건 · 분석(llm:mock SUCCESS) · READY 전이 200 ·
  상세페이지 생성 201 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — AI Execution 계층의 멀티모달 완성**:

```
AI 기능
 ├─ Content Generation (0502) ─┐
 ├─ Analysis (0504)           ├→ Prompt Engine (0503) : 템플릿 3종
 └─ Vision (0505) ← 교체 완료  ┤→ LLM Gateway (0501)   : responseFormat + images ← 확장
                              └→ Company Brain (S4)   : 컨텍스트 원천
```

① 세 번째 AI 기능이 같은 3계층으로 합류 — 공용 설계가 **텍스트·구조화 출력·
이미지 입력** 전 유형에서 실증됨. ② LLM Gateway가 멀티모달 게이트웨이로 확장:
이미지 매핑은 어댑터에 캡슐화되어 기능 코드는 Provider를 모름. ③ 파이프라인
전 단계(OCR 제외)가 LLM 기반 공식 엔진: Vision→Analysis→Content 모두
`LLM_PROVIDER` 하나로 모델 교체. ④ mock 전략 통일: 초안 에코(0504 승인)를
Vision에도 적용.

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙 · 이력 보존 모델 · Advisory 검증 · Vision null 폴백

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 15건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0505는 스키마 변경 없음 — VisionSummary는 ProductObject.visionSummary(Json)에 저장, CTO 지시로 유지)

```
Project ──< Product ──< AnalysisResult (llm:<llm>)
        ──< ProductObject (visionSummary: source "llm:<llm>" — 구 "mock" 이력 보존)
                └──▶ Content
        ──< SopRun · Decision · ProjectMemory
Memory · Knowledge — Company Brain (생성·분석·Vision 공용 컨텍스트 원천)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| Product Object | `POST /projects/:id/product-object` (조립 — **내부 Vision 엔진만 교체, 계약 변경 없음**) 외 3종 유지 |
| AI 분석 | `POST /products/:id/analysis` 외 2종 — 변경 없음 |
| 상세페이지 생성 | `POST /projects/:id/contents/generate` (공식) · `POST …/contents` (⚠️ Deprecated) |
| LLM Gateway | `GET /llm` · `POST /llm/complete` (개발용 — responseFormat·images 지원) |
| Prompt Engine | `GET /prompt/templates` — `content-generation` · `product-analysis` · **`vision-analysis`** |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인) — 변경 없음

## 8. 리스크·기술 부채

1. **0505 해석 미확인** — 이미지 5장 상한·초안 설계·VISION_PROVIDER 제거 등
   (CTO_REQUEST #20)
2. **실모델 멀티모달 미검증** — 어댑터 3종 이미지 매핑은 구현·단위 검증됐으나
   API 키가 없어 실호출 미검증 (키 확보 시 스모크 테스트 필요)
3. **실모델 구조화 출력 매핑 대기** — CTO 결정대로 실제 Provider 연결 시 적용
4. **이미지 용량 가드 부재** — 장수 상한(5장)만 있고 바이트 크기 상한은 없음
   (대용량 이미지 시 토큰/요청 한도 초과 가능)
5. **구 mock 경로 통합 대기 · 생성물 사후 검증 부재 · 인증/권한 없음** — 이전 보고와 동일

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #20 확인** — TASK-0505 해석 확인 및 다음 지시
2. **구 mock Generator 내부 통합** — CTO 예고 사항: POST /contents가 내부적으로
   공식 엔진 호출 (Sprint 5 예고분 중 미지시 항목)
3. **실모델 스모크 테스트** — API 키 확보 시 멀티모달 + 구조화 출력 매핑 검증
4. **이미지 전처리 가드** — 크기 상한·리사이즈(대용량 업로드 대비)
5. **Execution 도메인** — LLM 호출 이력·비용 (CTO 결정 사항의 후속 스펙)
