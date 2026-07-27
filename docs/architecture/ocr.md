# OCR 아키텍처

OCR 기능의 목표는 특정 엔진 구현이 아니라, **여러 OCR 엔진(Google Vision,
Azure Vision, AWS Textract, Naver CLOVA OCR 등)을 자유롭게 교체할 수 있는
구조**를 유지하는 것이다. 도메인 로직은 `@acos/core`에 있고, 엔진과 저장소는
Port/Adapter 패턴으로 분리되어 있다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `OcrProvider` 인터페이스, `OcrRecognition`, `OcrRun`, `OcrRunStore` | `packages/core/src/ocr/ocr-provider.ts` |
| Domain (Service) | `OcrExecutionService` — 상태 전이 + 재시도 | `packages/core/src/ocr/ocr-execution.service.ts` |
| Adapter (Provider) | `MockOcrProvider`(기본), `TesseractOcrProvider`(로컬 엔진, 선택) | `packages/core/.../mock.provider.ts`, `apps/api/src/ocr/providers/` |
| Adapter (저장소) | `PrismaOcrRunStore` — `ocr_results` 테이블에 실행 이력 기록 | `apps/api/src/ocr/prisma-ocr-run.store.ts` |
| API | `OcrController`, `OcrService` | `apps/api/src/ocr/` |

## OCR 흐름

```
POST /images/:imageId/ocr
        │
        ▼
OcrService (apps/api)
  1. 이미지 존재 확인 (Prisma)
        │
        ▼
OcrExecutionService (@acos/core)          ← 도메인 로직, 프레임워크 무관
  2. OcrRunStore.start()                  → ocr_results에 RUNNING 레코드 생성 (startedAt 기록)
  3. 스토리지에서 이미지 로드              (실패 시 즉시 FAILED)
  4. OcrProvider.recognize() 호출
       실패 → 지수 백오프 재시도 (OCR_MAX_ATTEMPTS, 기본 3회)
  5-a. 성공 → OcrRunStore.markSuccess()   → SUCCESS + extractedText/confidence/rawJson/completedAt
  5-b. 최종 실패 → markFailed()           → FAILED + error/completedAt
        │
        ▼
OcrResultDto 응답
```

- 상태 전이: `PENDING → RUNNING → SUCCESS | FAILED`
- **실행할 때마다 새 레코드가 생성**되어 Image당 실행 이력이 1:N으로 쌓인다.
  `GET /images/:imageId/ocr`는 최신 1건, `.../ocr/history`는 전체 이력을 반환한다.

## Provider 교체 방법

Provider는 `OCR_PROVIDER` 환경 변수 하나로 선택된다. 선택 로직은
`apps/api/src/ocr/ocr.module.ts`의 팩토리 한 곳에만 존재한다.

```bash
OCR_PROVIDER=mock       # 기본값 — 실제 OCR 없이 테스트 JSON 반환
OCR_PROVIDER=tesseract  # 로컬 오프라인 엔진 (tesseract.js)
```

새 엔진 추가 절차 (공통):

1. `@acos/core`의 `OcrProvider` 인터페이스를 구현한 클래스를 만든다.
   반환값은 `OcrRecognition`(`text`, `confidence` 0~1, `raw` 원본 JSON)으로 정규화한다.
2. `ocr.module.ts`의 `createOcrProvider()`에 case를 추가한다.
3. `.env`의 `OCR_PROVIDER`를 새 이름으로 바꾼다.

상태 관리·재시도·저장은 전부 도메인 서비스가 처리하므로 **Provider는
"이미지 → 텍스트" 변환만 구현하면 된다.**

## 향후 Google Vision 연결 방법

```ts
// apps/api/src/ocr/providers/google-vision.provider.ts
import { ImageAnnotatorClient } from "@google-cloud/vision";
import type { OcrProvider, OcrRecognition } from "@acos/core";

export class GoogleVisionOcrProvider implements OcrProvider {
  readonly name = "google-vision";
  private readonly client = new ImageAnnotatorClient(); // GOOGLE_APPLICATION_CREDENTIALS 사용

  async recognize(image: Uint8Array): Promise<OcrRecognition> {
    const [response] = await this.client.textDetection({
      image: { content: Buffer.from(image) },
    });
    const annotation = response.fullTextAnnotation;
    const confidences =
      annotation?.pages?.flatMap((p) => p.blocks ?? []).map((b) => b.confidence ?? 0) ?? [];
    return {
      text: annotation?.text ?? "",
      confidence: confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : 0,
      raw: JSON.parse(JSON.stringify(response)), // 원본 응답 그대로 rawJson에 저장
    };
  }
}
```

1. `pnpm --filter api add @google-cloud/vision`
2. 서비스 계정 키를 발급받아 `GOOGLE_APPLICATION_CREDENTIALS` 환경 변수로 지정
3. `createOcrProvider()`에 `case "google-vision"` 추가 → `OCR_PROVIDER=google-vision`

## 향후 Azure 연결 방법

```ts
// apps/api/src/ocr/providers/azure-vision.provider.ts
import createClient from "@azure-rest/ai-vision-image-analysis";
import { AzureKeyCredential } from "@azure/core-auth";
import type { OcrProvider, OcrRecognition } from "@acos/core";

export class AzureVisionOcrProvider implements OcrProvider {
  readonly name = "azure-vision";
  private readonly client = createClient(
    process.env.AZURE_VISION_ENDPOINT as string,
    new AzureKeyCredential(process.env.AZURE_VISION_KEY as string),
  );

  async recognize(image: Uint8Array): Promise<OcrRecognition> {
    const result = await this.client.path("/imageanalysis:analyze").post({
      body: Buffer.from(image),
      queryParameters: { features: ["read"] },
      contentType: "application/octet-stream",
    });
    if (result.status !== "200") {
      throw new Error(`Azure Vision 오류: ${result.status}`);
    }
    const read = (result.body as { readResult?: { blocks?: Array<{ lines: Array<{ text: string; words: Array<{ confidence: number }> }> }> } }).readResult;
    const lines = read?.blocks?.flatMap((block) => block.lines) ?? [];
    const words = lines.flatMap((line) => line.words);
    return {
      text: lines.map((line) => line.text).join("\n"),
      confidence: words.length
        ? words.reduce((sum, word) => sum + word.confidence, 0) / words.length
        : 0,
      raw: result.body,
    };
  }
}
```

1. `pnpm --filter api add @azure-rest/ai-vision-image-analysis @azure/core-auth`
2. Azure Portal에서 Computer Vision 리소스 생성 후
   `AZURE_VISION_ENDPOINT` / `AZURE_VISION_KEY` 환경 변수 설정
3. `createOcrProvider()`에 `case "azure-vision"` 추가 → `OCR_PROVIDER=azure-vision`

AWS Textract(`@aws-sdk/client-textract`)와 Naver CLOVA OCR(REST API)도 같은
절차로 추가한다 — 인터페이스를 구현하고, case를 추가하고, 환경 변수로 선택한다.

## 데이터 모델 (ocr_results)

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | String (cuid) | PK |
| imageId | String (FK → images) | **1:N** — 이미지당 실행 이력 다건 |
| provider | String | 실행한 Provider 이름 (`mock`, `tesseract`, …) |
| status | enum | `PENDING` `RUNNING` `SUCCESS` `FAILED` |
| confidence | Float? | 0.0 ~ 1.0 |
| extractedText | String? | 추출된 텍스트 |
| rawJson | Json? | Provider 원본 응답 |
| error | String? | 실패 사유 |
| attempts | Int | Provider 호출 시도 횟수 |
| startedAt / completedAt | DateTime? | 실행 구간 |
| createdAt / updatedAt | DateTime | 감사 필드 |

## 테스트

- Unit: `packages/core/src/ocr/*.spec.ts` — 상태 전이, 재시도, 백오프, Mock Provider
- Service: `apps/api/src/ocr/ocr.service.spec.ts` — Prisma/Storage 목업으로 서비스 검증
- API: `apps/api/src/ocr/ocr.controller.spec.ts` — supertest로 HTTP 계약 검증

```bash
pnpm test   # turbo run test (core + api)
```
