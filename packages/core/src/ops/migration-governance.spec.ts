import { judgeMigrations } from "./migration-governance";

describe("Migration Governance (TASK-2301, CTO 결정 2201-①)", () => {
  const dirs = ["20260101000000_a", "20260202000000_b"];

  it("전부 적용됐으면 통과", () => {
    const result = judgeMigrations(
      { directories: dirs, applied: dirs, failed: 0 },
      { production: true },
    );
    expect(result.status).toBe("pass");
    expect(result.pending).toEqual([]);
  });

  it("적용하지 않은 마이그레이션을 잡아낸다 — 실패 행만 세면 놓친다", () => {
    // 적용하지 않은 마이그레이션은 `_prisma_migrations`에 행조차 없다.
    // failed=0인데도 미적용이 있는 상황이 바로 그 거짓 통과다.
    const result = judgeMigrations(
      { directories: dirs, applied: ["20260101000000_a"], failed: 0 },
      { production: true },
    );
    expect(result.status).toBe("fail");
    expect(result.pending).toEqual(["20260202000000_b"]);
  });

  it("운영에서는 적용 주체가 운영 담당자다", () => {
    const result = judgeMigrations(
      { directories: dirs, applied: [], failed: 0 },
      { production: true },
    );
    expect(result.appliedBy).toBe("operator");
    expect(result.detail).toContain("운영 담당자가");
    expect(result.detail).toContain("애플리케이션은 스키마를 적용하지 않습니다");
  });

  it("개발에서는 개발자가 적용한다 — 문구가 다르다", () => {
    const result = judgeMigrations(
      { directories: dirs, applied: [], failed: 0 },
      { production: false },
    );
    expect(result.appliedBy).toBe("developer");
    expect(result.detail).not.toContain("운영 담당자");
  });

  it("적용 중 실패한 건이 있으면 미적용보다 먼저 알린다", () => {
    // 스키마가 중간 상태일 수 있다 — 그 상태에서 또 적용하면 더 엉킨다
    const result = judgeMigrations(
      { directories: dirs, applied: [], failed: 1 },
      { production: true },
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("중간 상태");
  });

  it("코드에 없는 마이그레이션이 적용돼 있으면 주의", () => {
    const result = judgeMigrations(
      {
        directories: ["20260101000000_a"],
        applied: ["20260101000000_a", "20260303000000_from_other_branch"],
        failed: 0,
      },
      { production: true },
    );
    expect(result.status).toBe("warn");
    expect(result.unknown).toEqual(["20260303000000_from_other_branch"]);
    expect(result.detail).toContain("스키마가 코드보다 앞서 있습니다");
  });

  it("미적용이 있으면 그것을 먼저 말한다 — 둘 다 있어도", () => {
    const result = judgeMigrations(
      {
        directories: dirs,
        applied: ["20260101000000_a", "20260303000000_other"],
        failed: 0,
      },
      { production: true },
    );
    expect(result.status).toBe("fail");
    expect(result.pending).toEqual(["20260202000000_b"]);
    // 미적용을 알리면서 unknown도 함께 담는다 — 둘 다 사실이다
    expect(result.unknown).toEqual(["20260303000000_other"]);
  });

  it("하나라도 읽지 못하면 통과로 세지 않는다", () => {
    for (const state of [
      { directories: null, applied: dirs, failed: 0 },
      { directories: dirs, applied: null, failed: 0 },
      { directories: dirs, applied: dirs, failed: null },
    ]) {
      expect(judgeMigrations(state, { production: true }).status).toBe("manual");
    }
  });

  it("확인 불가 문구가 한계를 밝힌다", () => {
    const result = judgeMigrations(
      { directories: null, applied: null, failed: null },
      { production: true },
    );
    expect(result.detail).toContain("마이그레이션 목록과 적용 기록을 모두 읽어야");
  });
});
