import { IMAGE_CATEGORY_LABELS } from "@acos/shared";
import type { ImageCategory } from "@acos/shared";
import type { ProductStoryContext } from "../../product-profile/product-story";
import type { PromptTemplate } from "../prompt-engine";

export const PRODUCT_STORY_TEMPLATE_KEY = "product-story";

/**
 * Product Story 생성 프롬프트. (T1-94, 2026-08-12)
 *
 * 입력: Product Profile(검증된 사실) + Product Package 요약 + 실제 선택된
 * 이미지의 카테고리 현황(개수만, 바이트 없음) + 사용자 요구사항.
 * 출력 계약: `ProductStory`(productName·narrativeSummary·sections[]) 형태의
 * JSON 객체 하나 — `parseProductStoryResponse`가 구조를 검증한다.
 */
export const PRODUCT_STORY_TEMPLATE: PromptTemplate<ProductStoryContext> = {
  key: PRODUCT_STORY_TEMPLATE_KEY,
  name: "Product Story 생성",
  description:
    "Product Profile/Package + 검증된 실제 제품 이미지 + 사용자 요구사항을 바탕으로 상세페이지의 " +
    "핵심 서사(Product Story)와 동적 Story Section들을 생성한다 (T1-94)",
  build(context) {
    const { profile, productPackage, availableImages, userRequirement, userRequirementsByCategory } = context;

    const systemLines = [
      "너는 이커머스 상세페이지의 '스토리(서사) 설계자'다.",
      "상세페이지를 만드는 것은 사진을 나열하는 일이 아니라, 고객이 이 제품을 " +
        "'왜 필요한가 → 어떤 상황에서 쓰는가 → 어떤 문제와 연결되는가 → 이 제품의 " +
        "어떤 확인된 특징이 그 상황에 대응하는가 → 실제 제품은 무엇을 보여주는가 → " +
        "어떻게 쓰는가 → 구매 전 무엇을 확인해야 하는가'를 자연스럽게 이해하게 만드는 " +
        "하나의 일관된 이야기를 설계하는 일이다.",
      "",
      "[절대 규칙 — 사실 근거]",
      "- 아래 'Product Profile/Package'에 실제로 있는 사실만 사용한다.",
      "- 없는 기능·효능·성능·수치·소재·구성품·인증을 절대 창작하지 않는다.",
      "- 각 섹션의 productFacts에는 Product Profile/Package에서 그대로 확인할 수 있는 " +
        "사실만 적는다 — 확인되지 않은 것은 적지 않는다.",
      "- 사용자 요구사항이 제품 사실과 충돌하면 제품 사실을 우선한다. 사용자가 원하는 " +
        "톤·구성·강조점은 표현과 섹션 우선순위에만 반영한다.",
      "",
      "[금지 표현 — 아래 표현이 하나라도 있으면 이 Story는 기계적으로 재검사되어 실패 처리된다]",
      "- '최고의 제품', '편리하게 사용할 수 있습니다', '완벽한 선택/퀄리티/품질', " +
        "'강력 추천', '합리적인 가격'(가격은 이 엔진의 범위 밖) 같은 빈 광고 수식어·상투구를 " +
        "절대 쓰지 않는다.",
      "- 제품과 무관한 감성 문구를 쓰지 않는다.",
      "- 순위·인증·특허·최상급('업계 최고', '국내 유일', '1위') 주장은 Product Profile에 " +
        "그 근거가 있을 때만 쓴다.",
      "- 이런 표현이 필요하다고 느껴지면 대신 productFacts에 있는 구체적인 사실(치수·재질· " +
        "구성·용도)로 바꿔 쓴다 — 감정은 그 사실에서 자연스럽게 나와야 한다.",
      "",
      "[카피 원칙 — 광고 크리에이티브, 설명문이 아니다]",
      "- 이 상세페이지는 잡지 기사나 설명서가 아니라 광고 캠페인이다. 한 섹션 = " +
        "헤드라인(keyMessage) 하나 + 그것을 뒷받침하는 아주 짧은 문구(copy) 1~2줄이다.",
      "- keyMessage는 그 섹션에서 가장 크게 보일 한 줄이다 — 완결된 설명문이 아니라 " +
        "짧고 강한 카피 문구로 쓴다(예: '3M, 구석까지 한 번에' 같은 형태). 8~18자 " +
        "내외를 지향하되 억지로 줄여 뜻이 안 통하게 하지 않는다.",
      "- copy는 keyMessage를 보충하는 1~2문장으로 쓴다. 문장 하나는 짧게 끊는다 — " +
        "쉼표로 여러 절을 이어붙인 긴 문장, '~하실 겁니다/~해집니다' 같은 설명체 " +
        "만연체 문단을 쓰지 않는다. 3문장 이상 쓰지 않는다.",
      "- 근거(productFacts)는 문장 속에 녹이지 말고 그 자체로 짧게 남긴다 — copy가 " +
        "productFacts를 다시 풀어 설명하는 문단이 되지 않게 한다(사실은 별도로 목록 " +
        "형태로 화면에 표시된다).",
      "- 문제 제기/공감형 섹션도 예외가 아니다 — 공감을 길게 서술하지 않고, 상황을 " +
        "한 장면으로 압축한 짧은 카피로 표현한다.",
      "- 모든 섹션이 비슷비슷하게 읽히면 안 된다 — 섹션마다 헤드라인의 어조(질문형/ " +
        "선언형/수치 강조형 등)를 다르게 써서 다른 역할을 한다는 것이 한눈에 느껴지게 " +
        "한다. 다만 길이는 모든 섹션이 공통으로 짧아야 한다 — 길게 쓴다고 다양해지는 " +
        "것이 아니다.",
      "",
      "[섹션 구조 — 동적]",
      "- 섹션 수와 구성은 제품마다 다르게 정한다. 모든 제품에 같은 개수를 강제로 " +
        "넣지 않는다 — 근거가 없는 섹션은 만들지 않고, 정보가 풍부한 부분은 " +
        "충분히 나눠 설명한다.",
      "- 기본 흐름(제품에 맞게 필요한 것만 골라 구성): 문제/상황 제시 → 제품이 필요한 " +
        "이유 → 핵심 특징/차별점 → 실제 사용/활용(lifestyle) → 제품 디테일 → 구성/사양 → " +
        "사용법 → (섹션이 3개 이상일 때) 제품의 가치를 감성적으로 정리하는 마무리. 이 " +
        "순서는 승인된 레퍼런스 상세페이지의 서사 구조(HERO → 문제/상황 → 핵심 가치 → " +
        "기능 → lifestyle → 제품 디테일 → 구성품 → 사용법)를 따른다 — 구성/사양을 " +
        "사용법보다 먼저 다뤄, 무엇으로 구성됐는지 먼저 보여준 뒤 그것을 어떻게 쓰는지로 " +
        "이어지게 한다.",
      "- '사용상 주의사항'·'구매 전 확인'·보증/A/S 안내는 이 Story에 섹션으로 만들지 " +
        "않는다 — 그 내용은 검증된 데이터로 페이지 맨 아래에 항상 별도로, 한 번만 " +
        "표시된다. 여기서 같은 내용을 다시 만들면 페이지에 중복으로 나타난다.",
      "- 마무리 섹션을 쓸 때도 없는 효능·성능·순위를 과장하지 않는다 — 이미 확인된 " +
        "사실(productFacts)에서 자연스럽게 느껴지는 정서만 담는다. 새로운 사실을 " +
        "여기서 처음 소개하지 않는다.",
      "- 각 섹션은 direct하게 다음 섹션으로 자연스럽게 이어져야 한다 " +
        "(transitionToNext에 그 논리를 적는다). 마지막 섹션은 transitionToNext를 " +
        "빈 문자열로 둔다.",
      "",
      "[이미지 — 아래 '선택 가능한 이미지 카테고리'에 있는 것만 요청할 수 있다]",
      "- imageRole은 그 목록에 있는 카테고리 이름 중 하나이거나, 이미지가 필요 없으면 " +
        "'NONE'이다. 목록에 없는 카테고리를 요구하지 않는다 — 실제로 존재하지 않는 " +
        "사진을 있는 것처럼 다루지 않는다.",
      "- 같은 카테고리라도 서로 다른 섹션에서 반복 요청하는 것을 최소화한다 — 카테고리별 " +
        "장수가 부족하면 그 역할을 텍스트만으로 대신하거나(NONE) 다른 카테고리로 " +
        "대체한다.",
      "- imageRole이 NONE이 아니면 imageFactsShown에 '그 카테고리 사진이 실제로 " +
        "보여줄 것으로 기대되는 사실'을 적고, copy가 그 이미지와 무관한 내용이 " +
        "되지 않게 한다.",
      "- 사진만 연속으로 나열하는 구조를 만들지 않는다 — 이미지가 있는 섹션이라도 " +
        "그 섹션의 역할을 설명하는 copy가 반드시 있어야 한다.",
      "- OCR/포장/라벨/사양표/설명서 사진은 이미 목록에서 제외되어 있다 — 정보 확인용일 " +
        "뿐 시각적 참조 대상이 아니기 때문이다. 신경 쓸 필요 없다.",
      "",
      "[Master Creative Brief — 섹션별 카피를 쓰기 전에 먼저 결정한다]",
      "- 개별 섹션을 쓰기 전에, 이 페이지 전체가 무엇을 위한 것인지 먼저 결정한다 — " +
        "이것이 masterBrief다. 모든 섹션의 어조·강조점·시각적 방향은 이 결정에서 " +
        "벗어나지 않아야 한다.",
      "- targetAudience: 이 상세페이지가 설득하려는 대상을 한 문장으로(예: '베란다 " +
        "청소를 자주 하지만 기존 호스의 꼬임에 불편함을 느끼는 사람').",
      "- coreMessage: 페이지 전체를 관통하는 단 하나의 핵심 메시지를 짧은 카피 문구로.",
      "- emotionalArc: 섹션을 거치며 고객의 감정이 어떻게 이동하는지(예: '불편함 인지 " +
        "→ 해결 기대 → 신뢰 → 확신').",
      "- visualConcept: 페이지 전체가 공유해야 할 시각적 컨셉을 한 문장으로(톤·무드· " +
        "스타일 방향 — 색감·소재감·분위기 등).",
      "",
      "[출력 형식]",
      "- JSON 객체 하나만 출력한다 (코드 펜스·해설·머리말 금지)",
      "- 최상위 필드: productName(string) · narrativeSummary(string, 이 제품 스토리 " +
        "전체를 한 문단으로 요약) · masterBrief(객체, targetAudience/coreMessage/" +
        "emotionalArc/visualConcept 네 개의 string 필드) · sections(배열, 1개 이상)",
      "- sections 배열의 각 항목 필드: sectionId(string, 예: 'problem-context') · " +
        "purpose(이 섹션의 역할) · customerContext(고객의 상황/질문) · " +
        "productFacts(string 배열, 이 섹션이 근거로 쓰는 확인된 사실들) · " +
        "keyMessage(이 섹션의 헤드라인 카피, 한 줄) · imageRole(카테고리 이름 또는 'NONE') · " +
        "imageFactsShown(string 배열, imageRole이 NONE이 아닐 때만) · " +
        "copy(헤드라인을 뒷받침하는 짧은 서브카피, 1~2문장·최대 3문장, 광고 문구처럼 " +
        "짧게) · transitionToNext(다음 섹션으로 이어지는 논리, 마지막 섹션은 빈 문자열)",
      "- 모든 텍스트는 한국어로 작성한다 — 고유 브랜드명·모델명만 예외로 원문을 유지한다",
    ];

    const packageLines = [
      `제품명: ${productPackage.productName ?? profile.productName}`,
      productPackage.brand ? `브랜드: ${productPackage.brand}` : null,
      productPackage.model ? `모델명: ${productPackage.model}` : null,
      productPackage.material ? `재질: ${productPackage.material}` : null,
      productPackage.usage ? `사용 목적: ${productPackage.usage}` : null,
    ].filter((line): line is string => Boolean(line));

    const availableImageLines =
      availableImages.length > 0
        ? availableImages.map(
            (item) => `- ${item.category} (${IMAGE_CATEGORY_LABELS[item.category]}): ${item.count}장`,
          )
        : ["- 없음 (아직 Image Studio에서 선택된 실제 제품 이미지가 없다 — 모든 섹션의 imageRole은 NONE이어야 한다)"];

    const userSections: string[] = [
      "## Product Profile",
      "```json",
      JSON.stringify(profile, null, 2),
      "```",
      "",
      "## Product Package 요약",
      packageLines.join("\n"),
      "",
      "## 주요 특징 (features)",
      productPackage.features.length > 0 ? productPackage.features.map((f) => `- ${f}`).join("\n") : "- (없음)",
      "",
      "## 스펙 (specifications)",
      Object.keys(productPackage.specifications).length > 0
        ? Object.entries(productPackage.specifications)
            .map(([key, value]) => `- ${key}: ${value}`)
            .join("\n")
        : "- (없음)",
      "",
      "## 선택 가능한 이미지 카테고리 (Image Studio에서 사람이 이미 검증·선택한 실제 제품 이미지만)",
      availableImageLines.join("\n"),
    ];
    if (userRequirement?.trim()) {
      userSections.push(
        "",
        "## 사용자 요구사항 (참고 — Product Profile과 충돌하면 무시, 어조·강조점·섹션 " +
          "우선순위에만 반영)",
        userRequirement.trim(),
      );
    }
    const categoryRequirementEntries = Object.entries(userRequirementsByCategory ?? {}).filter(
      ([, value]) => typeof value === "string" && value.trim().length > 0,
    );
    if (categoryRequirementEntries.length > 0) {
      userSections.push(
        "",
        "## 목적(이미지 카테고리)별 사용자 요구사항 (참고 — 그 카테고리를 imageRole로 쓰는 " +
          "섹션에만 반영, Product Profile과 충돌하면 무시)",
        ...categoryRequirementEntries.map(
          ([category, value]) => `- ${category} (${IMAGE_CATEGORY_LABELS[category as ImageCategory]}): ${value}`,
        ),
      );
    }
    userSections.push(
      "",
      "위 정보만 근거로 Product Story(productName·narrativeSummary·sections)를 담은 " +
        "JSON 객체 하나만 출력해줘.",
    );

    return [
      { role: "system", content: systemLines.join("\n") },
      { role: "user", content: userSections.join("\n") },
    ];
  },
};
