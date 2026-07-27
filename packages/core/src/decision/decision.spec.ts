import { validateCreateDecision, validateUpdateDecision } from "./decision";

const valid = {
  projectId: "proj-1",
  title: "Project를 루트 엔티티로 도입",
  reason: "여러 상품을 하나의 작업 단위로 묶기 위해",
  decisionType: "architecture",
  author: "CTO",
};

describe("Decision 입력 검증", () => {
  it("필수 필드가 모두 있으면 오류가 없다", () => {
    expect(validateCreateDecision(valid)).toEqual([]);
    expect(validateCreateDecision({ ...valid, description: null })).toEqual([]);
  });

  it("생성: 필수 필드(title/reason/decisionType/author) 누락·공백을 잡는다", () => {
    expect(validateCreateDecision({})).toHaveLength(4);
    expect(validateCreateDecision({ ...valid, title: "  " })).toEqual([
      "title은(는) 비어 있을 수 없습니다.",
    ]);
    expect(validateCreateDecision({ ...valid, author: "" })).toHaveLength(1);
  });

  it("수정: 지정하지 않은 필드는 검사하지 않고, 지정된 필수 필드의 공백만 잡는다", () => {
    expect(validateUpdateDecision({})).toEqual([]);
    expect(validateUpdateDecision({ title: "새 제목" })).toEqual([]);
    expect(validateUpdateDecision({ reason: " " })).toEqual([
      "reason은(는) 비어 있을 수 없습니다.",
    ]);
    expect(
      validateUpdateDecision({ title: "", decisionType: "" }),
    ).toHaveLength(2);
  });
});
