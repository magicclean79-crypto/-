#!/usr/bin/env node
/**
 * Major Migration 교차 검증. (TASK-2101, Sprint 21 — CTO 결정 2001-③)
 *
 * 어떤 마이그레이션이 "대규모 변경"인지는 사람이 지정한다. 지정하는 길이
 * 둘이다:
 *   - 매니페스트 `apps/api/prisma/major-migrations.json`
 *   - 파일명 규칙 `_major_`
 *
 * 둘을 함께 두는 이유는 서로 다른 실수를 막기 때문이다. 매니페스트는 **잊기
 * 쉽고**(파일을 만들고 목록에 넣는 것을 잊는다), 파일명은 **되돌리기 쉽다**
 * (이름을 바꾸면 지정이 사라진다). 그래서 CI가 둘을 대조한다.
 *
 * 판정:
 *   exit 0 — 매니페스트와 파일명 규칙이 일치
 *   exit 1 — 어긋남 (한쪽에만 있는 지정이 있다)
 *   exit 2 — 판정 불가 (매니페스트/디렉터리를 읽지 못함)
 *
 * 판정할 수 없을 때 0을 돌려주면 검사가 있으나 마나 하다 — 확인하지 못한
 * 것은 통과가 아니다(체크리스트의 manual 처리와 같은 태도).
 *
 * 사용법: node scripts/check-major-migrations.mjs
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crossCheckMajorMigrations } from "../packages/core/dist/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRISMA_DIR = join(ROOT, "apps", "api", "prisma");

async function main() {
  let manifest;
  let migrationNames;

  try {
    const parsed = JSON.parse(
      await readFile(join(PRISMA_DIR, "major-migrations.json"), "utf8"),
    );
    manifest = Array.isArray(parsed.majorMigrations)
      ? parsed.majorMigrations
      : [];
  } catch (error) {
    console.error(
      `[major-migrations] 매니페스트를 읽지 못했습니다: ${error.message}`,
    );
    process.exit(2);
  }

  try {
    const entries = await readdir(join(PRISMA_DIR, "migrations"), {
      withFileTypes: true,
    });
    migrationNames = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (error) {
    console.error(
      `[major-migrations] 마이그레이션 디렉터리를 읽지 못했습니다: ${error.message}`,
    );
    process.exit(2);
  }

  const result = crossCheckMajorMigrations({ manifest, migrationNames });

  if (result.ok) {
    console.log(`[major-migrations] ${result.detail}`);
    if (result.effective.length > 0) {
      console.log(`  ${result.effective.join("\n  ")}`);
    }
    process.exit(0);
  }

  console.error(`[major-migrations] ${result.detail}`);
  console.error(
    "  지정이 조용히 사라지면 대규모 변경 후에도 복구 리허설이 요구되지 않습니다.",
  );
  process.exit(1);
}

await main();
