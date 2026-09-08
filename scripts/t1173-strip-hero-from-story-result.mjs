#!/usr/bin/env node
/**
 * T1-173 — 이미 저장된 ProductProfile.storyResult(캐노니컬 파이프라인 캐시)에서
 * HERO 블록(<header class="pde-hero...">...</header>)만 걷어낸다.
 *
 * 프로그램 렌더러(packages/core/src/product-profile/product-story-html.ts)는
 * 이번 작업에서 이미 HERO를 더 이상 만들지 않도록 고쳤다. 하지만 이 레코드는
 * 그 수정 "전" 코드로 이미 렌더링돼 DB에 캐시돼 있고(`/final-html`은 이
 * 캐시를 그대로 돌려준다 — apps/api/src/product-profile/product-profile.service.ts
 * L389-409), `POST /:id/story`를 다시 부르지 않는 한(=LLM/이미지 생성 재호출,
 * 이번 작업에서 금지) 자동으로 새로 렌더링되지 않는다.
 *
 * 이 스크립트는 LLM·이미지 생성 Provider를 전혀 부르지 않는다 — 이미 저장된
 * html/css 문자열에서 <header class="pde-hero...">...</header> 구간만
 * 정규식으로 제거하는 순수 문자열 조작이다. renderProductStoryHtml()이
 * 앞으로 만들 출력과 동일한 효과(그 구간이 통째로 사라짐)를 이미 생성된
 * 텍스트에 그대로 적용할 뿐이며, HERO 이후의 모든 마크업(story-summary,
 * 각 섹션, facts panel)은 단 1바이트도 건드리지 않는다 — "다른 섹션에
 * 영향이 없다"는 요구를 문자열 수준에서 보장한다.
 *
 * 사용법:
 *   DATABASE_URL=... node scripts/t1173-strip-hero-from-story-result.mjs <productProfileId> [--dry-run]
 */

import { createRequire } from "node:module";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");

const HERO_RE = /<header class="pde-hero[^>]*>[\s\S]*?<\/header>/;

function stripHero(html) {
  if (typeof html !== "string") return { html, removed: false };
  const match = html.match(HERO_RE);
  if (!match) return { html, removed: false };
  return { html: html.slice(0, match.index) + html.slice(match.index + match[0].length), removed: true };
}

async function main() {
  const id = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!id) {
    console.error("사용법: node scripts/t1173-strip-hero-from-story-result.mjs <productProfileId> [--dry-run]");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const record = await prisma.productProfile.findUnique({
      where: { id },
      select: { id: true, html: true, css: true, storyResult: true },
    });
    if (!record) {
      console.error(`NOT FOUND: ${id}`);
      process.exit(1);
    }
    if (!record.storyResult) {
      console.error(`storyResult가 없는 레코드입니다(레거시 렌더러 대상 밖): ${id}`);
      process.exit(1);
    }

    const storyResult = record.storyResult;
    const topLevel = stripHero(record.html);
    const inStory = stripHero(storyResult.html);

    console.log("top-level html hero removed:", topLevel.removed, "| before/after len:", record.html?.length, "->", topLevel.html?.length);
    console.log("storyResult.html hero removed:", inStory.removed, "| before/after len:", storyResult.html?.length, "->", inStory.html?.length);

    if (!topLevel.removed && !inStory.removed) {
      console.log("제거할 HERO 블록을 찾지 못했습니다 — 이미 제거됐거나 다른 구조입니다. 아무것도 바꾸지 않았습니다.");
      return;
    }

    if (dryRun) {
      console.log("--dry-run: DB에 쓰지 않았습니다.");
      return;
    }

    const nextStoryResult = { ...storyResult, html: inStory.html, css: storyResult.css };

    await prisma.productProfile.update({
      where: { id },
      data: {
        html: topLevel.html,
        css: record.css,
        storyResult: nextStoryResult,
      },
    });
    console.log("DB 갱신 완료:", id);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
