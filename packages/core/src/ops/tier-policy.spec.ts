import { TIER_POLICIES, checkTierConsistency, tierPolicy } from "./tier-policy";

describe("tierPolicy", () => {
  it("개발에서는 경보하지 않는다 — 노트북의 빨간불까지 부르면 채널이 무시된다", () => {
    expect(tierPolicy("development").alerting).toBe(false);
    expect(tierPolicy("development").requiresOperationalConfig).toBe(false);
  });

  it("스테이징은 경보한다 — 아무 데도 안 가면 검증 환경이 아니다", () => {
    expect(tierPolicy("staging").alerting).toBe(true);
    expect(tierPolicy("staging").requiresOperationalConfig).toBe(true);
  });

  it("스테이징의 실패는 운영과 같은 등급이 아니다", () => {
    expect(tierPolicy("staging").failLevel).toBe("warning");
    expect(tierPolicy("production").failLevel).toBe("critical");
  });

  it("모든 단계에 설명이 있고 마크다운 강조를 쓰지 않는다", () => {
    for (const policy of Object.values(TIER_POLICIES)) {
      expect(policy.detail.length).toBeGreaterThan(0);
      expect(policy.detail).not.toContain("**");
    }
  });
});

describe("checkTierConsistency", () => {
  it("선언과 구성이 맞으면 정상이다", () => {
    const check = checkTierConsistency({
      tier: "production",
      nodeEnv: "production",
      tierDeclared: true,
    });
    expect(check.status).toBe("ok");
  });

  it("스테이징인데 NODE_ENV가 production이 아니면 실패다", () => {
    const check = checkTierConsistency({
      tier: "staging",
      nodeEnv: "development",
      tierDeclared: true,
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("운영의 값이 아닙니다");
    expect(check.next).toContain("NODE_ENV=production");
  });

  it("선언이 없고 NODE_ENV=production이면 주의로 말한다 — 위험한 쪽으로 기울지 않았다", () => {
    const check = checkTierConsistency({
      tier: "production",
      nodeEnv: "production",
      tierDeclared: false,
    });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("스테이징이라면");
  });

  it("개발에서 선언이 없는 것은 문제가 아니다", () => {
    const check = checkTierConsistency({
      tier: "development",
      nodeEnv: undefined,
      tierDeclared: false,
    });
    expect(check.status).toBe("ok");
    expect(check.next).toBeNull();
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const nodeEnv of ["production", "development", undefined]) {
      for (const declared of [true, false]) {
        const check = checkTierConsistency({
          tier: "staging",
          nodeEnv,
          tierDeclared: declared,
        });
        expect(check.detail).not.toContain("**");
      }
    }
  });
});
