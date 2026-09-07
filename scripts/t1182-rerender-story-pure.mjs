#!/usr/bin/env node
/**
 * T1-182 — 이미 저장된 ProductProfile.storyResult.story(과거에 실제로
 * 생성된 Story 카피, 재사용)를 지금 코드의 렌더러(product-story-html.ts·
 * product-story-facts-panel.ts)로만 다시 그린다. LLM/이미지 생성 Provider
 * 호출 없음 — T1-175/176/177과 같은 패턴(NestFactory.createApplicationContext
 * + identifyProduct→crossVerifyProduct→applyCrossVerifiedProfile→
 * assignStoryImages→planStoryDesign→buildLeftoverMediaGallery→
 * foldLeftoverImagesIntoSections→renderProductStoryHtml→
 * buildProductFactsPanel 순수 render chain).
 *
 * 사용법: node scripts/t1182-rerender-story-pure.mjs <productProfileId>
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
} = requireFromApi("@acos/core");

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error("사용법: node scripts/t1182-rerender-story-pure.mjs <productProfileId>");
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

    // loadSelectedDesignImages는 private 메서드다 — 이 스크립트는 T1-175/
    // 176/177과 같은 일회성 재렌더 스크립트이므로, 실제 저장소(StorageService)
    // 접근 로직을 중복 구현하지 않고 이미 검증된 그 메서드를 그대로 재사용한다.
    const availableImages = await service["loadSelectedDesignImages"](record.imageIds);
    if (availableImages.length === 0) throw new Error("선택된 이미지가 없습니다");

    const story = record.storyResult.story;
    const visualProfile = record.designProfile ?? null;

    const assigned0 = assignStoryImages(story, availableImages);
    const designPlan = planStoryDesign(
      story,
      visualProfile ? { typography: visualProfile.typography, layoutAccent: visualProfile.layoutAccent } : undefined,
    );
    const mediaGallery = buildLeftoverMediaGallery(assigned0, availableImages);
    const assigned = foldLeftoverImagesIntoSections(assigned0, mediaGallery);
    let rendered = renderProductStoryHtml(story, assigned, designPlan, undefined, undefined, visualProfile);

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
