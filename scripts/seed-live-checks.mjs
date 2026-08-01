#!/usr/bin/env node
/**
 * 라이브 검사에 필요한 최소 데이터. (TASK-4701, Sprint 47 — 지시 4)
 *
 * ## 왜 씨앗이 필요한가
 *
 * `scripts/live-checks.mjs`는 **실제로 도는 작업**을 봅니다. 그러려면 돌릴
 * 것이 있어야 합니다 — 이미지 몇 장과 그 파일. 빈 DB에서 그 검사를 돌리면
 * "검사에 쓸 것이 없습니다"로 끝나고, **그건 통과가 아니라 판정 불가**
 * 입니다(그래서 exit 2입니다).
 *
 * ## 씨앗은 최소여야 합니다
 *
 * 많이 심으면 검사가 **심어 둔 상태에 기대게** 됩니다. 여기서는 딱 셋만
 * 만듭니다: 프로젝트 1개 · 상품 1개 · 이미지 3장. 관리자는 API가 기동할
 * 때 스스로 만듭니다(`AUTH_ADMIN_EMAIL`).
 *
 * ## 무엇을 심지 않는가
 *
 * **성공한 OCR 기록을 심지 않습니다.** 심으면 "OCR이 되는가"를 검사가
 * 확인하지 않고 넘어가게 됩니다. 대신 검사가 직접 한 번 돌려서 만듭니다.
 *
 * 판정:
 *   exit 0 — 심었다 (또는 이미 있어서 아무것도 하지 않았다)
 *   exit 2 — 심지 못했다 — **통과로 처리하지 않는다**
 */

import { createRequire } from "node:module";

// Prisma Client는 `apps/api`의 의존성입니다. 저장소 뿌리에서는 보이지
// 않으므로 그쪽 기준으로 찾습니다 — `check-major-migrations.mjs`가
// `packages/core/dist`를 직접 읽는 것과 같은 방식입니다.
const requireFromApi = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const { PrismaClient } = requireFromApi("@prisma/client");

const S3_ENDPOINT = process.env.S3_ENDPOINT ?? "http://127.0.0.1:9000";
const S3_BUCKET = process.env.S3_BUCKET ?? "acos";
const WANT_IMAGES = 3;

/** 1x1 투명 PNG — 스텁이 읽을 수 있는 최소 파일 */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const prisma = new PrismaClient();

async function putObject(key) {
  const response = await fetch(`${S3_ENDPOINT}/${S3_BUCKET}/${key}`, {
    method: "PUT",
    headers: { "content-type": "image/png" },
    body: TINY_PNG,
  });
  if (!response.ok) {
    throw new Error(`객체를 올리지 못했습니다 (${key}): HTTP ${response.status}`);
  }
}

try {
  // 버킷이 없으면 만듭니다. 운영에서는 애플리케이션이 버킷을 만들지
  // 않습니다 — 여기는 검사용 저장소이고, 그 차이를 이 주석으로 남깁니다.
  await fetch(`${S3_ENDPOINT}/${S3_BUCKET}`, { method: "PUT" }).catch(() => null);

  const existing = await prisma.image.count();
  if (existing >= WANT_IMAGES) {
    // 이미 있으면 **파일만 확인**합니다. 행은 있는데 파일이 없으면
    // 검사가 "저장소 오류"를 만나고, 그건 작업 층의 문제가 아닙니다.
    const images = await prisma.image.findMany({ take: WANT_IMAGES });
    for (const image of images) {
      await putObject(image.key);
    }
    console.log(`[seed] 이미지 ${existing}장이 이미 있어 파일만 확인했습니다.`);
    process.exit(0);
  }

  const project = await prisma.project.create({
    data: { name: "라이브 검사", description: "TASK-4701 CI 라이브 검사용" },
  });
  const product = await prisma.product.create({
    data: { projectId: project.id, name: "검사용 상품", description: null },
  });

  for (let index = 0; index < WANT_IMAGES; index += 1) {
    const key = `images/live-checks/${project.id}-${index}.png`;
    await putObject(key);
    await prisma.image.create({
      data: {
        productId: product.id,
        projectId: project.id,
        key,
        // 공개 주소는 검사에 쓰이지 않지만 **비워 두지 않습니다** — 빈
        // 문자열과 "모른다"를 나중에 구별할 수 없게 됩니다.
        url: `${S3_ENDPOINT}/${S3_BUCKET}/${key}`,
        mimeType: "image/png",
        size: TINY_PNG.length,
        originalName: `live-${index}.png`,
      },
    });
  }

  console.log(`[seed] 프로젝트 1개 · 상품 1개 · 이미지 ${WANT_IMAGES}장을 심었습니다.`);
  process.exit(0);
} catch (error) {
  console.error(`[seed] 심지 못했습니다: ${String(error)}`);
  console.error("  심지 못한 것을 통과로 처리하지 않습니다.");
  process.exit(2);
} finally {
  await prisma.$disconnect();
}
