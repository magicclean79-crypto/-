# TASKS — AI Product Content OS 작업 대장

> AGENTS.md와 함께 작업의 기준이 되는 문서다.
> - CTO(아키텍트)가 TASK 스펙을 이 문서(또는 채팅 지시)로 내려주면 **미완료** 섹션에 등록된다.
> - "다음 진행해" 지시 시 **미완료 섹션의 최상단 TASK**를 구현한다.
> - 새로운 기능을 임의로 추가하지 않는다 — 스펙 없는 항목은 "제안(스펙 대기)"에만 둔다.
> - TASK 완료 = 품질 게이트(Build/Test/TS/ESLint) 통과 + `/reports/CTO_REPORT.md` 갱신.

## 미완료 (스펙 확정, 구현 대기)

_(현재 없음 — CTO의 다음 TASK 스펙 대기 중)_

## 제안 (스펙 대기 — 구현하지 않음)

CTO_REQUEST.md에서 식별된 후보들. CTO가 스펙을 확정하면 미완료 섹션으로 이동한다.

- [ ] Vision Foundation — VisionProvider 교체 구조, Product Object visionSummary 실연동 (CTO_REQUEST #5)
- [ ] Product Object 상태 전이 API (DRAFT → READY) + 검증 규칙 (CTO_REQUEST #3)
- [ ] 상세페이지(Content) 생성 파이프라인 — Product Object 입력
- [ ] Project 엔티티 분리 (CTO_REQUEST #1 결정 시)

## 완료

- [x] **Sprint 1 — Foundation** (`4048d62`): pnpm+Turborepo 모노레포, Next.js 16(web:3000) / NestJS 11(api:4000, /health), Docker Compose(PostgreSQL·Redis·MinIO), Prisma 초기 설정, web+api 동시 실행
- [x] **TASK-0201 — 사진 업로드** (`12bb3ae`): 드래그 앤 드롭·다중·진행률 UI, MinIO 저장, `Image` 모델, 업로드 API, 오류 처리
- [x] **TASK-0202 — OCR Foundation Architecture** (`4cf6882`): OCR 도메인 @acos/core 이전(Port/Adapter), MockOCRProvider 기본, Image:OCRResult 1:N 이력, PENDING/RUNNING/SUCCESS/FAILED, Jest 도입, docs/architecture/ocr.md
- [x] **TASK-0203 — Product Object Foundation** (`de5442d`): ProductObject 모델(버전 관리, DRAFT/READY/ARCHIVED), ProductObjectBuilder(OCR+Vision mock 조립), /projects/:id/product-object API, JSON Schema, docs/architecture/product-object.md
- [x] **(자체정의) Product CRUD + 웹 플로우** (`d842338`): /products CRUD, 업로드→Product 생성→목록/상세 웹 페이지 — CTO_REQUEST #4 처리 방침 대기
- [x] **(자체정의) TASK-0204 — AI Analysis Foundation** (`d49157a`): AnalysisProvider 교체 구조, Mock 기본, apply 옵션, docs/architecture/analysis.md
- [x] **(운영) AGENTS 협업 규칙 + CTO 보고 체계** (`81aab6f`, `20c87f0`): AGENTS.md, reports/CTO_REPORT.md·CTO_REQUEST.md
