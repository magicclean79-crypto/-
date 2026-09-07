import { LEVEL1_ASSET_ROLES } from "@acos/shared";
import type { Level1AssetRole } from "@acos/shared";

/**
 * LEVEL 1 asset role 검증 (T1-188 요청 사양 4).
 *
 * LEVEL 1은 AI 자동 분류를 하지 않는다 — 사람이 고른 값이 정해진 8종
 * 중 하나인지만 확인한다. 정해진 값 밖의 문자열을 조용히 UNKNOWN으로
 * 바꾸지 않는다 — 잘못된 입력은 호출자가 거부해야 한다.
 */
export function isLevel1AssetRole(value: unknown): value is Level1AssetRole {
  return (
    typeof value === "string" &&
    (LEVEL1_ASSET_ROLES as readonly string[]).includes(value)
  );
}
