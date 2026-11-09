import { isLevel1AssetRole } from "./level1-asset-role";

describe("isLevel1AssetRole", () => {
  it("정해진 8종 값을 인정한다", () => {
    expect(isLevel1AssetRole("ACTUAL_PRODUCT")).toBe(true);
    expect(isLevel1AssetRole("PACKAGING")).toBe(true);
    expect(isLevel1AssetRole("LABEL")).toBe(true);
    expect(isLevel1AssetRole("SPEC")).toBe(true);
    expect(isLevel1AssetRole("BARCODE")).toBe(true);
    expect(isLevel1AssetRole("MANUAL")).toBe(true);
    expect(isLevel1AssetRole("LIFESTYLE")).toBe(true);
    expect(isLevel1AssetRole("UNKNOWN")).toBe(true);
  });

  it("정해지지 않은 값은 거부한다", () => {
    expect(isLevel1AssetRole("HERO")).toBe(false);
    expect(isLevel1AssetRole("")).toBe(false);
    expect(isLevel1AssetRole(undefined)).toBe(false);
    expect(isLevel1AssetRole(null)).toBe(false);
    expect(isLevel1AssetRole(123)).toBe(false);
  });
});
