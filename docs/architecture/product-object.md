# Product Object 아키텍처

## Product Object의 역할

**Product Object는 AI Product Content OS의 핵심 데이터 모델**이다.
업로드된 사진에서 추출된 모든 신호(OCR 텍스트, Vision 분석)를 하나의
정규화된 상품 표현으로 조립한 것으로, 이후 모든 콘텐츠 생성(상세페이지,
마케팅 문구 등)의 **단일 진실 공급원(Single Source of Truth)** 역할을 한다.

```
사진 업로드 → OCR → Vision → ┌───────────────────┐ → 상세페이지 생성 (향후)
                              │  Product Object   │ → 마케팅 콘텐츠 (향후)
        Company Brain (향후) → │  (버전 관리됨)     │ → 채널별 포맷 (향후)
                              └───────────────────┘
```

특징:

- **버전 관리**: 생성할 때마다 새 버전이 쌓인다(`projectId + version` 유니크).
  소스(사진/OCR)가 바뀌면 재조립해 새 버전을 만들고, 과거 버전은 보존된다.
- **상태 관리**: `DRAFT`(조립 직후) → `READY`(검수 완료) → `ARCHIVED`(보관)
- **스키마 고정**: [docs/schema/product-object.schema.json](../schema/product-object.schema.json)이
  구조의 계약이다. 소비자(콘텐츠 생성기 등)는 이 스키마만 의존한다.
- 현재 구조에서 "프로젝트" 단위는 `Product`(업로드 그룹)이며,
  `projectId`는 `products.id`를 참조한다. 별도 Project 엔티티가 도입되면
  FK 대상만 교체하면 된다.

## 조립 파이프라인 (ProductObjectBuilder)

`packages/core/src/product-object/product-object.builder.ts`

```
POST /projects/:projectId/product-object
        │
        ▼
ProductObjectService (apps/api)
  1. 프로젝트(Product) + 이미지 + 이미지별 최신 OCR SUCCESS 결과 조회
  2. Vision 요약 확보 — 현재는 createMockVisionSummary() (결정적 mock)
        │
        ▼
ProductObjectBuilder (@acos/core)          ← 순수 도메인, 프레임워크 무관
  3. .withOcrResults(...)   — 이미지별 텍스트/신뢰도
  4. .withVisionSummary(...) — Vision 요약
  5. .build() → ProductObjectDraft
     · title: Vision 제안 → OCR 첫 줄 → 프로젝트 이름
     · brand/category: Vision에서
     · ocrSummary: 소스별 텍스트 + 결합 텍스트 + 평균 신뢰도
     · metadata: builderVersion, imageCount, assembledAt …
        │
        ▼
  6. 다음 버전 번호로 product_objects에 저장 (status=DRAFT)
```

## OCR 연계

- 입력: 각 이미지의 **최신 `SUCCESS` 상태 OcrResult** (`extractedText`, `confidence`)
- `ocrSummary.sources[]`에 이미지 단위로 보존되어 어떤 사진에서 어떤 텍스트가
  나왔는지 추적 가능하다. `combinedText`는 콘텐츠 생성기의 프롬프트 입력으로 쓰인다.
- OCR Provider가 교체되어도(tesseract → Google Vision 등, [ocr.md](ocr.md) 참고)
  Product Object 구조는 변하지 않는다 — Builder는 정규화된 OcrTextSource만 본다.

## Vision 연계

- 입력: `VisionSummary { source, labels, brand, category, suggestedTitle, confidence }`
- **`VisionProvider`(Port)로 교체 가능** — `VISION_PROVIDER` 환경 변수로 선택하며
  기본은 `MockVisionProvider`(`source: "mock"`), 실제 Vision 모델은 미연결.
  구조와 교체 방법: [vision.md](vision.md)
- Vision 실패는 조립을 막지 않는다 — 재시도 후에도 실패하면 `visionSummary: null`로
  진행하고 제목은 OCR 첫 줄 → 프로젝트 이름으로 폴백된다.

## 향후 Company Brain 연계

Company Brain은 회사/브랜드 차원의 지식 저장소(브랜드 톤, 금지어, 배송 정책,
인증 정보, 과거 상품 데이터 등)다. Product Object와의 연계 계획:

1. **조립 시 보강(enrichment)**: Builder에 `withCompanyContext(context)` 단계를
   추가해 브랜드 공식 표기, 기본 속성(제조사/원산지), 카테고리 표준화를 주입한다.
   Builder는 이미 단계적 조립 구조이므로 메서드 하나만 늘어난다.
2. **검증(validation)**: `DRAFT → READY` 전이 시 Company Brain의 정책
   (금지 표현, 필수 고지 문구)에 대한 검증을 수행한다.
3. **역방향 학습**: READY로 확정된 Product Object의 속성/카테고리를
   Company Brain에 되먹여 다음 조립의 정확도를 높인다.
4. 저장 위치: `metadata.companyBrain`에 적용된 규칙의 버전/출처를 기록해
   재현 가능성을 보장한다.

## API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `POST` | `/projects/:projectId/product-object` | OCR+Vision을 조립해 새 버전 생성 (201) |
| `GET` | `/projects/:projectId/product-object` | 최신 버전 조회. `?version=N`으로 특정 버전 (200/400/404) |
| `GET` | `/projects/:projectId/product-object/history` | 버전 이력 최신순 (200) |

## 테스트

- Unit: `packages/core/src/product-object/product-object.builder.spec.ts` — 제목 우선순위, OCR 요약 집계, 빈 입력, mock vision 결정성
- Service: `apps/api/src/product-object/product-object.service.spec.ts` — 조립·저장, 버전 증가, 버전 조회, 404
- API: `apps/api/src/product-object/product-object.controller.spec.ts` — supertest HTTP 계약

```bash
pnpm test
```
