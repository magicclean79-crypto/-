import type { ProductProfile } from "@acos/shared";
import {
  PRODUCT_PAGE_TEMPLATES,
  renderProductProfileHtml,
  wrapProductProfileHtmlDocument,
  type ProductPageImage,
} from "./product-page-html";

const profile: ProductProfile = {
  productName: "Magic Clean PVC 주방 매트",
  brand: "Magic Clean",
  model: "MC-100",
  material: "PVC",
  features: ["접이식"],
  specifications: { 두께: "5mm", 크기: "60x90cm" },
  usage: "주방 바닥에 깔아 사용",
  advantages: ["물세척 가능"],
  warnings: ["직사광선에 장시간 노출 금지"],
  keywords: ["주방매트"],
  confidence: 0.75,
};

const copy = {
  headline: "접어서 보관하는 PVC 주방 매트",
  description: "물세척이 가능한 접이식 PVC 매트로 주방 바닥을 깔끔하게 지켜줍니다.",
};

const photo = (seed: string): ProductPageImage => ({
  mimeType: "image/jpeg",
  base64: Buffer.from(`fake-bytes-${seed}`).toString("base64"),
});

describe("renderProductProfileHtml", () => {
  it("상품명·대표문구·설명을 포함한다", () => {
    const { html } = renderProductProfileHtml(profile, ["매트 본체"], copy, []);
    expect(html).toContain(profile.productName);
    expect(html).toContain(copy.headline);
    expect(html).toContain(copy.description);
  });

  it("features는 특징 섹션에, advantages는 구매 포인트 칩으로 분리해 담는다", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, []);
    expect(html).toContain(">특징<");
    expect(html).toContain("접이식");
    expect(html).toContain("pde-chip");
    expect(html).toContain("물세척 가능");
  });

  it("첫 사진을 Hero 배경으로 쓰고 나머지는 '이미지 갤러리' 섹션으로 보여준다", () => {
    const images = [photo("1"), photo("2"), photo("3")];
    const { html } = renderProductProfileHtml(profile, [], copy, images);

    expect(html).toContain("pde-hero--photo");
    expect(html).toContain(`data:image/jpeg;base64,${images[0].base64}`);
    expect(html).toContain("이미지 갤러리");
    expect(html).toContain("pde-gallery");
    expect(html).toContain(`data:image/jpeg;base64,${images[1].base64}`);
    expect(html).toContain(`data:image/jpeg;base64,${images[2].base64}`);
  });

  it("Hero 사진과 특징 사진은 클릭하면 원본 크기로 열리는 링크로 감싼다 ('확대사진')", () => {
    const withFeatureImage = { ...profile, features: ["접이식"] };
    const images = [photo("1")];
    const { html } = renderProductProfileHtml(withFeatureImage, [], copy, images);

    expect(html).toContain(`<a href="data:image/jpeg;base64,${images[0].base64}" target="_blank"`);
  });

  it("사진이 없으면 Hero는 그라디언트로 대체되고 갤러리는 생략된다", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, []);
    expect(html).not.toContain("pde-hero--photo");
    expect(html).not.toContain("pde-gallery");
  });

  it("상세 특징 카드마다 사진을 순환 배치한다 — 사진이 특징보다 적으면 재사용한다", () => {
    const manyFeatures = {
      ...profile,
      features: ["특징A", "특징B", "특징C"],
    };
    const images = [photo("1"), photo("2")];
    const { html } = renderProductProfileHtml(manyFeatures, [], copy, images);

    // 사진 1장당 base64가 최소 2회(특징 3개를 사진 2장으로 순환) 나타난다
    const firstPhotoOccurrences = html.split(images[0].base64).length - 1;
    expect(firstPhotoOccurrences).toBeGreaterThanOrEqual(2);
  });

  it("사진이 하나도 없으면 특징 카드는 체크 아이콘으로 대체된다", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, []);
    expect(html).toContain("pde-feature-media--icon");
  });

  it("브랜드·모델·재질·specifications를 스펙 체크포인트 박스에 담는다 (표 아님 — 시장 조사 반영)", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, []);
    expect(html).toContain("pde-spec-checklist");
    expect(html).not.toContain("<table");
    expect(html).toContain("Magic Clean");
    expect(html).toContain("MC-100");
    expect(html).toContain("PVC");
    expect(html).toContain("5mm");
    expect(html).toContain("60x90cm");
  });

  it("specifications의 값이 brand/model/material과 같으면 중복 행을 만들지 않는다", () => {
    const withDuplicateSpec: ProductProfile = {
      ...profile,
      specifications: { material: "PVC", 두께: "5mm" },
    };
    const { html } = renderProductProfileHtml(withDuplicateSpec, [], copy, []);
    const materialOccurrences = html.split(">PVC<").length - 1;
    expect(materialOccurrences).toBe(1);
    expect(html).toContain("5mm");
  });

  it("specifications의 값이 구성품과 같으면 스펙표에는 중복 행을 만들지 않는다", () => {
    const withDuplicateComponent: ProductProfile = {
      ...profile,
      specifications: { 구성품: "본체", 두께: "5mm" },
    };
    const { html } = renderProductProfileHtml(withDuplicateComponent, ["본체"], copy, []);
    const componentSpecOccurrences = html.split(">본체<").length - 1;
    // "구성품" 섹션의 <li>본체</li> 1회만 있어야 한다 — 스펙표에는 없어야 한다
    expect(componentSpecOccurrences).toBe(1);
    expect(html).toContain("5mm");
  });

  it("구성품이 있으면 구성품 섹션을 만든다", () => {
    const { html } = renderProductProfileHtml(profile, ["매트 본체", "고정 클립"], copy, []);
    expect(html).toContain("구성품");
    expect(html).toContain("고정 클립");
  });

  it("구성품이 없으면 구성품 섹션을 생략한다", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, []);
    expect(html).not.toContain("구성품");
  });

  it("advantages가 없으면 구매 포인트 섹션을 생략한다", () => {
    const { html } = renderProductProfileHtml({ ...profile, advantages: [] }, [], copy, []);
    expect(html).not.toContain("pde-chip");
  });

  it("usage가 있으면 사용 방법 섹션을 만들고 없으면 생략한다", () => {
    const withUsage = renderProductProfileHtml(profile, [], copy, []);
    expect(withUsage.html).toContain("사용 방법");

    const withoutUsage = renderProductProfileHtml(
      { ...profile, usage: null },
      [],
      copy,
      [],
    );
    expect(withoutUsage.html).not.toContain("사용 방법");
  });

  it("warnings가 있으면 주의사항 섹션을 만들고 없으면 생략한다", () => {
    const withWarnings = renderProductProfileHtml(profile, [], copy, []);
    expect(withWarnings.html).toContain("주의사항");
    expect(withWarnings.html).toContain("직사광선에 장시간 노출 금지");

    const withoutWarnings = renderProductProfileHtml(
      { ...profile, warnings: [] },
      [],
      copy,
      [],
    );
    expect(withoutWarnings.html).not.toContain("주의사항");
  });

  it("LLM이 만든 텍스트에 마크업이 있어도 이스케이프해 XSS를 막는다", () => {
    const malicious = {
      ...profile,
      productName: '<script>alert(1)</script>',
    };
    const { html } = renderProductProfileHtml(malicious, [], copy, []);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("css는 .pde-page 아래로 스코프되고 반응형 미디어 쿼리를 포함한다", () => {
    const { css } = renderProductProfileHtml(profile, [], copy, []);
    expect(css).toContain(".pde-page");
    expect(css).toContain("@media");
  });

  it("렌더링은 결정적이다", () => {
    const images = [photo("1")];
    const a = renderProductProfileHtml(profile, ["매트 본체"], copy, images);
    const b = renderProductProfileHtml(profile, ["매트 본체"], copy, images);
    expect(a).toEqual(b);
  });
});

describe("wrapProductProfileHtmlDocument", () => {
  it("fragment·css를 완전한 HTML 문서로 감싸고 keywords를 meta에 담는다", () => {
    const { html, css } = renderProductProfileHtml(profile, [], copy, []);
    const doc = wrapProductProfileHtmlDocument(
      profile.productName,
      html,
      css,
      profile.keywords,
    );
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<style>");
    expect(doc).toContain(html);
    expect(doc).toContain('name="keywords"');
    expect(doc).toContain(profile.keywords[0]);
  });

  it("keywords가 없으면 meta 태그를 생략한다", () => {
    const doc = wrapProductProfileHtmlDocument("제목", "<div></div>", "");
    expect(doc).not.toContain('name="keywords"');
  });
});

describe("생활용품 Template A~E (Sprint 36)", () => {
  const livingGoodsKeys = [
    "living-a-trust",
    "living-b-mood",
    "living-c-value",
    "living-d-proof",
    "living-e-minimal",
  ];

  it("BASIC 포함 6개 템플릿이 등록되어 있다", () => {
    expect(PRODUCT_PAGE_TEMPLATES.map((t) => t.key).sort()).toEqual(
      ["basic", ...livingGoodsKeys].sort(),
    );
  });

  it.each(livingGoodsKeys)("%s는 사진 없이도 렌더링되고 상품명·설명·구매포인트를 포함한다", (key) => {
    const { html, css } = renderProductProfileHtml(profile, ["매트 본체"], copy, [], key);
    expect(html).toContain(profile.productName);
    expect(html).toContain(copy.description);
    expect(html).toContain("물세척 가능");
    expect(css).toContain(".pde-page");
  });

  it.each(livingGoodsKeys)("%s는 사진이 있으면 Hero에 사진을 쓴다", (key) => {
    const { html } = renderProductProfileHtml(profile, [], copy, [photo("hero")], key);
    expect(html).toContain("pde-hero");
    expect(html).toMatch(/data:image\/jpeg;base64,/);
  });

  it("living-e-minimal은 스펙을 표/체크리스트가 아니라 접이식 아코디언으로 렌더링한다", () => {
    const { html } = renderProductProfileHtml(profile, [], copy, [], "living-e-minimal");
    expect(html).toContain("pde-spec-accordion");
    expect(html).toContain("<details");
    expect(html).not.toContain("<table");
  });

  it("각 템플릿은 서로 다른 CSS(색상 액센트)를 쓴다 — 진짜로 다른 템플릿인지 확인", () => {
    const cssByKey = livingGoodsKeys.map(
      (key) => renderProductProfileHtml(profile, [], copy, [], key).css,
    );
    const unique = new Set(cssByKey);
    expect(unique.size).toBe(livingGoodsKeys.length);
  });

  it("living-d-proof(CTO 확정 기준)는 사진1→설명→사진2→사용방법 순으로 사진과 텍스트를 섞어 배치하고, 스펙·구성품·주의사항은 하단에 모은다", () => {
    const twoPhotoProfile: ProductProfile = {
      ...profile,
      features: ["접이식", "미끄럼방지"],
    };
    const { html } = renderProductProfileHtml(
      twoPhotoProfile,
      ["매트 본체"],
      copy,
      [photo("a"), photo("b")],
      "living-d-proof",
    );
    const figure1 = html.indexOf("접이식");
    const descIdx = html.indexOf(copy.description);
    const figure2 = html.indexOf("미끄럼방지");
    const usageIdx = html.indexOf(profile.usage!);
    const specIdx = html.indexOf(">스펙<");
    expect(figure1).toBeGreaterThan(-1);
    expect(figure1).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(figure2);
    expect(figure2).toBeLessThan(usageIdx);
    expect(usageIdx).toBeLessThan(specIdx);
    expect(html).not.toContain(">특징<");
  });
});
