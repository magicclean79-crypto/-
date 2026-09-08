#!/usr/bin/env node
/**
 * T1-183 — 이미 저장된 ProductProfile.storyResult.story(과거에 실제로
 * 생성된 Story 카피, 재사용)를 지금 코드의 렌더러(hero 재도입/composition
 * 시스템/gallery canonical grid, product-story-html.ts)로 다시 그린다.
 * LLM/이미지 생성 Provider 호출 없음 — T1-175/176/177/182와 같은 패턴
 * (NestFactory.createApplicationContext + identifyProduct→
 * crossVerifyProduct→applyCrossVerifiedProfile→assignStoryImages→
 * planStoryDesign→buildLeftoverMediaGallery→foldLeftoverImagesIntoSections→
 * renderProductStoryHtml→buildProductFactsPanel 순수 render chain).
 *
 * T1-182와 다른 점 하나: composition family(hero/gallery/split 구조)는
 * LLM이 아니라 결정적 규칙(`selectCompositionFamily`, `@acos/core`)이 이미
 * DB에 있는 verified profile 필드에서 계산한다 — 추가 호출 없음. 계산된
 * composition은 `ProductProfile.designProfile.composition`에도 함께 저장해
 * 다음 조회부터 같은 값을 재사용한다(캐시 원칙, T1-176과 동일).
 *
 * 사용법: node scripts/t1183-rerender-composition-pure.mjs <productProfileId>
 */
import { createRequire } from "node:module";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { NestFactory } = requireFromApi("@nestjs/core");
const {
  identifyProduct,
  crossVerifyProduct,
  applyCrossVerifiedProfile,
  assignStoryImages,
  planStoryDesign,
  buildLeftoverMediaGallery,
  foldLeftoverImagesIntoSections,
  renderProductStoryHtml,
  buildProductFactsPanel,
  selectCompositionFamily,
  resolveComposition,
} = requireFromApi("@acos/core");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("사용법: node scripts/t1183-rerender-composition-pure.mjs <productProfileId>");
    process.exit(1);
  }

  const { AppModule } = requireFromApi("./dist/app.module.js");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const { PrismaService } = requireFromApi("./dist/prisma/prisma.service.js");
    const { ProductProfileService } = requireFromApi("./dist/product-profile/product-profile.service.js");
    const prisma = app.get(PrismaService);
    const service = app.get(ProductProfileService);

    const record = await prisma.productProfile.findUnique({ where: { id } });
    if (!record) throw new Error(`NOT FOUND: ${id}`);
    if (!record.storyResult?.story) throw new Error(`storyResult.story가 없습니다(캐노니컬 파이프라인 대상 밖): ${id}`);

    const profile = record.profile;
    const imageFeatures = record.imageFeatures;
    const identification = identifyProduct({
      ocrText: record.ocrText,
      visionText: imageFeatures ? JSON.stringify(imageFeatures) : null,
    });
    const crossVerification = crossVerifyProduct({ identification, profile });
    const verifiedProfile = applyCrossVerifiedProfile(profile, crossVerification);

    // loadSelectedDesignImages는 private 메서드다 — T1-182와 같은 이유로
    // StorageService 접근 로직을 중복 구현하지 않고 그대로 재사용한다.
    const availableImages = await service["loadSelectedDesignImages"](record.imageIds);
    if (availableImages.length === 0) throw new Error("선택된 이미지가 없습니다");

    const story = record.storyResult.story;

    // composition family — LLM 호출 없이 결정적 규칙으로 계산한다.
    const designDirectorInput = {
      productName: verifiedProfile.productName ?? "",
      brand: verifiedProfile.brand ?? null,
      material: verifiedProfile.material ?? null,
      features: verifiedProfile.features ?? [],
      specifications: verifiedProfile.specifications ?? {},
      usage: verifiedProfile.usage ?? null,
      advantages: verifiedProfile.advantages ?? [],
      keywords: verifiedProfile.keywords ?? [],
    };
    const compositionFamily = selectCompositionFamily(designDirectorInput);
    const composition = resolveComposition(compositionFamily);
    console.log("compositionFamily(결정적 규칙 계산 결과):", compositionFamily);

    const visualProfile = record.designProfile ? { ...record.designProfile, composition } : null;

    const assigned0 = assignStoryImages(story, availableImages);
    const designPlan = planStoryDesign(
      story,
      visualProfile ? { typography: visualProfile.typography, layoutAccent: visualProfile.layoutAccent } : undefined,
    );
    const mediaGallery = buildLeftoverMediaGallery(assigned0, availableImages);
    const assigned = foldLeftoverImagesIntoSections(assigned0, mediaGallery);
    let rendered = renderProductStoryHtml(story, assigned, designPlan, undefined, undefined, visualProfile);

    console.log("hero 블록 포함 여부(pde-story-hero-media):", rendered.html.includes("pde-story-hero-media"));

    const components = imageFeatures?.components ?? [];
    const factsPanel = buildProductFactsPanel({
      profile: verifiedProfile,
      identification,
      components,
    });
    if (factsPanel) {
      rendered = { html: rendered.html + factsPanel.html, css: `${rendered.css}\n${factsPanel.css}` };
    }

    const nextStoryResult = { ...record.storyResult, html: rendered.html, css: rendered.css };
    await prisma.productProfile.update({
      where: { id },
      data: {
        html: rendered.html,
        css: rendered.css,
        storyResult: nextStoryResult,
        designProfile: visualProfile ?? undefined,
      },
    });
    console.log("DB 갱신 완료:", id, "| html length:", rendered.html.length);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
