import {
  DEFAULT_RPO_MS,
  DEFAULT_RTO_MS,
  judgeIntegrity,
  judgeOffsite,
  judgeRecoveryObjectives,
  judgeRestoreTarget,
  judgeStorageProtection,
} from "./enterprise-recovery";
import { buildDisasterRecoveryChecklist, summarizeDisasterRecovery } from "./disaster-recovery";
import type { DrState } from "./disaster-recovery";

describe("Enterprise Backup & Disaster Recovery (TASK-1701)", () => {
  describe("judgeOffsite", () => {
    it("미구성은 실패가 아니지만, 같은 곳에만 있다는 사실을 말한다", () => {
      const result = judgeOffsite({
        configured: false,
        latestReplicated: null,
        copies: 0,
      });
      expect(result.status).toBe("warn");
      expect(result.detail).toContain("백업도 함께 사라집니다");
    });

    it("마지막 백업이 올라가지 못했으면 실패", () => {
      const result = judgeOffsite({
        configured: true,
        latestReplicated: false,
        copies: 3,
      });
      expect(result.status).toBe("fail");
    });

    it("복제할 백업이 아직 없으면 실패가 아니다", () => {
      // 백업이 없는 것은 백업 항목이 이미 잡아낸다 — 여기서 두 번 세지 않는다
      expect(
        judgeOffsite({ configured: true, latestReplicated: null, copies: 0 })
          .status,
      ).toBe("warn");
    });

    it("정상이면 사본 수를 말한다", () => {
      const result = judgeOffsite({
        configured: true,
        latestReplicated: true,
        copies: 5,
      });
      expect(result.status).toBe("pass");
      expect(result.detail).toContain("5개");
    });
  });

  describe("judgeIntegrity", () => {
    it("확인하지 못했으면 통과가 아니라 직접 확인이다", () => {
      const result = judgeIntegrity({
        readable: null,
        checksum: null,
        entries: null,
      });
      expect(result.status).toBe("manual");
    });

    it("읽히지 않는 덤프는 실패 — 복원 시점에 알면 늦다", () => {
      const result = judgeIntegrity({
        readable: false,
        checksum: "abc",
        entries: null,
      });
      expect(result.status).toBe("fail");
      expect(result.detail).toContain("즉시 다시 받으세요");
    });

    it("정상이면 객체 수와 체크섬 앞부분만 보여준다", () => {
      const checksum = "a".repeat(64);
      const result = judgeIntegrity({ readable: true, checksum, entries: 142 });
      expect(result.status).toBe("pass");
      expect(result.detail).toContain("142개");
      // 체크섬 전체를 화면에 늘어놓을 이유가 없다
      expect(result.detail).not.toContain(checksum);
      expect(result.detail).toContain("aaaaaaaaaaaa");
    });
  });

  describe("judgeStorageProtection (CTO 결정 1601-④)", () => {
    it("저장소가 알려 주지 않으면 통과가 아니라 직접 확인이다", () => {
      const result = judgeStorageProtection({
        versioning: "unknown",
        replication: "unknown",
      });
      expect(result.status).toBe("manual");
      expect(result.detail).toContain("애플리케이션은 이미지를 백업하지 않습니다");
    });

    it("둘 다 켜져 있으면 통과", () => {
      expect(
        judgeStorageProtection({
          versioning: "enabled",
          replication: "enabled",
        }).status,
      ).toBe("pass");
    });

    it("꺼져 있으면 무엇이 꺼졌는지 이름을 말한다", () => {
      const result = judgeStorageProtection({
        versioning: "enabled",
        replication: "disabled",
      });
      expect(result.status).toBe("warn");
      expect(result.detail).toContain("복제가 꺼져 있습니다");
      expect(result.detail).not.toContain("버전 관리·복제가 꺼져");
    });

    it("하나라도 모르면 나머지가 켜져 있어도 직접 확인이다", () => {
      expect(
        judgeStorageProtection({
          versioning: "enabled",
          replication: "unknown",
        }).status,
      ).toBe("manual");
    });
  });

  describe("judgeRecoveryObjectives", () => {
    it("측정치가 없으면 통과가 아니다", () => {
      const result = judgeRecoveryObjectives({
        lastBackupAgeMs: 60_000,
        measuredRestoreMs: null,
      });
      expect(result.status).toBe("manual");
      expect(result.rtoMet).toBeNull();
      expect(result.detail).toContain("한 번 복원해 보세요");
    });

    it("백업이 없으면 손실 구간을 계산할 수 없다", () => {
      const result = judgeRecoveryObjectives({
        lastBackupAgeMs: null,
        measuredRestoreMs: 5_000,
      });
      expect(result.status).toBe("manual");
      expect(result.rpoMs).toBeNull();
    });

    it("목표 안이면 통과하고, 측정된 하한임을 밝힌다", () => {
      const result = judgeRecoveryObjectives({
        lastBackupAgeMs: 2 * 60 * 60 * 1000,
        measuredRestoreMs: 90_000,
      });
      expect(result.status).toBe("pass");
      expect(result.rpoMet).toBe(true);
      expect(result.rtoMet).toBe(true);
      expect(result.detail).toContain("측정된 하한");
    });

    it("목표를 넘기면 주의로 표시한다", () => {
      const result = judgeRecoveryObjectives({
        lastBackupAgeMs: DEFAULT_RPO_MS + 1,
        measuredRestoreMs: DEFAULT_RTO_MS + 1,
      });
      expect(result.status).toBe("warn");
      expect(result.rpoMet).toBe(false);
      expect(result.rtoMet).toBe(false);
    });

    it("목표는 조정할 수 있다", () => {
      const result = judgeRecoveryObjectives({
        lastBackupAgeMs: 3 * 60 * 60 * 1000,
        measuredRestoreMs: 60_000,
        rpoTargetMs: 60 * 60 * 1000,
        rtoTargetMs: 30_000,
      });
      expect(result.rpoMet).toBe(false);
      expect(result.rtoMet).toBe(false);
    });
  });

  describe("judgeRestoreTarget (CTO 결정 1601-②)", () => {
    const production = "postgresql://app:pw@db.internal:5432/acos?schema=public";

    it("운영 DB를 가리키면 막는다", () => {
      const result = judgeRestoreTarget(
        production,
        "postgresql://app:pw@db.internal:5432/acos",
      );
      expect(result.verdict).toBe("same-as-production");
      expect(result.detail).toContain("검증이 곧 사고가 됩니다");
    });

    it("자격 증명만 다른 같은 DB도 같은 DB로 본다", () => {
      // 다른 사용자로 접속해도 지워지는 데이터는 같다
      const result = judgeRestoreTarget(
        production,
        "postgresql://other:secret@DB.INTERNAL:5432/ACOS",
      );
      expect(result.verdict).toBe("same-as-production");
    });

    it("DB 이름이 다르면 통과", () => {
      expect(
        judgeRestoreTarget(
          production,
          "postgresql://app:pw@db.internal:5432/acos_restore_check",
        ).verdict,
      ).toBe("ok");
    });

    it("호스트가 다르면 통과", () => {
      expect(
        judgeRestoreTarget(
          production,
          "postgresql://app:pw@restore.internal:5432/acos",
        ).verdict,
      ).toBe("ok");
    });

    it("포트 생략은 5432로 본다", () => {
      expect(
        judgeRestoreTarget(
          "postgresql://app:pw@db.internal/acos",
          "postgresql://app:pw@db.internal:5432/acos",
        ).verdict,
      ).toBe("same-as-production");
    });

    it("미설정은 사고가 아니라 미구성이다", () => {
      expect(judgeRestoreTarget(production, "").verdict).toBe("not-configured");
      expect(judgeRestoreTarget(production, undefined).verdict).toBe(
        "not-configured",
      );
    });

    it("주소를 읽을 수 없으면 같다고 단정하지 않는다", () => {
      expect(judgeRestoreTarget(production, "not-a-url").verdict).toBe("ok");
    });
  });

  describe("체크리스트 편입", () => {
    const base: DrState = {
      backup: { verdict: "ok", message: "정상", ageMs: 1000, sizeBytes: 5000 },
      restore: { verdict: "ok", message: "정상", ageMs: 1000, tables: 30 },
      database: { ok: true, detail: "연결 정상" },
      storage: { ok: true, detail: "버킷 정상" },
      lock: null,
      notificationChannels: 1,
      runbookPath: "docs/operations/disaster-recovery.md",
    };

    it("Enterprise 항목이 없으면 체크리스트가 늘어나지 않는다", () => {
      const items = buildDisasterRecoveryChecklist(base);
      expect(items.map((item) => item.id)).not.toContain("integrity");
    });

    it("덤프를 읽을 수 없으면 복구 불가로 판정한다", () => {
      const items = buildDisasterRecoveryChecklist({
        ...base,
        enterprise: {
          integrity: { status: "fail", detail: "손상" },
          offsite: { status: "pass", detail: "" },
          storageProtection: { status: "pass", detail: "" },
          objectives: { status: "pass", detail: "" },
          restoreTarget: { status: "pass", detail: "" },
        },
      });
      const summary = summarizeDisasterRecovery(items);
      expect(summary.recoverable).toBe(false);
      expect(summary.blockers.map((item) => item.id)).toContain("integrity");
    });

    it("복원 대상이 운영 DB면 복구 불가다", () => {
      const items = buildDisasterRecoveryChecklist({
        ...base,
        enterprise: {
          integrity: { status: "pass", detail: "" },
          offsite: { status: "pass", detail: "" },
          storageProtection: { status: "pass", detail: "" },
          objectives: { status: "pass", detail: "" },
          restoreTarget: { status: "fail", detail: "운영 DB와 같음" },
        },
      });
      expect(summarizeDisasterRecovery(items).recoverable).toBe(false);
    });

    it("원격 복제·저장소 보호·복구 목표는 복구 가능성을 막지 않는다", () => {
      // 백업이 로컬에 있으면 복구 자체는 된다 — 드러내되 막지는 않는다
      const items = buildDisasterRecoveryChecklist({
        ...base,
        enterprise: {
          integrity: { status: "pass", detail: "" },
          offsite: { status: "fail", detail: "" },
          storageProtection: { status: "warn", detail: "" },
          objectives: { status: "warn", detail: "" },
          restoreTarget: { status: "pass", detail: "" },
        },
      });
      const summary = summarizeDisasterRecovery(items);
      expect(summary.recoverable).toBe(true);
      expect(summary.fail).toBe(1);
    });
  });

  describe("신선도 기본값 (CTO 결정 1601-⑤)", () => {
    it("복구 목표 기본값은 RPO 24시간 · RTO 30분", () => {
      expect(DEFAULT_RPO_MS).toBe(24 * 60 * 60 * 1000);
      expect(DEFAULT_RTO_MS).toBe(30 * 60 * 1000);
    });
  });
});
