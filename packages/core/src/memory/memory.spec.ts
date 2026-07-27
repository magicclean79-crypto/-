import { validateCreateMemory, validateUpdateMemory } from "./memory";

const valid = {
  scope: "PROJECT",
  scopeId: "proj-1",
  key: "preferred-tone",
  value: { tone: "친근함", emoji: false },
  description: "상세페이지 문체 설정",
};

describe("Structured Memory 입력 검증", () => {
  it("필수 필드가 모두 있으면 오류가 없다 (scopeId/description은 선택)", () => {
    expect(validateCreateMemory(valid)).toEqual([]);
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k", value: 1 }),
    ).toEqual([]);
    // value는 falsy JSON 값(false, 0, null)도 허용한다
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k", value: false }),
    ).toEqual([]);
    expect(
      validateCreateMemory({ scope: "GLOBAL", key: "k", value: null }),
    ).toEqual([]);
  });

  it("생성: scope/key 공백·value 누락을 잡는다", () => {
    expect(validateCreateMemory({})).toHaveLength(3);
    expect(validateCreateMemory({ ...valid, scope: " " })).toEqual([
      "scope은(는) 비어 있을 수 없습니다.",
    ]);
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
