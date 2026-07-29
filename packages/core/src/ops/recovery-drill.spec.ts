import {
  DEFAULT_DRILL_GRACE_MS,
  DEFAULT_DRILL_INTERVAL_MS,
  detectDrillAlert,
  judgeRecoveryDrill,
} from "./recovery-drill";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 29, 12, 0, 0);

describe("Recovery Drill (TASK-1801, CTO 결정 1701-⑤)", () => {
  it("분기 1회 = 90일이 기본이다", () => {
    expect(DEFAULT_DRILL_INTERVAL_MS).toBe(90 * DAY);
  });

  it("이력이 없으면 직접 확인 — 통과도 실패도 아니다", () => {
    const health = judgeRecoveryDrill([], { now });
    expect(health.status).toBe("manual");
    expect(health.detail).toContain("절차를 읽는 것과 해 보는 것은 다릅니다");
    expect(health.ageMs).toBeNull();
    expect(health.dueAt).toBeNull();
  });

  it("최근에 했으면 통과하고 남은 날을 말한다", () => {
    const health = judgeRecoveryDrill([{ ok: true, createdAt: now - 10 * DAY }], {
      now,
    });
    expect(health.status).toBe("pass");
    expect(health.detail).toContain("10일 전");
    expect(health.detail).toContain("80일 남았습니다");
    expect(health.overdueDays).toBe(0);
  });

  it("기한을 조금 넘기면 주의 — 하루 이틀에 경보하지 않는다", () => {
    const health = judgeRecoveryDrill(
      [{ ok: true, createdAt: now - 95 * DAY }],
      { now },
    );
    expect(health.status).toBe("warn");
    expect(health.overdueDays).toBe(5);
  });

  it("유예까지 넘기면 실패로 본다", () => {
    const health = judgeRecoveryDrill(
      [{ ok: true, createdAt: now - 120 * DAY }],
      { now },
    );
    expect(health.status).toBe("fail");
    expect(health.overdueDays).toBe(30);
    expect(health.detail).toContain("그 사이 바뀐 절차는 검증되지 않았습니다");
  });

  it("실패한 리허설은 밀린 것과 다르게 다룬다 — 절차가 깨졌다는 발견이다", () => {
    const health = judgeRecoveryDrill([{ ok: false, createdAt: now - DAY }], {
      now,
    });
    expect(health.status).toBe("fail");
    expect(health.overdueDays).toBe(0);
    expect(health.detail).toContain("사고가 나기 전에 고치세요");
  });

  it("가장 최근 기록으로 판정한다 — 오래된 성공이 최근 실패를 덮지 않는다", () => {
    const health = judgeRecoveryDrill(
      [
        { ok: true, createdAt: now - 60 * DAY },
        { ok: false, createdAt: now - DAY },
      ],
      { now },
    );
    expect(health.status).toBe("fail");
  });

  it("주기와 유예는 조정할 수 있다", () => {
    const health = judgeRecoveryDrill(
      [{ ok: true, createdAt: now - 40 * DAY }],
      { now, intervalMs: 30 * DAY, graceMs: 5 * DAY },
    );
    expect(health.status).toBe("fail");
    expect(health.intervalMs).toBe(30 * DAY);
  });

  describe("detectDrillAlert", () => {
    it("리허설 실패는 심각 — 절차가 깨진 것이 확인됐다", () => {
      const alerts = detectDrillAlert(
        judgeRecoveryDrill([{ ok: false, createdAt: now - DAY }], { now }),
      );
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toMatchObject({
        kind: "recovery-drill",
        key: "recovery-drill:failed",
        level: "critical",
      });
    });

    it("기한 초과는 주의 — 지금 죽는 문제가 아니다", () => {
      const alerts = detectDrillAlert(
        judgeRecoveryDrill([{ ok: true, createdAt: now - 120 * DAY }], { now }),
      );
      expect(alerts[0]).toMatchObject({
        key: "recovery-drill:overdue",
        level: "warning",
      });
    });

    it("한 번도 하지 않은 상태는 경보하지 않는다 — 규칙을 어긴 것이 아니다", () => {
      expect(detectDrillAlert(judgeRecoveryDrill([], { now }))).toEqual([]);
    });

    it("최근에 했으면 경보하지 않는다", () => {
      expect(
        detectDrillAlert(
          judgeRecoveryDrill([{ ok: true, createdAt: now - DAY }], { now }),
        ),
      ).toEqual([]);
    });

    it("경보 문구에 마크다운 강조를 쓰지 않는다", () => {
      const alerts = detectDrillAlert(
        judgeRecoveryDrill([{ ok: false, createdAt: now }], { now }),
      );
      expect(alerts[0].message).not.toContain("**");
    });
  });

  it("유예 기본값은 14일", () => {
    expect(DEFAULT_DRILL_GRACE_MS).toBe(14 * DAY);
  });
});
