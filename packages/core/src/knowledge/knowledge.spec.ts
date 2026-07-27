import {
  validateCreateKnowledge,
  validateUpdateKnowledge,
} from "./knowledge";

const valid = {
  title: "상세페이지 금지어",
  content: "최상급 표현(최고, 1위, 유일)은 근거 자료 없이 사용할 수 없다.",
  category: "금지어",
};

describe("Knowledge 입력 검증", () => {
  it("필수 필드가 모두 있으면 오류가 없다 (category는 선택)", () => {
    expect(validateCreateKnowledge(valid)).toEqual([]);
    expect(validateCreateKnowledge({ ...valid, category: null })).toEqual([]);
  });

  it("생성: 필수 필드(title/content) 누락·공백을 잡는다", () => {
    expect(validateCreateKnowledge({})).toHaveLength(2);
    expect(validateCreateKnowledge({ ...valid, title: "  " })).toEqual([
      "title은(는) 비어 있을 수 없습니다.",
    ]);
    expect(validateCreateKnowledge({ ...valid, content: "" })).toHaveLength(1);
  });

  it("수정: 지정하지 않은 필드는 검사하지 않고, 지정된 필수 필드의 공백만 잡는다", () => {
    expect(validateUpdateKnowledge({})).toEqual([]);
    expect(validateUpdateKnowledge({ category: null })).toEqual([]);
    expect(validateUpdateKnowledge({ content: " " })).toEqual([
      "content은(는) 비어 있을 수 없습니다.",
    ]);
    expect(validateUpdateKnowledge({ title: "", content: "" })).toHaveLength(2);
  });
});
