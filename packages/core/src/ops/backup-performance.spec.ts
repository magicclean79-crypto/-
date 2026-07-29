import {
  BACKUP_DURATION_THRESHOLDS,
  detectBackupPerformanceAlert,
  judgeBackupPerformance,
} from "./backup-performance";

const now = Date.UTC(2026, 6, 30, 12, 0, 0);
const at = (minutesAgo: number) => now - minutesAgo * 60_000;

/** 최신순으로 소요 시간을 주는 헬퍼 */
const runs = (...durations: number[]) =>
  durations.map((durationMs, index) => ({
    ok: true,
    durationMs,
    createdAt: at(index),
  }));

describe("Backup Performance (TASK-1901, CTO 결정 1801-①)", () => {
  it("기준값이 결정과 일치한다", () => {
    expect(BACKUP_DURATION_THRESHOLDS.normalMs).toBe(2_000);
    expect(BACKUP_DURATION_THRESHOLDS.alertMs).toBe(10_000);
    expect(BACKUP_DURATION_THRESHOLDS.criticalMs).toBe(30_000);
    expect(BACKUP_DURATION_THRESHOLDS.alertStreak).toBe(3);
  });

  it("2초 미만은 정상", () => {
    const result = judgeBackupPerformance(runs(800, 1_200, 900));
    expect(result.level).toBe("normal");
    expect(result.status).toBe("pass");
    expect(result.latestMs).toBe(800);
    expect(result.medianMs).toBe(900);
  });

  it("2~10초는 주의 — 아직 조치할 수준은 아니라고 말한다", () => {
    const result = judgeBackupPerformance(runs(5_000, 900));
    expect(result.level).toBe("warning");
    expect(result.status).toBe("warn");
    expect(result.detail).toContain("추세를 보세요");
  });

  it("10초 초과가 연속 3회면 경보", () => {
    const result = judgeBackupPerformance(runs(12_000, 11_000, 15_000, 500));
    expect(result.level).toBe("alert");
    expect(result.slowStreak).toBe(3);
    expect(result.detail).toContain("3회 연속");
  });

  it("10초 초과가 2회면 아직 경보가 아니다 — 한 번 느린 것은 흔하다", () => {
    const result = judgeBackupPerformance(runs(12_000, 11_000, 500));
    expect(result.level).toBe("warning");
    expect(result.slowStreak).toBe(2);
  });

  it("연속이 끊기면 다시 센다", () => {
    // 느림 · 빠름 · 느림 · 느림 → 최신부터 연속은 1회뿐이다
    const result = judgeBackupPerformance(runs(12_000, 500, 12_000, 12_000));
    expect(result.slowStreak).toBe(1);
    expect(result.level).toBe("warning");
  });

  it("30초 초과는 한 번만 넘어도 심각", () => {
    const result = judgeBackupPerformance(runs(31_000, 500, 500));
    expect(result.level).toBe("critical");
    expect(result.status).toBe("fail");
    expect(result.slowStreak).toBe(1);
  });

  it("심각 문구는 자동으로 간격을 바꾸지 않는다고 말한다 (CTO 결정 1801-①)", () => {
    // 시스템이 스스로 백업을 드물게 만들면 손실 구간이 조용히 늘어난다
    const result = judgeBackupPerformance(runs(35_000));
    expect(result.detail).toContain("자동으로 바꾸지 않습니다");
  });

  it("실패한 백업은 소요 시간 판정에서 제외한다", () => {
    const result = judgeBackupPerformance([
      { ok: false, durationMs: 60_000, createdAt: at(0) },
      { ok: true, durationMs: 500, createdAt: at(1) },
    ]);
    expect(result.level).toBe("normal");
    expect(result.latestMs).toBe(500);
  });

  it("성공한 백업이 없으면 통과로 세지 않는다", () => {
    const result = judgeBackupPerformance([
      { ok: false, durationMs: 100, createdAt: at(0) },
    ]);
    expect(result.status).toBe("manual");
    expect(result.latestMs).toBeNull();
  });

  it("연속 기준은 조정할 수 있다", () => {
    expect(
      judgeBackupPerformance(runs(12_000, 11_000), { streak: 2 }).level,
    ).toBe("alert");
  });

  it("문구에 어긋난 조사를 쓰지 않는다", () => {
    // 기준값 표기가 "30.0초"·"500ms"로 달라져 조사가 어긋날 수 있다
    for (const durations of [[35_000], [12_000, 11_000, 15_000], [5_000], [500]]) {
      const detail = judgeBackupPerformance(runs(...durations)).detail;
      expect(detail).not.toContain("초을");
      expect(detail).not.toContain("ms를");
      expect(detail).not.toContain("**");
    }
  });

  describe("detectBackupPerformanceAlert", () => {
    it("심각은 critical 경보", () => {
      const alerts = detectBackupPerformanceAlert(
        judgeBackupPerformance(runs(31_000)),
      );
      expect(alerts[0]).toMatchObject({
        kind: "backup-performance",
        key: "backup-performance:duration",
        level: "critical",
      });
    });

    it("연속 초과는 warning 경보", () => {
      const alerts = detectBackupPerformanceAlert(
        judgeBackupPerformance(runs(12_000, 11_000, 15_000)),
      );
      expect(alerts[0].level).toBe("warning");
      expect(alerts[0].message).not.toContain("**");
    });

    it("주의(2~10초)는 경보하지 않는다 — 부를 일이 아닌데 부르면 안 된다", () => {
      expect(
        detectBackupPerformanceAlert(judgeBackupPerformance(runs(5_000))),
      ).toEqual([]);
    });

    it("정상·판정 불가는 경보하지 않는다", () => {
      expect(
        detectBackupPerformanceAlert(judgeBackupPerformance(runs(500))),
      ).toEqual([]);
      expect(detectBackupPerformanceAlert(judgeBackupPerformance([]))).toEqual(
        [],
      );
    });
  });
});
