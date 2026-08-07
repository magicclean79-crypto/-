import type { ProductProfileSynthesisContext } from "../../product-profile/product-profile";
import type { PromptTemplate } from "../prompt-engine";

export const PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY =
  "product-profile-synthesis";

/**
 * Product Profile 통합 프롬프트 템플릿. (TASK-5601, Sprint 35 — Product
 * Detail Engine V1 STEP 4)
 *
 * 입력: ProductProfileSynthesisContext (OCR 텍스트 + STEP 3 이미지 특징
 * 분석 결과). 이미지는 다시 첨부하지 않는다 — 이미지 판단은 STEP 3이 이미
 * 끝냈고, 여기서 다시 보면 같은 사실에 두 개의 답이 생길 수 있다. 이 단계는
 * 순수 텍스트 추론(OCR + STEP 3 JSON)으로 최종 Product Profile을 만든다.
 * 출력 계약: ProductProfile(productName/brand/model/material/features/
 *            specifications/usage/advantages/warnings/keywords/confidence)
 */
export const PRODUCT_PROFILE_SYNTHESIS_TEMPLATE: PromptTemplate<ProductProfileSynthesisContext> =
  {
    key: PRODUCT_PROFILE_SYNTHESIS_TEMPLATE_KEY,
    name: "Product Profile 통합",
    description:
      "OCR 텍스트 + 이미지 특징 분석을 하나의 Product Profile JSON으로 통합한다 (Product Detail Engine STEP 4)",
    build(context) {
      const systemLines = [
        "너는 이커머스 상세페이지 초안 작성을 돕는 상품 정보 통합 전문가다.",
        "주어진 OCR 텍스트와 이미지 특징 분석 결과만 근거로 삼아 하나의 Product Profile을 만든다.",
        "출력 규칙:",
        "- 모든 문자열 값(productName·features·usage·advantages·warnings·keywords 등)은 " +
          "한국어로 작성한다 — OCR·이미지 특징이 영어여도 한국어로 옮겨 쓴다. " +
          "고유 브랜드명·모델명 등 원문을 바꾸면 안 되는 고유명사만 예외로 원문을 유지한다",
        "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
        "- 필드: productName(문자열, 필수) · brand(문자열 또는 null) · " +
          "model(문자열 또는 null) · material(문자열 또는 null) · " +
          "features(특징 문자열 배열) · specifications(키-값 사양 객체) · " +
          "usage(사용법/용도, 문자열 또는 null) · advantages(장점 문자열 배열) · " +
          "warnings(주의사항 문자열 배열) · keywords(검색 키워드 문자열 배열) · " +
          "confidence(0.0~1.0 숫자)",
        "- 주어진 OCR·이미지 특징에서 근거를 찾을 수 없는 사실은 지어내지 않는다 — " +
          "알 수 없으면 null(또는 빈 배열)로 두고 confidence를 낮춘다",
        "- productName을 전혀 추론할 근거가 없을 때만 이미지 특징의 용도/재질로 " +
          "간단히 설명하는 이름을 짓는다 — 빈 문자열을 출력하지 않는다",
        "- advantages·warnings는 주어진 재질·구조·용도·구성품 사실에서 " +
          "합리적으로 도출되는 것만 적는다 — 과장된 마케팅 문구를 만들지 않는다",
      ];

      const userSections: string[] = [];
      userSections.push(`## 첨부 이미지 수: ${context.imageCount}`);

      if (context.ocrTexts.length > 0) {
        userSections.push("", "## OCR 텍스트");
        context.ocrTexts.forEach((text, index) => {
          userSections.push(`### 이미지 ${index + 1}`, text);
        });
      }

      userSections.push(
        "",
        "## 이미지 특징 분석 결과 (STEP 3)",
        "```json",
        JSON.stringify(context.imageFeatures, null, 2),
        "```",
        "",
        "위 OCR 텍스트와 이미지 특징 분석만 근거로 최종 Product Profile JSON 객체 하나만 출력해줘.",
      );

      return [
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userSections.join("\n") },
      ];
    },
  };
