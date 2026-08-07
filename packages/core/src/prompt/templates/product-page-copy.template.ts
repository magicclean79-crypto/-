import type { ProductPageCopyContext } from "../../product-profile/product-page-copy";
import type { PromptTemplate } from "../prompt-engine";

export const PRODUCT_PAGE_COPY_TEMPLATE_KEY = "product-page-copy";

/**
 * 상세페이지 카피(대표 문구 + 제품 설명) 프롬프트 템플릿. (Sprint 35
 * Phase 2 — Product Detail Engine STEP 5)
 *
 * 입력: ProductPageCopyContext (STEP 4가 만든 Product Profile 하나만 —
 * 이미지 재첨부 없음, Company Brain 없음. "사진만 넣으면"이 V1의 전제를
 * STEP 5에서도 유지한다).
 * 출력 계약: ProductPageCopy(headline/description) 형태의 JSON 객체 하나.
 */
export const PRODUCT_PAGE_COPY_TEMPLATE: PromptTemplate<ProductPageCopyContext> =
  {
    key: PRODUCT_PAGE_COPY_TEMPLATE_KEY,
    name: "상세페이지 카피 생성",
    description:
      "Product Profile을 바탕으로 상세페이지 대표 문구와 제품 설명을 생성한다 (Product Detail Engine STEP 5)",
    build(context) {
      const { profile } = context;
      const systemLines = [
        "너는 이커머스 상세페이지 전문 카피라이터다.",
        "주어진 Product Profile(JSON)에 있는 사실만 근거로 삼아 대표 문구와 제품 설명을 쓴다.",
        "출력 규칙:",
        "- headline·description은 반드시 한국어로 작성한다 — Product Profile의 " +
          "필드 값이 영어여도 한국어로 옮겨 쓴다. 고유 브랜드명·모델명만 예외로 " +
          "원문을 유지한다",
        "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
        "- 필드: headline(짧고 강력한 한 줄, 상세페이지 최상단용) · " +
          "description(자연스러운 문단 형태의 제품 설명, 2~4문장)",
        "- Product Profile에 없는 효능·수치·최상급 표현을 지어내지 않는다",
        "- features·advantages·usage에 있는 사실을 자연스러운 문장으로 풀어 쓴다 — " +
          "필드를 그대로 나열하지 않는다",
      ];

      const userSections: string[] = [
        "## Product Profile",
        "```json",
        JSON.stringify(profile, null, 2),
        "```",
        "",
        "위 Product Profile만 근거로 headline과 description을 담은 JSON 객체 하나만 출력해줘.",
      ];

      return [
        { role: "system", content: systemLines.join("\n") },
        { role: "user", content: userSections.join("\n") },
      ];
    },
  };
