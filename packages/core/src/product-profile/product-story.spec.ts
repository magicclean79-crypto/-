import {
  assignStoryImages,
  buildLeftoverMediaGallery,
  parseProductStoryResponse,
  ProductStoryParseError,
  type ProductStory,
} from "./product-story";
import type { StudioSelectedImage } from "./product-page-images";

const validResponseText = JSON.stringify({
  productName: "베란다용 스텐 호스 세트 3M",
  narrativeSummary: "베란다 청소가 번거로운 상황에서 이 호스가 어떻게 도움이 되는지 설명하는 이야기.",
  sections: [
    {
      sectionId: "problem-context",
      purpose: "문제 제기",
      customerContext: "베란다 구석 물청소가 귀찮다",
      productFacts: ["3M 길이 호스"],
      keyMessage: "긴 호스로 구석까지 닿는다",
      imageRole: "USAGE_SCENE",
      imageFactsShown: ["베란다에서 호스로 물을 뿌리는 장면"],
      copy: "베란다 끝까지 손이 닿지 않아 청소를 미루게 되는 순간, 3M 길이의 호스가 그 거리를 채워줍니다.",
      transitionToNext: "이 호스가 어떤 구조로 그 거리를 만드는지 다음에서 보여준다",
    },
    {
      sectionId: "detail",
      purpose: "제품 디테일",
      customerContext: "실제로 어떻게 생겼는지 궁금하다",
      productFacts: ["스테인리스 분사기"],
      keyMessage: "스테인리스 분사기로 내구성을 확보했다",
      imageRole: "DETAIL",
      imageFactsShown: ["스테인리스 재질 분사기 손잡이"],
      copy: "분사기 손잡이는 스테인리스 재질로 만들어져 있습니다.",
      transitionToNext: "",
    },
  ],
});

describe("parseProductStoryResponse", () => {
  it("정상 JSON을 ProductStory로 파싱한다", () => {
    const story = parseProductStoryResponse(validResponseText, ["USAGE_SCENE", "DETAIL"]);
    expect(story.productName).toBe("베란다용 스텐 호스 세트 3M");
    expect(story.sections).toHaveLength(2);
    expect(story.sections[0].imageRole).toBe("USAGE_SCENE");
    expect(story.sections[1].transitionToNext).toBe("");
  });

  it("실제로 선택되지 않은 카테고리를 imageRole로 요구하면 NONE으로 강제한다", () => {
    const story = parseProductStoryResponse(validResponseText, ["DETAIL"]);
    // USAGE_SCENE은 available 목록에 없으므로 NONE으로 강제되어야 한다
    expect(story.sections[0].imageRole).toBe("NONE");
    expect(story.sections[0].imageFactsShown).toEqual([]);
    // DETAIL은 available이므로 그대로 유지
    expect(story.sections[1].imageRole).toBe("DETAIL");
  });

  it("JSON이 아닌 응답은 ProductStoryParseError를 던진다", () => {
    expect(() => parseProductStoryResponse("이것은 JSON이 아닙니다", [])).toThrow(ProductStoryParseError);
  });

  it("sections가 비어 있으면 오류를 던진다", () => {
    const text = JSON.stringify({ productName: "x", narrativeSummary: "y", sections: [] });
    expect(() => parseProductStoryResponse(text, [])).toThrow(ProductStoryParseError);
  });

  it("필수 필드가 빠진 section이 있으면 오류를 던진다", () => {
    const text = JSON.stringify({
      productName: "x",
      narrativeSummary: "y",
      sections: [{ sectionId: "a", purpose: "p" }],
    });
    expect(() => parseProductStoryResponse(text, [])).toThrow(ProductStoryParseError);
  });
});

function image(
  id: string,
  category: StudioSelectedImage["category"],
  version = 1,
  source: StudioSelectedImage["source"] = "generated",
): StudioSelectedImage {
  return { imageId: id, category, groupVersion: version, mimeType: "image/jpeg", base64: `fake-${id}`, source };
}

describe("assignStoryImages", () => {
  it("imageRole 카테고리에 맞는 실제 이미지를 배정한다", () => {
    const story: ProductStory = parseProductStoryResponse(validResponseText, ["USAGE_SCENE", "DETAIL"]);
    const available = [image("usage-1", "USAGE_SCENE"), image("detail-1", "DETAIL")];
    const assigned = assignStoryImages(story, available);
    expect(assigned[0].image?.imageId).toBe("usage-1");
    expect(assigned[1].image?.imageId).toBe("detail-1");
  });

  it("imageRole이 NONE인 섹션에는 이미지를 붙이지 않는다", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "a",
          purpose: "p",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "NONE",
          imageFactsShown: [],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    const assigned = assignStoryImages(story, [image("x", "HERO")]);
    expect(assigned[0].image).toBeNull();
  });

  it("같은 카테고리에 여러 장이 있으면 먼저 아직 안 쓴 이미지를 배정해 반복 사용을 최소화한다", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "a",
          purpose: "p1",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "DETAIL",
          imageFactsShown: ["f"],
          copy: "본문1",
          transitionToNext: "",
        },
        {
          sectionId: "b",
          purpose: "p2",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "DETAIL",
          imageFactsShown: ["f"],
          copy: "본문2",
          transitionToNext: "",
        },
      ],
    };
    const available = [image("d1", "DETAIL"), image("d2", "DETAIL")];
    const assigned = assignStoryImages(story, available);
    const usedIds = assigned.map((a) => a.image?.imageId);
    expect(new Set(usedIds).size).toBe(2);
  });

  it("요구한 카테고리에 실제 이미지가 하나도 없으면 image: null로 남긴다", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "a",
          purpose: "p",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "COMPONENTS",
          imageFactsShown: ["f"],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    const assigned = assignStoryImages(story, [image("h", "HERO")]);
    expect(assigned[0].image).toBeNull();
  });

  it("대표 이미지 배정 후 남은 같은 카테고리 이미지를 gallery에 채운다(T1-144)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 안내",
          customerContext: "c",
          productFacts: ["고무 패킹 2개"],
          keyMessage: "k",
          imageRole: "COMPONENTS",
          imageFactsShown: ["f"],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    const available = [
      image("c1", "COMPONENTS", 1, "real"),
      image("c2", "COMPONENTS", 1, "real"),
      image("c3", "COMPONENTS", 1, "real"),
    ];
    const assigned = assignStoryImages(story, available);
    expect(assigned[0].image?.imageId).toBe("c1");
    expect(assigned[0].gallery?.map((img) => img.imageId)).toEqual(["c2", "c3"]);
  });

  it("갤러리 채움은 다른 섹션의 대표 배정을 가로채지 않는다(T1-144 회귀)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "a",
          purpose: "p1",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "DETAIL",
          imageFactsShown: ["f"],
          copy: "본문1",
          transitionToNext: "",
        },
        {
          sectionId: "b",
          purpose: "p2",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "DETAIL",
          imageFactsShown: ["f"],
          copy: "본문2",
          transitionToNext: "",
        },
      ],
    };
    const available = [image("d1", "DETAIL"), image("d2", "DETAIL")];
    const assigned = assignStoryImages(story, available);
    // 두 섹션 모두 서로 다른 대표 이미지를 받아야 한다 — 갤러리 로직이
    // 두 번째 섹션의 대표 후보를 첫 번째 섹션의 갤러리로 먼저 소비하면
    // 안 된다.
    expect(assigned[0].image?.imageId).toBe("d1");
    expect(assigned[1].image?.imageId).toBe("d2");
    expect(assigned[0].gallery).toEqual([]);
    expect(assigned[1].gallery).toEqual([]);
  });

  it("구성품 역할은 실제 사진만 후보로 인정하고 생성 이미지는 배정하지 않는다(T1-144 요청 사양 6)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 안내",
          customerContext: "c",
          productFacts: ["고무 패킹 2개"],
          keyMessage: "k",
          imageRole: "COMPONENTS",
          imageFactsShown: ["f"],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    // COMPONENTS 카테고리에 생성 이미지만 있고 실제 사진이 없는 경우 —
    // 생성형 모델이 "그럴듯한" 구성품을 지어낸 이미지를 화면에 쓰지 않는다.
    const available = [image("gen-components", "COMPONENTS", 1, "generated")];
    const assigned = assignStoryImages(story, available);
    expect(assigned[0].image).toBeNull();
    expect(assigned[0].gallery).toEqual([]);
  });

  it("구성품 역할에 실제 사진과 생성 이미지가 섞여 있으면 실제 사진만 쓴다(T1-144)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 안내",
          customerContext: "c",
          productFacts: ["고무 패킹 2개"],
          keyMessage: "k",
          imageRole: "COMPONENTS",
          imageFactsShown: ["f"],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    const available = [
      image("gen-components", "COMPONENTS", 1, "generated"),
      image("real-components", "COMPONENTS", 1, "real"),
    ];
    const assigned = assignStoryImages(story, available);
    expect(assigned[0].image?.imageId).toBe("real-components");
    expect(assigned[0].gallery?.every((img) => img.source === "real")).toBe(true);
  });
});

describe("buildLeftoverMediaGallery", () => {
  it("어느 섹션에도 배정되지 못한 이미지를 남은 갤러리로 모은다(T1-144)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "a",
          purpose: "p1",
          customerContext: "c",
          productFacts: [],
          keyMessage: "k",
          imageRole: "HERO",
          imageFactsShown: ["f"],
          copy: "본문1",
          transitionToNext: "",
        },
      ],
    };
    const available = [image("hero-1", "HERO"), image("usage-1", "USAGE_SCENE"), image("usage-2", "USAGE_SCENE")];
    const assigned = assignStoryImages(story, available);
    const leftover = buildLeftoverMediaGallery(assigned, available);
    expect(leftover.map((entry) => entry.image.imageId).sort()).toEqual(["usage-1", "usage-2"]);
  });

  it("이미 대표/갤러리로 쓰인 이미지는 중복으로 넣지 않는다(T1-144)", () => {
    const story: ProductStory = {
      productName: "x",
      narrativeSummary: "y",
      sections: [
        {
          sectionId: "components",
          purpose: "구성품 안내",
          customerContext: "c",
          productFacts: ["고무 패킹 2개"],
          keyMessage: "k",
          imageRole: "COMPONENTS",
          imageFactsShown: ["f"],
          copy: "본문",
          transitionToNext: "",
        },
      ],
    };
    const available = [image("c1", "COMPONENTS", 1, "real"), image("c2", "COMPONENTS", 1, "real")];
    const assigned = assignStoryImages(story, available);
    const leftover = buildLeftoverMediaGallery(assigned, available);
    expect(leftover).toEqual([]);
  });
});
