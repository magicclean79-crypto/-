import {
  describeMissingBucket,
  resolveProvisioningPolicy,
} from "./storage-provisioning";

describe("저장소 프로비저닝 경계 (TASK-2201, CTO 결정 2101-④)", () => {
  it("운영에서는 만들지도, 정책을 걸지도 않는다", () => {
    const policy = resolveProvisioningPolicy({ NODE_ENV: "production" });
    expect(policy.mode).toBe("external");
    expect(policy.mayCreateBucket).toBe(false);
    expect(policy.maySetPolicy).toBe(false);
    expect(policy.detail).toContain("운영 담당자가 준비합니다");
    expect(policy.detail).toContain("환경변수");
  });

  it("개발에서는 만든다 — 개발자가 손으로 준비하게 하지 않는다", () => {
    const policy = resolveProvisioningPolicy({});
    expect(policy.mode).toBe("managed");
    expect(policy.mayCreateBucket).toBe(true);
    expect(policy.maySetPolicy).toBe(true);
  });

  it("NODE_ENV가 production이 아니면 전부 managed다", () => {
    for (const env of ["development", "test", "staging", ""]) {
      expect(resolveProvisioningPolicy({ NODE_ENV: env }).mode).toBe("managed");
    }
  });

  describe("describeMissingBucket", () => {
    it("운영에서는 누가 무엇을 해야 하는지까지 적는다", () => {
      const message = describeMissingBucket(
        "acos-prod",
        resolveProvisioningPolicy({ NODE_ENV: "production" }),
      );
      expect(message).toContain("acos-prod");
      expect(message).toContain("애플리케이션이 버킷을 만들지 않습니다");
      expect(message).toContain("운영 담당자");
      expect(message).toContain("s3-migration.md");
    });

    it("개발에서는 짧게 — 앱이 곧 만들 것이라 안내할 일이 없다", () => {
      const message = describeMissingBucket(
        "acos",
        resolveProvisioningPolicy({}),
      );
      expect(message).toBe("버킷을 찾을 수 없습니다: acos");
    });
  });
});
