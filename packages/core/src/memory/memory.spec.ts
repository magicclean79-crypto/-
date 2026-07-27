import { validateCreateMemory, validateUpdateMemory } from "./memory";

const valid = {
  scope: "PROJECT",
  scopeId: "proj-1",
  key: "preferred-tone",
  value: { tone: "친근함", emoji: false },
  description: "상세페이지 문체 설정",
} as const;

describe("Structured Memory 입력 검증", () => {
  it("필수 필드가 모두 있으면 오류가 없다 (description은 선택)", () => {
    expect(validateCreateMemory(valid)).toEqual([]);
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k", value: 1 }),
    ).toEqual([]);
    // value는 falsy JSON 값(false, 0, null)도 허용한다
    expect(
      validateCreateMemory({ scope: "COMPANY", key: "k", value: false }),
    ).toEqual([]);
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k", value: null }),
    ).toEqual([]);
  });

  it("scope는 Enum 값만 허용한다 (CTO 결정: GLOBAL/COMPANY/PROJECT/PRODUCT)", () => {
    const invalid = validateCreateMemory({
      ...valid,
      scope: "TEAM" as never,
    });
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toContain("scope는 다음 중 하나여야 합니다");
    expect(validateCreateMemory({ ...valid, scope: "" as never })).toHaveLength(
      1,
    );
  });

  it("scope 규칙 — GLOBAL/COMPANY는 scopeId 금지, PROJECT/PRODUCT는 scopeId 필수", () => {
    expect(
      validateCreateMemory({ scope: "GLOBAL", scopeId: "x", key: "k", value: 1 }),
    ).toEqual(["scope=GLOBAL에는 scopeId를 지정할 수 없습니다."]);
    expect(
      validateCreateMemory({ scope: "COMPANY", scopeId: "x", key: "k", value: 1 }),
    ).toHaveLength(1);
    expect(
      validateCreateMemory({ scope: "PROJECT", key: "k", value: 1 }),
    ).toEqual(["scope=PROJECT에는 scopeId가 필요합니다."]);
    expect(
      validateCreateMemory({ scope: "PRODUCT", scopeId: " ", key: "k", value: 1 }),
    ).toHaveLength(1);
    expect(
      validateCreateMemory({ scope: "PRODUCT", scopeId: "prod-1", key: "k", value: 1 }),
    ).toEqual([]);
  });

  it("생성: key 공백·value 누락을 잡는다", () => {
    expect(validateCreateMemory({ ...valid, key: "" })).toHaveLength(1);
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k" }),
    ).toEqual(["value은(는) 필수입니다."]);
  });

  it("수정: value/description 중 하나는 지정해야 한다", () => {
    expect(validateUpdateMemory({})).toHaveLength(1);
    expect(validateUpdateMemory({ value: 42 })).toEqual([]);
    expect(validateUpdateMemory({ description: null })).toEqual([]);
    expect(validateUpdateMemory({ value: null })).toEqual([]);
  });
});
