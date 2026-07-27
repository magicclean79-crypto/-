# AI 분석(Analysis) 아키텍처

상품 이미지 + OCR 텍스트로부터 **구조화된 상품 정보**(이름, 카테고리, 키워드,
설명, 속성, 신뢰도)를 추출하는 기능이다. OCR과 동일한 Port/Adapter 패턴을
사용하며, **실제 AI API는 연결되어 있지 않다** — 기본 Provider는
`MockAnalysisProvider`이고, Claude/OpenAI/Gemini 등은 아래 절차로 교체해
연결한다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `AnalysisProvider`, `AnalysisInput`, `ProductAnalysis`, `AnalysisRun`, `AnalysisRunStore` | `packages/core/src/analysis/analysis-provider.ts` |
| Domain (Service) | `AnalysisExecutionService` — 상태 전이 + 재시도 | `packages/core/src/analysis/analysis-execution.service.ts` |
| Adapter (Provider) | `MockAnalysisProvider`(기본) | `packages/core/src/analysis/providers/mock.provider.ts` |
| Adapter (저장소) | `PrismaAnalysisRunStore` — `analysis_results` 테이블 | `apps/api/src/analysis/prisma-analysis-run.store.ts` |
| API | `AnalysisController`, `AnalysisService` | `apps/api/src/analysis/` |

## 분석 흐름

```
POST /products/:productId/analysis   { apply?: boolean }
        │
        ▼
AnalysisService (apps/api)
  1. 상품 + 이미지 + 이미지별 최신 OCR SUCCESS 텍스트 조회
  2. AnalysisInput 구성 (이미지 바이트는 lazy 로더로 전달 — mock은 읽지 않음)
        │
        ▼
AnalysisExecutionService (@acos/core)     ← 도메인 로직, 프레임워크 무관
  3. AnalysisRunStore.start()             → analysis_results에 RUNNING 레코드
  4. AnalysisProvider.analyze() 호출
       실패 → 지수 백오프 재시도 (ANALYSIS_MAX_ATTEMPTS, 기본 3회)
  5-a. 성공 → markSuccess()               → SUCCESS + result/rawJson/completedAt
  5-b. 최종 실패 → markFailed()           → FAILED + error
        │
        ▼
  6. apply=true && SUCCESS → 상품 name/description 갱신 + applied=true
        │
        ▼
AnalysisResultDto 응답
```

- 상태 전이: `PENDING → RUNNING → SUCCESS | FAILED`
- **실행할 때마다 새 레코드**가 생성되어 Product당 이력이 1:N으로 쌓인다.

## Provider 교체 방법

`ANALYSIS_PROVIDER` 환경 변수 하나로 선택하며, 선택 로직은
`apps/api/src/analysis/analysis.module.ts`의 팩토리 한 곳에만 있다.

새 모델 추가 절차 (공통):

1. `@acos/core`의 `AnalysisProvider`를 구현한다 — 입력(`AnalysisInput`)을 받아
   `ProductAnalysis`로 정규화해 반환하면 된다. 상태 관리·재시도·저장·상품
   반영은 전부 도메인/서비스가 처리한다.
2. `createAnalysisProvider()`에 case를 추가한다.
3. `.env`의 `ANALYSIS_PROVIDER`를 새 이름으로 바꾼다.

## 향후 Claude 연결 방법

Claude API의 structured outputs를 사용하면 `ProductAnalysis` 스키마를
그대로 강제할 수 있어 파싱 코드가 필요 없다.

```ts
// apps/api/src/analysis/providers/claude.provider.ts
import Anthropic from "@anthropic-ai/sdk";
import type { AnalysisInput, AnalysisProvider, AnalysisRecognition } from "@acos/core";

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    category: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    description: { type: "string" },
    attributes: { type: "object", additionalProperties: false, properties: {} },
    confidence: { type: "number" },
  },
  required: ["name", "category", "keywords", "description", "attributes", "confidence"],
  additionalProperties: false,
} as const;

export class ClaudeAnalysisProvider implements AnalysisProvider {
  readonly name = "claude";
  private readonly client = new Anthropic(); // ANTHROPIC_API_KEY 사용

  async analyze(input: AnalysisInput): Promise<AnalysisRecognition> {
    const imageBlocks = await Promise.all(
      input.images.slice(0, 5).map(async (image) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: image.mimeType as "image/png",
          data: Buffer.from(await image.getBytes()).toString("base64"),
        },
      })),
    );

    const response = await this.client.messages.create({
      model: "claude-opus-5",
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: ANALYSIS_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            {
              type: "text",
              text: [
                "다음 상품 사진과 OCR 텍스트를 바탕으로 상품 정보를 추출해 주세요.",
                `기존 상품명: ${input.product.name}`,
                `OCR 텍스트:\n${input.ocrTexts.join("\n---\n")}`,
              ].join("\n\n"),
            },
          ],
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      throw new Error("Claude가 요청을 거부했습니다.");
    }
    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("Claude 응답에 텍스트가 없습니다.");
    }
    return {
      analysis: JSON.parse(text.text),
      raw: JSON.parse(JSON.stringify(response)),
    };
  }
}
```

1. `pnpm --filter api add @anthropic-ai/sdk`
2. `ANTHROPIC_API_KEY` 환경 변수 설정
3. `createAnalysisProvider()`에 `case "claude"` 추가 → `ANALYSIS_PROVIDER=claude`

## 향후 OpenAI 연결 방법

```ts
// apps/api/src/analysis/providers/openai.provider.ts — 개요
// 1. pnpm --filter api add openai
// 2. chat.completions(또는 responses API) + response_format: { type: "json_schema", ... }
//    으로 동일한 ANALYSIS_SCHEMA를 강제하고, 이미지 URL/base64를 content로 전달
// 3. createAnalysisProvider()에 case "openai" 추가 → ANALYSIS_PROVIDER=openai
```

Gemini 등 다른 모델도 동일하다 — **Provider는 "입력 → ProductAnalysis 변환"만
구현하면 되고**, 나머지는 아키텍처가 처리한다.

## 데이터 모델 (analysis_results)

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| id | String (cuid) | PK |
| productId | String (FK → products, Cascade) | **1:N** — 상품당 실행 이력 다건 |
| provider | String | `mock`, (향후) `claude`, `openai`, … |
| status | enum | `PENDING` `RUNNING` `SUCCESS` `FAILED` |
| result | Json? | 구조화된 `ProductAnalysis` |
| rawJson | Json? | Provider 원본 응답 |
| error | String? | 실패 사유 |
| attempts | Int | Provider 호출 시도 횟수 |
| applied | Boolean | 결과가 상품 name/description에 반영되었는지 |
| startedAt / completedAt | DateTime? | 실행 구간 |
| createdAt / updatedAt | DateTime | 감사 필드 |

## 테스트

- Unit: `packages/core/src/analysis/analysis.spec.ts` — Mock Provider, 상태 전이, 재시도
- Service: `apps/api/src/analysis/analysis.service.spec.ts` — OCR 텍스트 입력, apply 반영
- API: `apps/api/src/analysis/analysis.controller.spec.ts` — supertest HTTP 계약

```bash
pnpm test
```
