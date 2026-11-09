import {
  sanitizeLevel1ProductFacts,
  validateLevel1ProductFacts,
} from "./level1-product-facts";

describe("validateLevel1ProductFacts", () => {
  it("빈 입력을 통과시킨다 — 아무 사실도 없는 것은 오류가 아니다", () => {
    expect(validateLevel1ProductFacts({})).toEqual({ ok: true, errors: [] });
  });

  it("문자열 필드에 잘못된 타입이 오면 거부한다", () => {
    const result = validateLevel1ProductFacts({
      name: 123 as unknown as string,
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("name");
  });

  it("배열 필드에 잘못된 타입이 오면 거부한다", () => {
    const result = validateLevel1ProductFacts({
      materials: "ABS" as unknown as string[],
    });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("materials");
  });

  it("uncertainFields는 알려진 필드 이름만 허용한다", () => {
    const ok = validateLevel1ProductFacts({ uncertainFields: ["origin"] });
    expect(ok.ok).toBe(true);

    const bad = validateLevel1ProductFacts({
      uncertainFields: ["notAField"],
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("notAField");
  });
});

describe("sanitizeLevel1ProductFacts", () => {
  it("빈 문자열은 null로 바꾼다 — 값을 지어내지 않는다", () => {
    const result = sanitizeLevel1ProductFacts({ name: "   " });
    expect(result.name).toBeNull();
  });

  it("문자열 값은 앞뒤 공백만 제거하고 보존한다", () => {
    const result = sanitizeLevel1ProductFacts({ brand: "  삼정글로벌  " });
    expect(result.brand).toBe("삼정글로벌");
  });

  it("배열의 빈 항목을 제거하고 나머지는 보존한다", () => {
    const result = sanitizeLevel1ProductFacts({
      materials: ["ABS", "  ", "", "PVC"],
    });
    expect(result.materials).toEqual(["ABS", "PVC"]);
  });

  it("입력에 없는 필드는 건드리지 않는다", () => {
    const result = sanitizeLevel1ProductFacts({ name: "베란다 호스" });
    expect(result.brand).toBeUndefined();
    expect(result.materials).toBeUndefined();
  });
});
