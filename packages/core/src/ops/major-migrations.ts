/**
 * Major Migration 지정. (TASK-2101, Sprint 21 — CTO 결정 2001-③)
 *
 * 어떤 마이그레이션이 "대규모 변경"인지는 코드가 알 수 없다. 컬럼 하나
 * 추가하는 것과 주문 테이블을 쪼개는 것은 파일 모양이 같다. 그래서 사람이
 * 지정한다.
 *
 * 지정하는 길이 둘이다:
 * - **매니페스트** `prisma/major-migrations.json` (TASK-2001부터)
 * - **파일명 규칙** `_major_`를 포함하는 마이그레이션 이름
 *
 * 둘을 함께 두는 이유는 서로 다른 실수를 막기 때문이다. 매니페스트는 **잊기
 * 쉽고**(파일을 만들고 목록에 넣는 것을 잊는다), 파일명은 **되돌리기 쉽다**
 * (이름을 바꾸면 지정이 사라진다). 그래서 **교차 검증**한다 — 한쪽에만 있는
 * 것은 둘 중 하나를 빠뜨린 것이고, CI가 그걸 잡는다.
 */

/** 파일명 규칙 (CTO 결정 2001-③) */
export const MAJOR_MIGRATION_NAME_PATTERN = /_major_/;

export function isMajorMigrationName(name: string): boolean {
  return MAJOR_MIGRATION_NAME_PATTERN.test(name);
}

export interface MajorMigrationCrossCheck {
  /** 두 지정이 어긋나지 않는가 */
  ok: boolean;
  /** 실제로 major로 취급되는 목록 (합집합, 디렉터리에 존재하는 것만) */
  effective: string[];
  /** 파일명은 `_major_`인데 매니페스트에 없는 것 */
  missingFromManifest: string[];
  /** 매니페스트에 있는데 마이그레이션 디렉터리에 없는 것 */
  unknownInManifest: string[];
  /** 사람이 읽을 요약 */
  detail: string;
}

/**
 * 매니페스트와 파일명 규칙을 교차 검증한다 (CTO 결정 2001-③).
 *
 * **한쪽에만 있는 것은 오류로 본다.** 파일명이 `_major_`인데 매니페스트에
 * 없으면 목록에 넣는 것을 잊은 것이고, 매니페스트에 있는데 디렉터리에 없으면
 * 이름을 바꿨거나 지운 것이다. 둘 다 **지정이 조용히 사라지는** 경로다.
 *
 * 다만 매니페스트에만 있고 파일명 규칙을 따르지 않는 것은 **오류가 아니다** —
 * 규칙을 도입하기 전에 지정한 마이그레이션이 그렇고, 이름을 소급해 바꾸면
 * 적용 이력(`_prisma_migrations`)과 어긋난다.
 */
export function crossCheckMajorMigrations(input: {
  manifest: string[];
  migrationNames: string[];
}): MajorMigrationCrossCheck {
  const known = new Set(input.migrationNames);
  const manifest = new Set(input.manifest);

  const missingFromManifest = input.migrationNames
    .filter((name) => isMajorMigrationName(name) && !manifest.has(name))
    .sort();
  const unknownInManifest = input.manifest
    .filter((name) => !known.has(name))
    .sort();

  const effective = [
    ...new Set([
      ...input.manifest.filter((name) => known.has(name)),
      ...input.migrationNames.filter(isMajorMigrationName),
    ]),
  ].sort();

  const ok =
    missingFromManifest.length === 0 && unknownInManifest.length === 0;

  const problems: string[] = [];
  if (missingFromManifest.length > 0) {
    problems.push(
      `파일명이 _major_인데 매니페스트에 없습니다: ${missingFromManifest.join(", ")} ` +
        "— prisma/major-migrations.json에 추가하세요.",
    );
  }
  if (unknownInManifest.length > 0) {
    problems.push(
      `매니페스트에 있는데 마이그레이션이 없습니다: ${unknownInManifest.join(", ")} ` +
        "— 이름이 바뀌었거나 삭제됐습니다. 지정이 조용히 사라진 상태입니다.",
    );
  }

  return {
    ok,
    effective,
    missingFromManifest,
    unknownInManifest,
    detail: ok
      ? `Major Migration ${effective.length}건 — 매니페스트와 파일명 규칙이 일치합니다.`
      : problems.join(" "),
  };
}
