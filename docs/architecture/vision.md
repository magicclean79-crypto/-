# Vision 아키텍처

Product Object 조립 시 `visionSummary`를 공급하는 Vision 계층이다.
OCR([ocr.md](ocr.md))·AI 분석([analysis.md](analysis.md))과 동일한
Port/Adapter 패턴을 사용하며, **실제 Vision 모델은 연결되어 있지 않다** —
기본 Provider는 `MockVisionProvider`다.

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `VisionProvider`, `VisionInput`, `VisionRecognition` | `packages/core/src/vision/vision-provider.ts` |
| Adapter (Provider) | `MockVisionProvider`(기본) | `packages/core/src/vision/providers/mock.provider.ts` |
| 소비자 | `ProductObjectService` — 조립 시 visionSummary 공급 | `apps/api/src/product-object/` |

## 흐름

```
POST /projects/:projectId/product-object
        │
        ▼
ProductObjectService
  1. VisionInput 구성 — 프로젝트 정보 + 이미지(lazy 바이트 로더) + OCR 텍스트
  2. VisionProvider.analyze() 호출 (VISION_MAX_ATTEMPTS회 재시도, 기본 3)
       성공 → VisionSummary
       최종 실패 → null  ← Vision 실패는 조립을 막지 않는다 (graceful degradation)
  3. ProductObjectBuilder.withVisionSummary(...) 로 전달
       (null이면 제목은 OCR 첫 줄 → 프로젝트 이름으로 폴백)
```

- VisionSummary는 별도 테이블 없이 **ProductObject.visionSummary**(Json)에
  버전과 함께 저장된다 — 실행 기록이 곧 Product Object 버전 이력이다.
- `VisionSummary.source`에 Provider 이름이 남아 어떤 엔진이 생성했는지 추적된다.

## Provider 교체 방법

`VISION_PROVIDER` 환경 변수로 선택하며, 선택 로직은
`apps/api/src/product-object/product-object.module.ts`의 팩토리 한 곳에만 있다.

1. `@acos/core`의 `VisionProvider`를 구현한다 — 이미지 바이트는
   `image.getBytes()`로 필요할 때만 로드하고, 결과를 `VisionSummary`
   (labels/brand/category/suggestedTitle/confidence)로 정규화한다.
2. `createVisionProvider()`에 case를 추가한다.
3. `.env`의 `VISION_PROVIDER`를 새 이름으로 바꾼다.

## 향후 Claude Vision 연결 방법

Claude는 이미지 입력과 structured outputs를 지원하므로 VisionSummary
스키마를 그대로 강제할 수 있다. [analysis.md](analysis.md)의
`ClaudeAnalysisProvider` 예시와 동일한 형태로:

```ts
// apps/api/src/product-object/providers/claude-vision.provider.ts — 개요
// 1. pnpm --filter api add @anthropic-ai/sdk  (ANTHROPIC_API_KEY 필요)
// 2. client.messages.create({
//      model: "claude-opus-5",
//      output_config: { format: { type: "json_schema", schema: VISION_SUMMARY_SCHEMA } },
//      messages: [{ role: "user", content: [ ...imageBlocks(base64), { type: "text", text: prompt } ] }],
//    })
//    - imageBlocks: image.getBytes() → base64, media_type = image.mimeType
//    - prompt에 OCR 텍스트를 참고자료로 포함하면 정확도가 올라간다
// 3. 응답 stop_reason === "refusal" 처리 후 JSON.parse → { summary, raw } 반환
// 4. createVisionProvider()에 case "claude" 추가 → VISION_PROVIDER=claude
```

Google Vision(라벨/로고 감지) 등도 같은 절차다 — Provider는
"이미지 → VisionSummary 변환"만 구현하면 된다.

## 테스트

- Unit: `packages/core/src/vision/vision.spec.ts` — mock 결정성, lazy 바이트 로더
- Service: `apps/api/src/product-object/product-object.service.spec.ts` —
  Provider 주입, **실패 시 visionSummary null + 제목 폴백** 경로
- API: `apps/api/src/product-object/product-object.controller.spec.ts`

```bash
pnpm test
```
