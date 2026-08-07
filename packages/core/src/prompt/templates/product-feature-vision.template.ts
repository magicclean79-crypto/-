import type { ImageFeatureAnalysisContext } from "../../product-profile/image-feature-analysis";
import type { PromptTemplate } from "../prompt-engine";

export const PRODUCT_FEATURE_VISION_TEMPLATE_KEY = "product-feature-vision";

/**
 * 이미지 특징 분석 프롬프트 템플릿. (TASK-5601, Sprint 35 — Product Detail
 * Engine V1 STEP 3)
 *
 * 입력: ImageFeatureAnalysisContext (OCR 텍스트만 — Company Brain 없음,
 * Project 의존 없음. "사진만 넣으면"이 V1의 전제라 무거운 컨텍스트를
 * 요구하지 않는다)
 * 출력 계약: ImageFeatureAnalysis(material/color/structure/usage/
 *            components/notes/confidence) 형태의 JSON 객체 하나
 *
 * 이미지 바이트는 이 템플릿이 아니라 LLM Gateway 요청의 images(멀티모달
 * 첨부)로 전달된다(vision-analysis와 같은 원칙).
 */
export const PRODUCT_FEATURE_VISION_TEMPLATE: PromptTemplate<ImageFeatureAnalysisContext> =
  {
    key: PRODUCT_FEATURE_VISION_TEMPLATE_KEY,
    name: "이미지 특징 분석",
    description:
      "첨부된 상품 이미지를 직접 보고 재질·색상·구조·용도·구성품을 추출한다 (Product Detail Engine STEP 3)",
    build(context) {
      const systemLines = [
        "너는 이커머스 상세페이지 작성을 돕는 상품 이미지 분석 전문가다.",
        "이 요청에 첨부된 상품 이미지들을 직접 보고, 눈으로 확인되는 특징만 뽑는다.",
        "출력 규칙:",
        "- 모든 문자열 값은 한국어로 작성한다 — 이미지에서 영어 단어가 떠올라도 " +
          "한국어로 옮겨 쓴다. 고유 브랜드명·모델명 등 원문을 바꾸면 안 되는 " +
          "고유명사만 예외로 원문을 유지한다",
        "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
        "- 필드: material(재질, 문자열 또는 null) · color(색상, 문자열 또는 null) · " +
          "structure(구조/형태, 문자열 또는 null) · usage(용도, 문자열 또는 null) · " +
          "components(구성품 문자열 배열) · notes(그 외 특이사항, 문자열 또는 null) · " +
          "confidence(0.0~1.0 숫자)",
        "- 이미지에서 직접 확인되지 않는 정보는 절대로 만들어내지 않는다 — " +
          "불확실하면 해당 필드를 null(또는 빈 배열)로 두고 confidence를 낮춘다",
        "- 참고용 OCR 텍스트가 있으면 이미지 판단을 보강하는 데만 쓴다 — " +
          "OCR 오탈자를 그대로 특징으로 옮기지 않는다",
      ];

      const userSections: string[] = [];
      userSections.push(
        `## 첨부 이미지 수: ${context.imageCount} (이미지는 이 요청에 직접 첨부되어 있다)`,
      );

      if (context.ocrTexts.length > 0) {
        userSections.push("", "## 참고용 OCR 텍스트");
        context.ocrTexts.forEach((text, index) => {
          userSections.push(`### 이미지 ${index + 1}`, text);
        });
      }

      userSections.push(
        "",
        "첨부된 이미지를 직접 확인해 재질·색상·구조·용도·구성품을 담은 JSON 객체 하나만 출력해줘.",
      );

      return [
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userSections.join("\n") },
      ];
    },
  };
