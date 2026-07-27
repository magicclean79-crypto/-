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
| 보고 기준 TASK | Sprint 3 완료 (TASK-0302 · 0303 · 0304) |
| 보고일 | 2026-07-27 |
| 브랜치 / 기준 커밋 | `claude/ai-product-content-os-setup-jb5oai` / `0dd85bf` |
| 파이프라인 상태 | **엔드투엔드 완성**: 업로드 → OCR → 조립 → READY 검수 → 상세페이지 생성, 웹 UI에서 실행 가능 |
| 미착수 범위 | 실제 AI API 연동(전 계층 mock 기본), Content 발행(REVIEW→PUBLISHED) |

## 2. 품질 게이트

| 게이트 | 명령 | 결과 |
| --- | --- | --- |
| Build | `pnpm build` | ✅ 6/6 워크스페이스 성공 |
| Test | `pnpm test` | ✅ 81/81 통과 (core 29 · api 52) |
| TypeScript | (빌드 포함) | ✅ 오류 0 |
| ESLint | `pnpm lint` | ✅ 오류 0, 경고 0 |

## 3. 변경 사항 (이번 보고 주기 — Sprint 3)

- **TASK-0302 상태 전이** (`9374aae`): DRAFT⇄READY, DRAFT/READY→ARCHIVED(종결) 규칙을 @acos/core에 정의, READY 전환 필수 조건(제목 + OCR/Vision 요약) 검증, `PATCH …/product-object/:version/status`
- **TASK-0303 상세페이지 파이프라인** (`3a7fb00`): `ContentGenerator` Port + Mock(결정적 Markdown 렌더링). Content 모델을 Project/ProductObject 소속으로 재구성(미사용 0건 테이블이라 안전). **READY 상태 Product Object에서만 생성** — 0302 검수 게이트와 연결. `POST/GET /projects/:id/contents`
- **TASK-0304 웹 UI** (`0dd85bf`): `/projects` 목록·상세 페이지, 파이프라인 실행 버튼(조립 → READY 전환 → 상세페이지 생성), 콘텐츠 Markdown 뷰어
- Sprint 3 백로그 근거: Sprint 2 CTO 리뷰의 다음 권장 사항 목록 (실제 Provider 연결은 API 키 필요로 보류 유지)

### 누적 완료 TASK

| TASK | 내용 | 커밋 |
| --- | --- | --- |
| Sprint 1 | 모노레포 기반 (Next.js 16 / NestJS 11 / Docker / Prisma) | `4048d62` |
| TASK-0201 | 사진 업로드 (MinIO, Image 모델) | `12bb3ae` |
| TASK-0202 | OCR Foundation (Provider 교체, 1:N 이력) | `4cf6882` |
| TASK-0203 | Product Object Foundation (Builder, 버전 관리, JSON Schema) | `de5442d` |
| TASK-0205 | Vision Provider Foundation | `4fb0cf4` |
| TASK-0301 | Project Domain Foundation (루트 엔티티) | `55130af` |
| TASK-0302 | Product Object 상태 전이 + READY 검증 | `9374aae` |
| TASK-0303 | 상세페이지 콘텐츠 파이프라인 | `3a7fb00` |
| TASK-0304 | 웹 UI Project/파이프라인 반영 | `0dd85bf` |
| (자체정의) | AI 분석 Foundation / Product CRUD·웹 플로우 | `d49157a` / `d842338` |

## 4. 테스트 결과

| 위치 | 종류 | 수 | 결과 |
| --- | --- | --- | --- |
| `packages/core` | Unit — OCR 8 · Analysis 6 · Builder 6 · Status 3 · Vision 3 · Content 3 | 29 | ✅ |
| `apps/api` | Service+API — OCR 8 · Analysis 9 · ProductObject 17 · Projects 10 · Contents 8 | 52 | ✅ |
| **합계** | | **81** | **전체 통과** |

라이브 검증(실 PostgreSQL + S3 호환 스토리지):
- 상태 전이: v4 READY 전환, 중복 전이 400, ARCHIVED 종결 400, 없는 버전 404 — DB 반영 확인
- 콘텐츠: READY v4로 상세페이지 생성(201, Markdown 본문), READY 없는 프로젝트 400, DRAFT 버전 지정 400
- **브라우저 E2E(Playwright)**: 프로젝트 상세 화면에서 조립(v5) → READY 전환 → 상세페이지 생성 전 과정 버튼 실행, 결과 렌더링 캡처
- 회귀: health / products / analysis / ocr / 웹 전부 정상

## 5. 아키텍처 변경 및 현황

**이번 주기 변경**: ① 상태 전이 규칙이 도메인 계층(@acos/core)에 추가되어 READY가 **검수 게이트** 역할 수행. ② Content가 4번째 Port/Adapter 계층(ContentGenerator)으로 합류 — Product Object를 단일 입력으로 소비하는 첫 다운스트림. ③ Content 모델이 Product 소속(미사용 스캐폴드)에서 Project/ProductObject 소속으로 재구성.

**유지되는 핵심 결정**:

1. Port/Adapter 도메인 계층(@acos/core) — Provider는 환경변수 1개로 교체(`OCR_PROVIDER`, `ANALYSIS_PROVIDER`, `VISION_PROVIDER`)
2. 실제 AI API 미연결 원칙 — 4개 계층(OCR/Analysis/Vision/Content) 전부 mock 기본, 실연동 가이드는 docs/architecture/*.md
3. 이력 보존 모델 — OCR/Analysis 1:N, Product Object 명시적 버전
4. ~~projectId = products.id~~ → **해소됨** (TASK-0301, Project 정식 도입)

**현황**:

- 모노레포: `apps/web`(Next.js 16, Tailwind 4) · `apps/api`(NestJS 11, Prisma 6) · `packages/{core,shared,agents,ui}`
- 파이프라인: 업로드 → OCR(1:N) → 분석(1:N) → ProductObjectBuilder → 버전 저장
- 인프라: docker-compose(PostgreSQL 16·Redis 7·MinIO), 마이그레이션 6건, drift 없음

## 6. 데이터 모델

```
Project(루트) ──< Product ──< Image ──< OcrResult        (1:N 이력)
      │             │           └─ MinIO 오브젝트
      │             └──< AnalysisResult                  (1:N 이력, applied 플래그)
      ├──< ProductObject (projectId+version 유니크)       (버전 관리, DRAFT⇄READY→ARCHIVED)
      └──< Content ──(productObjectId, SetNull)──▶ ProductObject   (상세페이지, READY에서만 생성)
```

## 7. API 표면

| 영역 | 엔드포인트 |
| --- | --- |
| Health | `GET /health` → "OK" |
| 프로젝트 | `POST/GET /projects` · `GET/PATCH/DELETE /projects/:id` |
| 업로드 | `POST /uploads/images` · `GET /uploads/images` |
| OCR | `POST/GET /images/:id/ocr` · `GET /images/:id/ocr/history` · `GET /ocr/results` |
| 상품(프로젝트) | `POST/GET /products` · `GET/PATCH/DELETE /products/:id` |
| AI 분석 | `POST/GET /products/:id/analysis` (+`/history`, `{apply}` 옵션) |
| Product Object | `POST/GET /projects/:id/product-object` (+`?version`, `/history`) · `PATCH …/:version/status` |
| 상세페이지 | `POST/GET /projects/:id/contents` · `GET …/contents/:contentId` |

웹: `/` · `/upload` · `/products`(+상세) · **`/projects`(목록) · `/projects/[id]`(파이프라인 실행: 조립→READY→상세페이지)**

## 8. 리스크·기술 부채

1. **실제 AI 모델 미연결** — OCR/Analysis/Vision/Content 전부 mock 기본 (CTO_REQUEST #6)
2. **인증/권한 없음** — 전 API 공개 (로컬 개발 전제)
3. **Content 발행 파이프라인 미구현** — DRAFT 이후 REVIEW/PUBLISHED 전이·채널 포맷 없음
4. 업로드 보안(바이러스 검사)·이미지 리사이징 없음
5. 웹 UI에 업로드 시 프로젝트 선택 없음(자동 생성만) — 다중 상품 프로젝트는 API로만 구성 가능

## 9. 다음 권장 사항 (Sprint 4 후보)

1. **실제 Provider/Generator 연결** — 파이프라인 구조가 완성되었으므로 이제 mock을 실제 모델로 교체하는 것이 최대 가치. 어느 계층부터·어떤 모델·API 키 확보 방안 결정 요청 (CTO_REQUEST #6)
2. **Content 발행 파이프라인** — DRAFT→REVIEW→PUBLISHED 전이 + 채널별 포맷(스마트스토어/쿠팡 등)
3. **업로드 플로우에 프로젝트 선택** — 기존 프로젝트에 상품 추가하는 UI
4. **인증/권한** — 운영 배포 전 필수
