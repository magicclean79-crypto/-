import {
  UNKNOWN_MIGRATION_ESCALATE_MS,
  detectUnknownMigrationAlert,
  judgeMigrations,
} from "./migration-governance";

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

  it("실패 행이 있어도 미적용 목록은 비우지 않는다 (TASK-2401, CTO 결정 2301-④)", () => {
    // 무엇을 먼저 알릴지와 무엇이 사실인지는 다르다. 실패를 먼저 알리면서
    // 미적용을 []로 비우면 `pendingMigrations`가 0으로 보고된다 — 거짓 통과다.
    const result = judgeMigrations(
      {
        directories: [...dirs, "20260404000000_c"],
        applied: ["20260101000000_a", "20260505000000_other"],
        failed: 3,
      },
      { production: true },
    );
    expect(result.status).toBe("fail");
    expect(result.detail).toContain("3건");
    expect(result.pending).toEqual(["20260202000000_b", "20260404000000_c"]);
    expect(result.unknown).toEqual(["20260505000000_other"]);
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

describe("코드에 없는 마이그레이션 경보 (TASK-2401, CTO 결정 2301-②)", () => {
  const unknown = ["20260303000000_from_other_branch"];
  const day = 24 * 60 * 60 * 1000;
  const now = 1_800_000_000_000;

  it("코드에 없는 마이그레이션이 없으면 경보를 만들지 않는다", () => {
    // 부를 일이 아닌데 부르면 정작 불러야 할 때 오지 않는다
    expect(
      detectUnknownMigrationAlert([], { now, firstSeenAt: null }),
    ).toEqual([]);
  });

  it("처음 관측하면 주의다 — 되돌린 배포 직후에 사람을 부르지 않는다", () => {
    const [alert] = detectUnknownMigrationAlert(unknown, {
      now,
      firstSeenAt: null,
    });
    expect(alert.level).toBe("warning");
    expect(alert.kind).toBe("migration-governance");
    expect(alert.key).toBe("migration-governance:unknown");
    expect(alert.message).toContain("20260303000000_from_other_branch");
    // 언제 심각으로 오르는지 지금 알려준다 — 나중에 놀라지 않게
    expect(alert.message).toContain("7일");
  });

  it("7일 이내면 아직 주의다", () => {
    for (const elapsed of [0, day, 6 * day, UNKNOWN_MIGRATION_ESCALATE_MS]) {
      const [alert] = detectUnknownMigrationAlert(unknown, {
        now,
        firstSeenAt: now - elapsed,
      });
      expect(alert.level).toBe("warning");
    }
  });

  it("7일을 넘기면 심각으로 올린다 — 되돌린 것이 아니라 잊은 것이다", () => {
    const [alert] = detectUnknownMigrationAlert(unknown, {
      now,
      firstSeenAt: now - (UNKNOWN_MIGRATION_ESCALATE_MS + 1),
    });
    expect(alert.level).toBe("critical");
    expect(alert.title).toContain("7일을 넘었습니다");
    expect(alert.message).toContain("7일째");
  });

  it("심각으로 올라도 배포를 막지 않는다고 밝힌다 (CTO 결정 2301-②)", () => {
    const [alert] = detectUnknownMigrationAlert(unknown, {
      now,
      firstSeenAt: now - 30 * day,
    });
    expect(alert.level).toBe("critical");
    // 경보와 차단은 다르다 — 막으면 되돌린 배포를 다시 되돌릴 수 없다
    expect(alert.message).toContain("배포는 막지 않습니다");
    expect(alert.message).toContain("30일째");
  });

  it("목록이 늘어도 키가 같다 — 키가 바뀌면 경과가 초기화된다", () => {
    const [first] = detectUnknownMigrationAlert(unknown, {
      now,
      firstSeenAt: null,
    });
    const [second] = detectUnknownMigrationAlert(
      [...unknown, "20260404000000_another"],
      { now, firstSeenAt: now - 8 * day },
    );
    expect(second.key).toBe(first.key);
    expect(second.level).toBe("critical");
    // 목록은 문구에 그대로 드러난다
    expect(second.message).toContain("20260404000000_another");
  });

  it("경보 문구에 마크다운 강조가 새지 않는다", () => {
    for (const firstSeenAt of [null, now - 30 * day]) {
      const [alert] = detectUnknownMigrationAlert(unknown, {
        now,
        firstSeenAt,
      });
      expect(alert.title).not.toContain("**");
      expect(alert.message).not.toContain("**");
    }
  });

  it("승격 기준은 호출부가 바꿀 수 있다 — 기본값은 7일이다", () => {
    expect(UNKNOWN_MIGRATION_ESCALATE_MS).toBe(7 * day);
    const [alert] = detectUnknownMigrationAlert(unknown, {
      now,
      firstSeenAt: now - 2 * day,
      escalateAfterMs: day,
    });
    expect(alert.level).toBe("critical");
  });
});
