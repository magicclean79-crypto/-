#!/usr/bin/env node
/**
 * T1-177 — 이미 저장된 ProductProfile.storyResult(캐노니컬 파이프라인 캐시)
 * 안의 아이콘 배지만, 지금 코드의 DESIGN_PROFILE canonical icon family
 * registry(`@acos/core`의 `familyIconMarkup`)로 다시 그린다.
 *
 * T1-173의 HERO 제거 스크립트와 같은 원칙 — LLM·이미지 생성 Provider를
 * 전혀 부르지 않는 순수 문자열 변환이다. 이미 렌더링된 HTML 안에서
 * 아이콘 배지(`<span class="pde-story-icon" ...>...</span>`)만 찾아
 * `familyIconMarkup(family, icon)` 결과로 치환한다 — 그 외 마크업(제품
 * 사진 data URI·본문 카피·섹션 순서·CSS 색상)은 1바이트도 건드리지
 * 않는다("Product identity 정보/이미지/section geometry 변경 금지").
 *
 * family/strokeWidth/size/linecap/linejoin은 저장된
 * `ProductProfile.designProfile`(T1-176 캐시)에서 읽는다 — 그 캐시가
 * T1-177 이전에 만들어졌다면 `icon.family` 필드가 없을 수 있는데, 그때는
 * 렌더러와 동일한 안전한 기본값(`technical-outline`)으로 취급한다
 * (product-story-html.ts의 `visualProfile?.icon.family ?? "technical-outline"`
 * 와 정확히 같은 fallback).
 *
 * 사용법:
 *   node scripts/t1177-rerender-icons-pure.mjs <productProfileId> [--dry-run]
 */

import { createRequire } from "node:module";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PrismaClient } = requireFromApi("@prisma/client");
const { familyIconMarkup } = requireFromApi("@acos/core");

/** product-story-html.ts의 applyIconStyleAttrs와 정확히 같은 속성 치환 — path data는 건드리지 않는다 */
function applyIconStyleAttrs(svg, style) {
  return svg
    .replace(/stroke-width="[\d.]+"/g, `stroke-width="${style.strokeWidth}"`)
    .replace(/width="\d+" height="\d+"/, `width="${style.size}" height="${style.size}"`)
    .replace(/stroke-linecap="(round|square|butt)"/g, `stroke-linecap="${style.linecap}"`)
    .replace(/stroke-linejoin="(round|miter|bevel)"/g, `stroke-linejoin="${style.linejoin}"`);
}

const BASELINE_ICON_STYLE = null; // 프로필이 없으면 family(technical-outline)의 원래 glyph를 그대로 쓴다(속성 오버라이드 없음) — 기존 baseline과 동일

function resolveIconRenderStyle(designProfile) {
  const family = designProfile?.icon?.family ?? "technical-outline";
  const override =
    designProfile?.icon &&
    typeof designProfile.icon.strokeWidth === "number" &&
    typeof designProfile.icon.size === "number"
      ? {
          strokeWidth: designProfile.icon.strokeWidth,
          size: designProfile.icon.size,
          linecap: designProfile.icon.linecap ?? "round",
          linejoin: designProfile.icon.linejoin ?? "round",
        }
      : BASELINE_ICON_STYLE;
  return { family, override };
}

// 두 가지 옛 형태(T1-142 이전 fallback-svg, T1-142 생성형 gemini-generative-design)를 모두 대상으로 한다.
const SCAN_RE =
  /<section[^>]*\sdata-icon="([a-z]+)"[^>]*>|<span class="pde-story-icon[^"]*" data-icon-source="(?:fallback-svg|gemini-generative-design)" aria-hidden="true">[\s\S]*?<\/span>/g;

function rerenderIcons(html, designProfile) {
  if (typeof html !== "string" || !html) return { html, replaced: 0 };
  const { family, override } = resolveIconRenderStyle(designProfile);
  let currentIcon = null;
  let replaced = 0;
  const next = html.replace(SCAN_RE, (match, sectionIcon) => {
    if (sectionIcon !== undefined) {
      currentIcon = sectionIcon;
      return match;
    }
    if (!currentIcon || currentIcon === "none") return match; // 배지가 있는데 섹션 아이콘을 못 찾은 방어적 경우 — 건드리지 않는다
    const glyph = familyIconMarkup(family, currentIcon);
    const styled = override ? applyIconStyleAttrs(glyph, override) : glyph;
    replaced += 1;
    return `<span class="pde-story-icon" data-icon-source="design-profile-svg" aria-hidden="true">${styled}</span>`;
  });
  return { html: next, replaced };
}

async function main() {
  const id = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!id) {
    console.error("사용법: node scripts/t1177-rerender-icons-pure.mjs <productProfileId> [--dry-run]");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const record = await prisma.productProfile.findUnique({
      where: { id },
      select: { id: true, html: true, css: true, storyResult: true, designProfile: true },
    });
    if (!record) {
      console.error(`NOT FOUND: ${id}`);
      process.exit(1);
    }
    if (!record.storyResult) {
      console.error(`storyResult가 없는 레코드입니다(캐노니컬 파이프라인 대상 밖): ${id}`);
      process.exit(1);
    }

    const designProfile = record.designProfile ?? null;
    console.log("designProfile.icon (raw, 갱신 전):", JSON.stringify(designProfile?.icon ?? null));

    const storyResult = record.storyResult;
    const topLevel = rerenderIcons(record.html, designProfile);
    const inStory = rerenderIcons(storyResult.html, designProfile);

    console.log("top-level html 아이콘 치환 수:", topLevel.replaced);
    console.log("storyResult.html 아이콘 치환 수:", inStory.replaced);

    if (topLevel.replaced === 0 && inStory.replaced === 0) {
      console.log("치환할 아이콘 배지를 찾지 못했습니다 — 아무것도 바꾸지 않았습니다.");
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
