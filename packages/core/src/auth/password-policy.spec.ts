import { validatePasswordComplexity } from "./password-policy";

describe("비밀번호 복잡도 정책 (TASK-0804)", () => {
  it("최소 8자 + 영문 + 숫자를 요구한다", () => {
    expect(validatePasswordComplexity("abc1")).toContain("8자");
    expect(validatePasswordComplexity("12345678")).toContain("영문자");
    expect(validatePasswordComplexity("abcdefgh")).toContain("숫자");
    expect(validatePasswordComplexity(undefined)).toContain("8자");
  });

  it("정책을 만족하면 null", () => {
    expect(validatePasswordComplexity("admin1234")).toBeNull();
    expect(validatePasswordComplexity("Str0ng-pass!")).toBeNull();
  });
});
