# TASKS — AI Product Content OS 작업 대장

> AGENTS.md와 함께 작업의 기준이 되는 문서다.
> - CTO(아키텍트)가 TASK 스펙을 이 문서(또는 채팅 지시)로 내려주면 **미완료** 섹션에 등록된다.
> - "다음 진행해" 지시 시 **미완료 섹션의 최상단 TASK**를 구현한다.
> - 새로운 기능을 임의로 추가하지 않는다 — 스펙 없는 항목은 "제안(스펙 대기)"에만 둔다.
> - TASK 완료 = 품질 게이트(Build/Test/TS/ESLint) 통과 + `/reports/CTO_REPORT.md` 갱신.

## 미완료 (스펙 확정, 구현 대기)

- (없음 — TASK-0306 완료. CTO 리뷰/승인 대기 중이며 승인 전 다음 TASK를 시작하지 않는다)

## 승인 대기 (CTO 승인 전 시작 금지)

- [ ] TASK-0307 — (스펙 미수신)

## 제안 (스펙 대기 — 구현하지 않음)

- [ ] 실제 Provider/Generator 연결 (OCR/Analysis/Vision/Content 중 CTO 지정 — API 키·모델 스펙 필요, CTO_REQUEST #6)
- [ ] Content 발행 파이프라인 (DRAFT → REVIEW → PUBLISHED) 및 채널별 포맷

## 완료 — Sprint 3

- [x] **TASK-0306 — Decision Log Foundation** (`a36c1b0`): Decision 엔티티(id/title/description/reason/decisionType/author/projectId/createdAt) + DecisionRepository Port(@acos/core, Company Brain), Prisma 어댑터, CRUD API /projects/:id/decisions, 검증(필수 필드 공백 불가), docs/architecture/decision.md
- [x] **TASK-0305 — SOP Engine Foundation** (`5c67d54`, CTO 조건부 승인 반영): Company Brain의 SOP 정의(SopDefinition) + Execution Layer의 WorkflowEngine(@acos/core, 순차 실행·실패 시 후속 SKIPPED·단계 간 출력 전달), 기본 SOP product-content(OCR→조립→READY 검수→상세페이지, 기존 서비스 재사용), SopRun 실행 이력(Project 1:N), POST/GET /projects/:id/sop-runs
- [x] **TASK-0302 — Product Object 상태 전이** (`9374aae`): DRAFT⇄READY, →ARCHIVED(종결) 전이 규칙(@acos/core) + READY 필수 조건 검증(제목+OCR/Vision 요약), PATCH …/product-object/:version/status
- [x] **TASK-0303 — 상세페이지 콘텐츠 파이프라인** (`3a7fb00`): ContentGenerator Port + MockContentGenerator(Markdown), Content 모델 Project/ProductObject 소속 재구성, READY Product Object에서만 생성, /projects/:id/contents API
- [x] **TASK-0304 — 웹 UI Project 반영** (`0dd85bf`): /projects 목록·상세, 파이프라인 실행 버튼(조립→READY→상세페이지), 홈 내비게이션

## 완료 — Sprint 1~2

- [x] **Sprint 1 — Foundation** (`4048d62`): pnpm+Turborepo 모노레포, Next.js 16(web:3000) / NestJS 11(api:4000, /health), Docker Compose(PostgreSQL·Redis·MinIO), Prisma 초기 설정, web+api 동시 실행
- [x] **TASK-0201 — 사진 업로드** (`12bb3ae`): 드래그 앤 드롭·다중·진행률 UI, MinIO 저장, `Image` 모델, 업로드 API, 오류 처리
- [x] **TASK-0202 — OCR Foundation Architecture** (`4cf6882`): OCR 도메인 @acos/core 이전(Port/Adapter), MockOCRProvider 기본, Image:OCRResult 1:N 이력, PENDING/RUNNING/SUCCESS/FAILED, Jest 도입, docs/architecture/ocr.md
- [x] **TASK-0203 — Product Object Foundation** (`de5442d`): ProductObject 모델(버전 관리, DRAFT/READY/ARCHIVED), ProductObjectBuilder(OCR+Vision mock 조립), /projects/:id/product-object API, JSON Schema, docs/architecture/product-object.md
- [x] **(자체정의) Product CRUD + 웹 플로우** (`d842338`): /products CRUD, 업로드→Product 생성→목록/상세 웹 페이지 — CTO_REQUEST #4 처리 방침 대기
- [x] **(자체정의) TASK-0204 — AI Analysis Foundation** (`d49157a`): AnalysisProvider 교체 구조, Mock 기본, apply 옵션, docs/architecture/analysis.md
- [x] **(운영) AGENTS 협업 규칙 + CTO 보고 체계** (`81aab6f`, `20c87f0`): AGENTS.md, reports/CTO_REPORT.md·CTO_REQUEST.md
- [x] **TASK-0301 — Project Domain Foundation** (`55130af`): Project 최상위 루트 엔티티 도입(CTO_REQUEST #1 결정 반영), Project 1:N Product, ProductObject.projectId → projects.id 재지정, 데이터 보존 백필 마이그레이션, Projects CRUD API, 조립 시 프로젝트 전체 상품 집계
- [x] **TASK-0205 — Vision Provider Foundation** (`4fb0cf4`): VisionProvider Port + MockVisionProvider(@acos/core), VISION_PROVIDER 환경변수 선택, Product Object 조립에 주입(실패 시 null 폴백), docs/architecture/vision.md — CTO "다음" 지시로 제안 최상단 항목 승격
