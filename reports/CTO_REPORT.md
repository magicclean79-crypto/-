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
| 보고 기준 TASK | **TASK-0506 — Legacy Generator Integration** (+ TASK-0505 승인 결정 반영) |
| 보고일 | 2026-07-28 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `574523a` |
| 핵심 성과 | 상세페이지 **생성 코어 단일화** — 구 경로·공식 경로·SOP 전부 하나의 공식 엔진으로 생성 (API 계약 무변경) |
| 구현 중단 상태 | **TASK-0506 완료 후 즉시 중단** — CTO 승인 전 다음 TASK 미착수 |
| 스펙 확인 필요 | Wrapper 구현 방식·env 제거 등 → **CTO_REQUEST #21 확인 요청** |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 231/231 통과 (core 102 · api 129) — 이번 주기 +2 |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기)

### TASK-0505 승인 결정 반영 (`574523a`에 포함)

- **이미지 상한 환경변수화 (결정 ①)**: `VISION_MAX_IMAGES` 환경 변수로 조정
  가능 (기본 5장 유지, 최소 1 보정) — .env.example·vision.md 갱신
- Mock JSON Echo 공식 전략(②)·VISION_PROVIDER 제거 유지(③)는 현행 그대로 확정
- 이미지 용량 제한·리사이즈(④)는 **실제 Provider 연결 전 구현**으로 백로그 기록

### TASK-0506 — Legacy Generator Integration (`574523a`)

- **Wrapper 통합 (지시 사항)**: 신규 `EngineContentGenerator`(apps/api)가
  Deprecated `ContentGenerator` Port를 구현하고 내부에서 공식 엔진을 호출 —
  구 경로의 흐름(READY 검증 → generate → 저장)과 **API 계약(요청/응답/오류)은
  변경 없음**, DI(CONTENT_GENERATOR 토큰)만 Wrapper로 교체
- **생성 코어 공용화**: `ContentGenerationService.generateMarkdown()` 분리 —
  Company Brain 조회 + `content-generation` 템플릿 렌더링 + LLM Gateway 호출을
  저장 없이 수행. 공식 경로 `generate()`와 Wrapper가 같은 코어 사용 →
  **구 경로와 공식 경로가 같은 PO에 대해 동일한 본문을 생성** (테스트로 검증)
- **부수 통합**: SOP `product-content`의 상세페이지 단계(ContentsService 사용)도
  자동으로 공식 엔진 경유 — 시스템 내 모든 생성 진입점이 단일 코어로 수렴
- **보존 (지시 사항)**: 구 `MockContentGenerator`는 @deprecated로 보존(미연결),
  ContentGenerator Port·구 라우트 유지. `CONTENT_GENERATOR` 환경 변수는 제거 —
  모델 선택은 `LLM_PROVIDER` 하나 (0504·0505 승인 원칙 적용)
- DB 변경 없음. 문서: content.md 재작성, content-generation.md/README/.env.example 갱신

### 누적 완료 TASK (Sprint 5)

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| TASK-0501 | LLM Gateway Foundation — 승인 | `9a5a3e2` |
| TASK-0502 | Content Generation Engine — 승인·공식 엔진 확정 | `e147aef` |
| TASK-0503 | Prompt Engine — 승인 (Code-first 확정) | `9f44b87` |
| TASK-0504 | Analysis Engine Integration — 승인 (Mock Echo 공식 전략) | `74e9fbb` |
| TASK-0505 | Vision Multimodal Integration — 승인 (상한 env화 지시 반영) | `d63a975` |
| **TASK-0506** | **Legacy Generator Integration** | **`574523a`** |

(Sprint 1~4는 최종 승인·공식 종료 — 상세는 TASKS.md)

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — 기존 101 · **Vision maxImages 옵션 1** (MockContentGenerator 테스트는 보존) | 102 | ✅ |
| `apps/api` | Service+API — 기존 128 · **경로 동일성(통합 검증) 1** (contents 스펙 Wrapper 기준 개편) | 129 | ✅ |
| **합계** | | **231** | **전체 통과** |

신규·개편 테스트가 검증하는 것:
- **구 경로 = 공식 경로 본문 동일성** — 같은 READY PO에 대해 두 경로가 같은
  title/body 생성 (생성 코어 단일화의 직접 증명)
- 구 경로 API 계약 유지 + **Wrapper가 공식 엔진(generateMarkdown)을 정확한
  입력(프로젝트/PO 스냅샷/OCR 텍스트)으로 호출**하는지
- READY 규칙·버전 지정·404/400 등 구 경로 기존 계약 전부 통과 (동작 불변)
- Vision maxImages 옵션(환경변수 주입 지점) 동작

라이브 검증 (실 PostgreSQL + S3 mock + mock LLM):
- 구 경로 `POST …/contents` → 201, **본문이 공식 엔진 출력과 완전 동일** (동일
  PO 기준 문자열 비교)
- 공식 경로 `POST …/contents/generate` → 201 정상
- **SOP 실행** `POST …/sop-runs` → 4단계(OCR→조립→READY→상세페이지) 전부 DONE —
  상세페이지 단계가 공식 엔진 경유로 정상 동작
- 회귀: 콘텐츠 목록/단건 200 · 조립·분석 경로 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경 — 생성 진입점의 단일 코어 수렴 (Sprint 5 예고분 완결)**:

```
POST …/contents/generate (공식) ──┐
POST …/contents (구, Deprecated) ─┤→ ContentGenerationService.generateMarkdown()
   └─ EngineContentGenerator      │     = Company Brain + Prompt Engine + LLM Gateway
SOP product-content "content" ────┘        (생성 코어 하나)
```

① 0502 승인 시 예고된 "구 경로 내부 통합"이 완결 — 이제 어떤 진입점으로
생성해도 같은 규칙(Company Brain 금지어·지식 반영)이 적용됨. ② Port/Adapter
원칙 유지: 구 Port는 그대로, Adapter만 mock→Wrapper 교체 (호출자 무수정).
③ 환경 변수 표면 축소 완료: AI 실행 관련 선택은 `LLM_PROVIDER` 하나
(OCR 제외 — OCR_PROVIDER는 별도, CTO_REQUEST #2 대기).

**유지되는 핵심 결정**: Port/Adapter 계층 · mock 기본 원칙(Mock Echo 공식 전략) · 이력 보존 모델 · Advisory 검증 · Vision null 폴백

**현황**: 모노레포(web·api·core/shared/agents/ui), 마이그레이션 15건(변경 없음), drift 없음

## 6. 데이터 모델

(TASK-0506은 스키마 변경 없음 — 두 경로 모두 기존 Content 테이블에 동일하게 저장)

```
Project ──< Product ──< AnalysisResult (llm:<llm>)
        ──< ProductObject (visionSummary: llm:<llm>) ──▶ Content (모든 생성 경로 공용 저장)
        ──< SopRun · Decision · ProjectMemory
Memory · Knowledge — Company Brain (생성·분석·Vision 공용 컨텍스트 원천)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| 기존 전체 | (유지 — 이전 보고 참조) |
| 상세페이지 생성 | `POST /projects/:id/contents/generate` (**공식**) · `POST …/contents` (⚠️ Deprecated — **계약 동일, 내부는 공식 엔진**) |
| 콘텐츠 조회 | `GET …/contents` · `GET …/contents/:contentId` — 변경 없음 |
| LLM Gateway | `GET /llm` · `POST /llm/complete` (개발용) |
| Prompt Engine | `GET /prompt/templates` — 템플릿 3종 |

웹: `/` · `/upload` · `/products`(+상세) · `/projects`(목록/파이프라인 — 버튼은 공식 경로 사용) — 변경 없음

## 8. 리스크·기술 부채

1. **0506 해석 미확인** — Wrapper 위치(apps/api)·CONTENT_GENERATOR env 제거·
   mock Generator 보존 범위 (CTO_REQUEST #21)
2. **구 경로 제거 시점 미정** — 통합은 완료됐으나 Deprecated 라우트·Port·mock
   구현의 최종 제거 일정은 CTO 결정 대기
3. **실모델 미검증** — 멀티모달·구조화 출력 매핑 포함, API 키 확보 시 스모크
   테스트 필요 (구조화 출력 매핑은 실연결 시 — CTO 결정)
4. **이미지 용량 제한·리사이즈** — CTO 결정대로 실제 Provider 연결 전 구현 예정
5. **생성물 사후 검증 부재 · 인증/권한 없음** — 이전 보고와 동일

## 9. 다음 권장 사항 (Sprint 5 후속 후보)

1. **CTO_REQUEST #21 확인** — TASK-0506 해석 확인 및 다음 지시
2. **Sprint 5 종료 검토** — 예고된 백로그(0501~0506) 전부 구현 완료 상태.
   Sprint 회고/종료 선언 또는 잔여 지시 요청
3. **Execution 도메인** — LLM 호출 이력·비용 (CTO 결정 사항의 후속 스펙 —
   이제 모든 호출이 LlmService 한 지점을 지나므로 계측 지점이 명확)
4. **실모델 연결 준비** — 이미지 용량 가드 + 구조화 출력 매핑 + 스모크 테스트
   (API 키 스펙 필요, CTO_REQUEST #6)
5. **Content 발행 파이프라인** — DRAFT → REVIEW → PUBLISHED (제안 백로그)
