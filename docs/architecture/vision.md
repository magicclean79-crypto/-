# Vision 아키텍처

Product Object 조립 시 `visionSummary`를 공급하는 Vision 계층이다.

**TASK-0505(Sprint 5 — AI Execution)에서 공식 Vision 엔진이 LLM 기반
멀티모달로 교체되었다.** 구 `MockVisionProvider`(이미지를 읽지 않는 단독
mock)는 제거되었고, 공식 엔진 `LlmVisionProvider`가 CTO 지시대로 네 가지를
사용한다:

1. **Image Bytes** — `getBytes()`로 원본을 읽어 base64로 LLM 요청에 첨부 (최대 5장)
2. **Prompt Engine** — `vision-analysis` 템플릿 렌더링 (TASK-0503)
3. **LLM Gateway** — `images` + `responseFormat: "json"` 호출 (TASK-0501)
4. **Company Brain** — 프로젝트 이름 기준 지식/결정/설정 컨텍스트 (Sprint 4)

모델 선택은 **`LLM_PROVIDER` 환경 변수 하나**로 관리된다(기본 mock — 실제
API 미호출). `VISION_PROVIDER` 환경 변수는 제거되었다.
**VisionSummary 모델(source/labels/brand/category/suggestedTitle/confidence)은
변경 없이 유지된다** (CTO 지시).

## 구성 요소

| 계층 | 구성 요소 | 위치 |
| --- | --- | --- |
| Domain (Port) | `VisionProvider`, `VisionInput`, `VisionRecognition` | `packages/core/src/vision/vision-provider.ts` |
| Domain (공식 엔진) | `LlmVisionProvider` — Image Bytes + Prompt Engine + LLM Gateway + Company Brain | `packages/core/src/vision/llm-vision.provider.ts` |
| Domain (계약) | `VisionAnalysisContext` · `buildDraftVisionSummary` · `parseVisionSummaryResponse` | `packages/core/src/vision/vision-analysis.ts` |
| Prompt 템플릿 | `vision-analysis` (초안 JSON 포함) | `packages/core/src/prompt/templates/vision-analysis.template.ts` |
| Adapter (Company Brain) | `createVisionCompanyBrainSource` — CompanyBrainService 연결 | `apps/api/src/product-object/vision-company-brain.ts` |
| 소비자·DI 조립 | `ProductObjectService` / `ProductObjectModule` | `apps/api/src/product-object/` |

## 흐름

```
POST /projects/:projectId/product-object
        │
        ▼
ProductObjectService
  1. VisionInput 구성 — 프로젝트 정보 + 이미지(lazy 바이트 로더) + OCR 텍스트
  2. LlmVisionProvider.analyze()          ← 공식 엔진 (TASK-0505)
       2-a. Company Brain 조회 — 프로젝트 이름 질의, PROJECT 스코프
       2-b. 이미지 바이트 로드 → base64 (상한: VISION_MAX_IMAGES 환경 변수,
            기본 5장 — CTO 결정(0505 승인 ①), 초과분은 raw.omittedImageCount로 기록)
       2-c. PromptEngine.render("vision-analysis", context)
            → 규칙 기반 초안 JSON을 포함한 system+user 메시지
       2-d. LLM Gateway complete({ messages, images, responseFormat: "json" })
            → 어댑터가 이미지를 Provider별 형식으로 매핑 (llm.md 참고)
       2-e. parseVisionSummaryResponse() — 엄격 파싱, source는 Provider가 채움
     (VISION_MAX_ATTEMPTS회 재시도, 기본 3)
       성공 → VisionSummary (source "llm:<provider>", 예: llm:mock)
       최종 실패 → null  ← Vision 실패는 조립을 막지 않는다 (graceful degradation)
  3. ProductObjectBuilder.withVisionSummary(...) 로 전달
       (null이면 제목은 OCR 첫 줄 → 프로젝트 이름으로 폴백)
```

- VisionSummary는 별도 테이블 없이 **ProductObject.visionSummary**(Json)에
  버전과 함께 저장된다 — 실행 기록이 곧 Product Object 버전 이력이다.
- `VisionSummary.source`에 `llm:<LLM Provider>`가 남아 어떤 엔진이 생성했는지
  추적된다 (기존 버전의 `"mock"` 이력은 그대로 보존).

## 초안(Draft) + 검증·보강 설계 (Analysis와 동일 패턴)

프롬프트에는 `buildDraftVisionSummary()`가 만든 **규칙 기반 초안 JSON**
(OCR 첫 줄 단어 → labels/suggestedTitle, category "미분류", confidence 0.3)이
포함된다.

- **실제 모델**: 첨부된 이미지를 직접 보고 초안을 검증·보강한 최종 JSON을 출력
- **mock LLM**: 이미지를 해석하지 않고(개수만 raw 기록) 프롬프트의 마지막
  ```json 블록(= 초안)을 그대로 반환 — **키 없는 오프라인 환경에서도 전체
  파이프라인이 결정적으로 동작**한다

응답 파싱(`parseVisionSummaryResponse`)은 엄격하다: JSON 객체를 찾지 못하거나
`labels`가 비어 있으면 오류 → 재시도 → **null 폴백**(조립은 계속).
나머지 필드는 보정된다 (brand/category/suggestedTitle null · confidence 클램프).

## 모델 교체 방법

Vision 모델 선택은 LLM Gateway에 위임되었다 — `LLM_PROVIDER` 환경 변수로
openai/anthropic/gemini를 선택하면 Vision도 해당 모델을 사용하며, 어댑터가
이미지를 각 Provider의 멀티모달 형식(content block / image_url / inlineData)으로
전달한다 (docs/architecture/llm.md). Vision 전용 절차가 더는 필요 없다.
프롬프트를 바꾸려면 `vision-analysis` 템플릿을 수정하면 된다(코드 선언,
결정적 단위 테스트).

## 테스트

- Unit: `packages/core/src/vision/vision.spec.ts` — LlmVisionProvider(mock LLM
  경로, base64 첨부·최대 5장 제한, Company Brain 반영, 파싱 실패 reject)
- Unit: `packages/core/src/vision/vision-analysis.spec.ts` — 초안 규칙, 응답
  파서, `vision-analysis` 템플릿 렌더링
- Service: `apps/api/src/product-object/product-object.service.spec.ts` —
  Provider 주입, **실패 시 visionSummary null + 제목 폴백** 경로
- API: `apps/api/src/product-object/product-object.controller.spec.ts`

```bash
pnpm test
```
