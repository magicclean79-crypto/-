import {
  DEFAULT_CHAIN_GAP_FACTOR,
  SCALE_MILESTONES_BYTES,
  detectBackupChainAlert,
  detectRemoteIntegrityAlert,
  detectScaleAlert,
  judgeBackupChain,
  judgeDatabaseScale,
  judgeRemoteIntegrity,
  judgeStorageStandard,
} from "./backup-integrity";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 7, 1, 12, 0, 0);

/** 시간당 1회로 이어지는 사슬 */
const chain = (count: number, fromHoursAgo = 24) =>
  Array.from({ length: count }, (_, index) => ({
    ok: true,
    createdAt: now - (fromHoursAgo - index) * HOUR,
  }));

describe("Backup Integrity Platform (TASK-2001)", () => {
  describe("judgeBackupChain", () => {
    it("빈틈 없이 이어지면 통과", () => {
      const result = judgeBackupChain(chain(24), { now, intervalMs: HOUR });
      expect(result.status).toBe("pass");
      expect(result.actual).toBe(24);
      expect(result.detail).toContain("24/24회");
    });

    it("공백이 간격의 2배를 넘으면 실패 — 되돌아갈 수 없는 구간이다", () => {
      // 5시간 비운다
      const records = [...chain(10, 24), ...chain(9, 9)];
      const result = judgeBackupChain(records, { now, intervalMs: HOUR });
      expect(result.status).toBe("fail");
      expect(result.longestGapMs).toBeGreaterThan(2 * HOUR);
      expect(result.detail).toContain("복구할 수 없습니다");
      expect(result.detail).toContain("돌지 않은 백업은 아무 데도 기록되지 않습니다");
    });

    it("개별 백업이 전부 성공이어도 사슬은 끊길 수 있다", () => {
      // 실패 기록이 하나도 없는데 개수가 모자란 경우
      const records = chain(4, 24);
      const result = judgeBackupChain(records, { now, intervalMs: HOUR });
      expect(records.every((entry) => entry.ok)).toBe(true);
      expect(result.status).toBe("fail");
    });

    it("한 번 걸러도 2배 안이면 통과 — 지연에 매번 경보하지 않는다", () => {
      const records = [
        { ok: true, createdAt: now - 3 * HOUR },
        { ok: true, createdAt: now - 1.5 * HOUR },
        { ok: true, createdAt: now - 0.5 * HOUR },
      ];
      const result = judgeBackupChain(records, {
        now,
        intervalMs: HOUR,
        startedAt: now - 3 * HOUR,
      });
      expect(result.status).toBe("pass");
    });

    it("마지막 백업 이후의 공백도 센다", () => {
      const result = judgeBackupChain(chain(20, 24).slice(0, 15), {
        now,
        intervalMs: HOUR,
      });
      expect(result.status).toBe("fail");
      expect(result.gapStartedAt).not.toBeNull();
    });

    it("방금 뜬 서버를 사슬이 끊겼다고 하지 않는다", () => {
      const result = judgeBackupChain([], {
        now,
        intervalMs: HOUR,
        startedAt: now - 30 * 60 * 1000,
      });
      expect(result.status).toBe("manual");
      expect(result.detail).toContain("관측 구간이 짧아");
    });

    it("재기동이 공백을 지우지 않는다 — 꺼져 있던 동안이 진짜 공백이다", () => {
      // 5시간 전까지 돌다가 멈췄고, 방금 다시 떴다
      const records = [
        { ok: true, createdAt: now - 7 * HOUR },
        { ok: true, createdAt: now - 6 * HOUR },
        { ok: true, createdAt: now - 5 * HOUR },
        { ok: true, createdAt: now - 5 * 60 * 1000 },
      ];
      const result = judgeBackupChain(records, {
        now,
        intervalMs: HOUR,
        startedAt: now - 10 * 60 * 1000,
      });
      expect(result.status).toBe("fail");
      expect(result.longestGapMs).toBeGreaterThan(4 * HOUR);
    });

    it("이력이 아예 없는 첫 도입은 여전히 판정하지 않는다", () => {
      const result = judgeBackupChain([{ ok: true, createdAt: now - 60_000 }], {
        now,
        intervalMs: HOUR,
        startedAt: now - 10 * 60 * 1000,
      });
      expect(result.status).toBe("manual");
    });

    it("창 안에 성공이 하나도 없으면 실패", () => {
      const result = judgeBackupChain([{ ok: false, createdAt: now - HOUR }], {
        now,
        intervalMs: HOUR,
      });
      expect(result.status).toBe("fail");
      expect(result.actual).toBe(0);
    });

    it("1분 미만 공백을 '0분'이라 쓰지 않는다 — 공백이 없다는 뜻으로 읽힌다", () => {
      const second = 1000;
      const records = Array.from({ length: 20 }, (_, index) => ({
        ok: true,
        createdAt: now - (20 - index) * 20 * second,
      }));
      const result = judgeBackupChain(records, {
        now,
        intervalMs: 20 * second,
        windowMs: 400 * second,
      });
      expect(result.status).toBe("pass");
      expect(result.detail).toContain("20초");
      expect(result.detail).not.toContain("0분");
    });

    it("공백 배수는 조정할 수 있다", () => {
      const records = [
        { ok: true, createdAt: now - 24 * HOUR },
        { ok: true, createdAt: now - 21 * HOUR },
        { ok: true, createdAt: now },
      ];
      expect(
        judgeBackupChain(records, { now, intervalMs: HOUR, gapFactor: 100 })
          .status,
      ).toBe("pass");
      expect(DEFAULT_CHAIN_GAP_FACTOR).toBe(2);
    });

    it("사슬 공백은 심각 경보다", () => {
      const alerts = detectBackupChainAlert(
        judgeBackupChain(chain(3, 24), { now, intervalMs: HOUR }),
      );
      expect(alerts[0]).toMatchObject({
        kind: "backup-integrity",
        key: "backup-integrity:chain",
        level: "critical",
      });
      expect(alerts[0].message).not.toContain("**");
    });

    it("정상이면 경보하지 않는다", () => {
      expect(
        detectBackupChainAlert(
          judgeBackupChain(chain(24), { now, intervalMs: HOUR }),
        ),
      ).toEqual([]);
    });
  });

  describe("judgeRemoteIntegrity", () => {
    it("확인하지 않았으면 통과가 아니라 직접 확인이다", () => {
      const result = judgeRemoteIntegrity(null);
      expect(result.verdict).toBe("unchecked");
      expect(result.status).toBe("manual");
      expect(result.detail).toContain("전송 비용");
    });

    it("원격에 없으면 실패 — 올렸다는 기록만 남은 상태다", () => {
      const result = judgeRemoteIntegrity({
        found: false,
        remoteChecksum: null,
        recordedChecksum: "a".repeat(64),
      });
      expect(result.verdict).toBe("missing");
      expect(result.status).toBe("fail");
    });

    it("체크섬이 다르면 실패 — 복구를 장담할 수 없다", () => {
      const result = judgeRemoteIntegrity({
        found: true,
        remoteChecksum: "b".repeat(64),
        recordedChecksum: "a".repeat(64),
      });
      expect(result.verdict).toBe("mismatch");
      expect(result.detail).toContain("덮어써졌을 수 있습니다");
    });

    it("일치하면 통과하고 체크섬 앞부분만 보여준다", () => {
      const checksum = "c".repeat(64);
      const result = judgeRemoteIntegrity({
        found: true,
        remoteChecksum: checksum,
        recordedChecksum: checksum,
      });
      expect(result.verdict).toBe("ok");
      expect(result.detail).not.toContain(checksum);
    });

    it("실패만 경보한다", () => {
      expect(detectRemoteIntegrityAlert(judgeRemoteIntegrity(null))).toEqual([]);
      expect(
        detectRemoteIntegrityAlert(
          judgeRemoteIntegrity({
            found: false,
            remoteChecksum: null,
            recordedChecksum: "a",
          }),
        )[0],
      ).toMatchObject({ key: "backup-integrity:remote", level: "critical" });
    });
  });

  describe("judgeDatabaseScale (CTO 결정 1901-④)", () => {
    it("재평가 기준은 10 · 50 · 100GB", () => {
      expect(SCALE_MILESTONES_BYTES).toEqual([
        10 * 1024 ** 3,
        50 * 1024 ** 3,
        100 * 1024 ** 3,
      ]);
    });

    it("작으면 통과하고 다음 기준까지 남은 크기를 말한다", () => {
      const result = judgeDatabaseScale(2 * 1024 ** 3);
      expect(result.status).toBe("pass");
      expect(result.detail).toContain("10.0GB까지");
      expect(result.reachedMilestone).toBeNull();
    });

    it("기준을 넘으면 주의 — 크기 자체가 문제가 아니라 재평가 신호다", () => {
      const result = judgeDatabaseScale(60 * 1024 ** 3);
      expect(result.status).toBe("warn");
      expect(result.reachedMilestone).toBe(50 * 1024 ** 3);
      expect(result.nextMilestone).toBe(100 * 1024 ** 3);
      expect(result.detail).toContain("실측으로 다시 재세요");
      expect(result.detail).toContain("자동으로 바꾸지는 않습니다");
    });

    it("마지막 기준을 넘으면 다음이 없다", () => {
      const result = judgeDatabaseScale(200 * 1024 ** 3);
      expect(result.reachedMilestone).toBe(100 * 1024 ** 3);
      expect(result.nextMilestone).toBeNull();
    });

    it("크기를 모르면 통과로 세지 않는다", () => {
      expect(judgeDatabaseScale(null).status).toBe("manual");
    });

    it("1GB 미만을 '0.0GB'라고 쓰지 않는다 — 비어 있다는 뜻으로 읽힌다", () => {
      // 실제 운영 DB 10.5MB에서 "데이터베이스 0.0GB"로 나왔다
      const result = judgeDatabaseScale(10_550_295);
      expect(result.detail).toContain("10.1MB");
      expect(result.detail).not.toContain("데이터베이스 0.0GB");
    });

    it("경보 키가 기준마다 다르다 — 10GB를 해소하고 50GB에서 다시 알린다", () => {
      expect(detectScaleAlert(judgeDatabaseScale(12 * 1024 ** 3))[0].key).toBe(
        `backup-integrity:scale:${10 * 1024 ** 3}`,
      );
      expect(detectScaleAlert(judgeDatabaseScale(60 * 1024 ** 3))[0].key).toBe(
        `backup-integrity:scale:${50 * 1024 ** 3}`,
      );
      expect(detectScaleAlert(judgeDatabaseScale(1024 ** 3))).toEqual([]);
    });
  });

  describe("judgeStorageStandard (CTO 결정 1901-③)", () => {
    it("운영에서 S3가 아니면 실패", () => {
      const result = judgeStorageStandard("http://minio.internal:9000", true);
      expect(result.status).toBe("fail");
      expect(result.standard).toBe(false);
      expect(result.detail).toContain("Sprint 20부터 운영 표준은 Amazon S3입니다");
    });

    it("운영에서 S3면 통과", () => {
      const result = judgeStorageStandard(
        "https://s3.ap-northeast-2.amazonaws.com",
        true,
      );
      expect(result.status).toBe("pass");
      expect(result.standard).toBe(true);
    });

    it("개발에서는 개발 저장소가 정상이다 — 개발자에게 S3를 요구하지 않는다", () => {
      const result = judgeStorageStandard("http://localhost:9000", false);
      expect(result.status).toBe("pass");
      expect(result.standard).toBe(false);
      expect(result.detail).toContain("개발에서는 정상");
    });

    it("해석할 수 없는 주소는 실패로 단정하지 않는다", () => {
      expect(judgeStorageStandard("not-a-url", true).status).toBe("manual");
    });

    it("미설정은 운영에서 실패", () => {
      expect(judgeStorageStandard(null, true).status).toBe("fail");
      expect(judgeStorageStandard(undefined, false).status).toBe("manual");
    });
  });
});
