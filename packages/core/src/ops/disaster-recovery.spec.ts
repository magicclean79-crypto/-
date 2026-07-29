import {
  buildDisasterRecoveryChecklist,
  judgeBackup,
  judgeRestore,
  MIN_BACKUP_BYTES,
  summarizeDisasterRecovery,
} from "./disaster-recovery";
import type { DrState } from "./disaster-recovery";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_000 * DAY;

describe("Backup · Restore · Disaster Recovery (TASK-1601)", () => {
  describe("judgeBackup", () => {
    it("이력이 없으면 missing — 통과가 아니다", () => {
      const health = judgeBackup([], { now: NOW });
      expect(health.verdict).toBe("missing");
      expect(health.message).toContain("복구할 수 있는 지점이 없습니다");
    });

    it("최근 성공 백업은 ok", () => {
      expect(
        judgeBackup([{ ok: true, sizeBytes: 5_000_000, createdAt: NOW - HOUR }], {
          now: NOW,
        }).verdict,
      ).toBe("ok");
    });

    it("마지막 시도가 실패면 failed", () => {
      expect(
        judgeBackup(
          [
            { ok: true, sizeBytes: 5_000_000, createdAt: NOW - 2 * HOUR },
            { ok: false, sizeBytes: null, createdAt: NOW - HOUR },
          ],
          { now: NOW },
        ).verdict,
      ).toBe("failed");
    });

    it("크기가 비정상이면 성공이어도 failed — 빈 덤프는 복원할 수 없다", () => {
      const health = judgeBackup(
        [{ ok: true, sizeBytes: MIN_BACKUP_BYTES - 1, createdAt: NOW - HOUR }],
        { now: NOW },
      );
      expect(health.verdict).toBe("failed");
      expect(health.message).toContain("빈 덤프");
    });

    it("오래되면 stale", () => {
      expect(
        judgeBackup([{ ok: true, sizeBytes: 5_000_000, createdAt: NOW - 5 * DAY }], {
          now: NOW,
        }).verdict,
      ).toBe("stale");
    });

    it("한계는 조정할 수 있다", () => {
      expect(
        judgeBackup([{ ok: true, sizeBytes: 5_000_000, createdAt: NOW - 5 * DAY }], {
          now: NOW,
          maxAgeMs: 10 * DAY,
        }).verdict,
      ).toBe("ok");
    });
  });

  describe("judgeRestore", () => {
    it("이력이 없으면 missing — 복원해 보지 않은 백업은 백업이 아니다", () => {
      const health = judgeRestore([], { now: NOW });
      expect(health.verdict).toBe("missing");
      expect(health.message).toContain("복원해 보지 않은 백업은 백업이 아닙니다");
    });

    it("최근 성공은 ok, 실패는 failed, 오래되면 stale", () => {
      expect(
        judgeRestore([{ ok: true, tables: 30, createdAt: NOW - DAY }], { now: NOW })
          .verdict,
      ).toBe("ok");
      expect(
        judgeRestore([{ ok: false, tables: null, createdAt: NOW - HOUR }], {
          now: NOW,
        }).verdict,
      ).toBe("failed");
      expect(
        judgeRestore([{ ok: true, tables: 30, createdAt: NOW - 20 * DAY }], {
          now: NOW,
        }).verdict,
      ).toBe("stale");
    });
  });

  describe("buildDisasterRecoveryChecklist", () => {
    const healthy: DrState = {
      backup: judgeBackup(
        [{ ok: true, sizeBytes: 5_000_000, createdAt: NOW - HOUR }],
        { now: NOW },
      ),
      restore: judgeRestore([{ ok: true, tables: 30, createdAt: NOW - DAY }], {
        now: NOW,
      }),
      database: { ok: true, detail: "연결 정상" },
      storage: { ok: true, detail: "버킷 접근 정상" },
      lock: { ok: true, detail: "Redis 정상" },
      notificationChannels: 2,
      runbookPath: "docs/operations/disaster-recovery.md",
    };

    it("정상 상태는 복구 가능으로 판정하되, 절차 숙지는 manual로 남는다", () => {
      const items = buildDisasterRecoveryChecklist(healthy);
      const summary = summarizeDisasterRecovery(items);
      expect(summary.recoverable).toBe(true);
      expect(summary.blockers).toEqual([]);
      // 자동 판정이 불가능한 것을 통과로 처리하지 않는다
      expect(summary.manual).toBe(1);
      expect(items.find((item) => item.id === "runbook")!.status).toBe("manual");
    });

    it("백업·복원·DB·저장소 실패는 복구 불가로 막는다", () => {
      const items = buildDisasterRecoveryChecklist({
        ...healthy,
        backup: judgeBackup([], { now: NOW }),
        restore: judgeRestore([], { now: NOW }),
        database: { ok: false, detail: "연결 실패" },
        storage: { ok: false, detail: "버킷 없음" },
      });
      const summary = summarizeDisasterRecovery(items);
      expect(summary.recoverable).toBe(false);
      expect(summary.blockers.map((item) => item.id).sort()).toEqual([
        "backup",
        "database",
        "restore",
        "storage",
      ]);
    });

    it("Redis 장애는 경고이되 복구를 막지는 않는다 (CTO 결정 1501-②)", () => {
      const items = buildDisasterRecoveryChecklist({
        ...healthy,
        lock: { ok: false, detail: "연결 불가" },
      });
      const lock = items.find((item) => item.id === "lock")!;
      expect(lock).toMatchObject({ status: "warn", critical: false });
      expect(lock.detail).toContain("LLM 호출은 계속됩니다");
      expect(summarizeDisasterRecovery(items).recoverable).toBe(true);
    });

    it("잠금을 쓰지 않으면 항목 자체가 없다", () => {
      const items = buildDisasterRecoveryChecklist({ ...healthy, lock: null });
      expect(items.find((item) => item.id === "lock")).toBeUndefined();
    });

    it("경보 채널이 없으면 경고 — 사고가 나도 로그에만 남는다", () => {
      const items = buildDisasterRecoveryChecklist({
        ...healthy,
        notificationChannels: 0,
      });
      expect(items.find((item) => item.id === "alert-channel")).toMatchObject({
        status: "warn",
      });
    });

    it("오래된 백업은 경고이되 차단은 아니다", () => {
      const items = buildDisasterRecoveryChecklist({
        ...healthy,
        backup: judgeBackup(
          [{ ok: true, sizeBytes: 5_000_000, createdAt: NOW - 5 * DAY }],
          { now: NOW },
        ),
      });
      expect(items.find((item) => item.id === "backup")!.status).toBe("warn");
      expect(summarizeDisasterRecovery(items).recoverable).toBe(true);
    });
  });
});
