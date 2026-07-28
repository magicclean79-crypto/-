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

  it("건너뛰기·역행·ARCHIVED 이후 전이는 거부한다", () => {
    expect(canTransition("DRAFT", "PUBLISHED")).toBe(false); // REVIEW 생략 불가
    expect(canTransition("PUBLISHED", "REVIEW")).toBe(false);
    expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
    expect(canTransition("ARCHIVED", "DRAFT")).toBe(false);
    expect(allowedTransitions("ARCHIVED")).toEqual([]);
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
