import {
  allowedTransitions,
  canTransition,
  isPublishable,
} from "./content-status";

describe("Content 발행 파이프라인 전이 규칙 (TASK-0703)", () => {
  it("DRAFT → REVIEW → PUBLISHED → ARCHIVED 정방향 전이를 허용한다", () => {
    expect(canTransition("DRAFT", "REVIEW")).toBe(true);
    expect(canTransition("REVIEW", "PUBLISHED")).toBe(true);
    expect(canTransition("PUBLISHED", "ARCHIVED")).toBe(true);
  });

  it("REVIEW → DRAFT 되돌리기와 단계별 ARCHIVED 종결을 허용한다", () => {
    expect(canTransition("REVIEW", "DRAFT")).toBe(true);
    expect(canTransition("DRAFT", "ARCHIVED")).toBe(true);
    expect(canTransition("REVIEW", "ARCHIVED")).toBe(true);
  });

  it("건너뛰기·역행은 거부한다", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false); // REVIEW 생략 불가
    expect(canTransition("PUBLISHED", "REVIEW")).toBe(false);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
  });

  describe("보관된 콘텐츠 되살리기 (TASK-2701, CTO 결정 2601-①)", () => {
    it("ARCHIVED에서 DRAFT로 되살릴 수 있다", () => {
      // 공식 절차가 PUBLISHED → ARCHIVED → 수정 → 재발행으로 확정됐다.
      // ARCHIVED가 종결이면 그 절차를 밟을 수 없고, 사람은 새 콘텐츠를
      // 만들어 우회한다 — 그러면 왜 내렸는지가 새 콘텐츠에 남지 않는다.
      expect(canTransition("ARCHIVED", "DRAFT")).toBe(true);
      expect(allowedTransitions("ARCHIVED")).toEqual(["DRAFT"]);
    });

    it("ARCHIVED에서 발행으로 직행할 수 없다 — 게이트를 다시 거쳐야 한다", () => {
      // 내린 이유를 고치지 않은 채 곧바로 되돌아가면 내린 것이 무의미하다
      expect(canTransition("ARCHIVED", "PUBLISHED")).toBe(false);
      expect(canTransition("ARCHIVED", "REVIEW")).toBe(false);
    });

    it("되살린 뒤에는 평소 경로를 그대로 쓴다", () => {
      expect(canTransition("DRAFT", "REVIEW")).toBe(true);
      expect(canTransition("REVIEW", "PUBLISHED")).toBe(true);
    });
  });

  it("발행 조건 — REVIEW 상태 + 제목/본문 필수", () => {
    expect(
      isPublishable({ status: "REVIEW", title: "제목", body: "본문" }),
    ).toBe(true);
    expect(
      isPublishable({ status: "DRAFT", title: "제목", body: "본문" }),
    ).toBe(false);
    expect(isPublishable({ status: "REVIEW", title: "", body: "본문" })).toBe(
      false,
    );
    expect(isPublishable({ status: "REVIEW", title: "제목", body: "" })).toBe(
      false,
    );
  });
});
