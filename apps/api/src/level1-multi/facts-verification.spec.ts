import { verifyFields } from "./facts-verification";

describe("verifyFields", () => {
  it("관측이 하나뿐이면 single-source로 그 값을 그대로 쓴다", () => {
    const result = verifyFields({ manufacturer: [{ source: "vision-analysis", value: "상성산업(주)" }] });
    expect(result).toEqual([
      {
        field: "manufacturer",
        observations: [{ source: "vision-analysis", value: "상성산업(주)" }],
        status: "single-source",
        resolvedValue: "상성산업(주)",
      },
    ]);
  });

  it("출처가 둘 이상인데 값이 같으면(공백·괄호 차이 무시) agreed다", () => {
    const result = verifyFields({
      manufacturer: [
        { source: "vision-analysis", value: "상성산업(주)" },
        { source: "ocr:a1", value: "상성산업 (주)" },
      ],
    });
    expect(result[0].status).toBe("agreed");
    expect(result[0].resolvedValue).toBe("상성산업(주)");
  });

  it("값이 다르면 conflict이고 resolvedValue는 항상 null이다 — 자동으로 고르지 않는다", () => {
    const result = verifyFields({
      manufacturer: [
        { source: "vision-analysis", value: "상성산업(주)" },
        { source: "ocr:a1", value: "상부산업(주)" },
      ],
    });
    expect(result[0].status).toBe("conflict");
    expect(result[0].resolvedValue).toBeNull();
    expect(result[0].observations).toHaveLength(2);
  });

  it("관측이 없는 필드는 unknown이 아니라 결과에서 아예 제외된다", () => {
    const result = verifyFields({ manufacturer: [], model: [{ source: "vision-analysis", value: "X-1" }] });
    expect(result).toHaveLength(1);
    expect(result[0].field).toBe("model");
  });

  it("빈 문자열 관측은 무시하고, 남은 관측이 하나면 single-source다", () => {
    const result = verifyFields({
      manufacturer: [
        { source: "vision-analysis", value: "" },
        { source: "ocr:a1", value: "상성산업(주)" },
      ],
    });
    expect(result[0].status).toBe("single-source");
    expect(result[0].resolvedValue).toBe("상성산업(주)");
  });
});
