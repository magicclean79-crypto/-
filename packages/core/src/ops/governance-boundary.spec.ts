import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_SPECS } from "./env-spec";
import { resolveProvisioningPolicy } from "./storage-provisioning";
import {
  detectRemoteIntegrityAlert,
  judgeRemoteIntegrity,
} from "./backup-integrity";

const API_SRC = join(__dirname, "..", "..", "..", "..", "apps", "api", "src");

/**
 * 거버넌스 경계 고정. (TASK-2301, Sprint 23)
 *
 * 결정으로 **하지 않기로 한 것**을 테스트로 못 박는다. 하지 않기로 한 일은
 * 코드에 흔적이 없어서, 나중에 누가 "편의를 위해" 되살려도 아무도 모른다.
 * 기록되지 않는 규칙은 지켜지지 않는다.
 */
describe("거버넌스 경계 (TASK-2301)", () => {
  describe("자동 복구를 만들지 않는다 (CTO 결정 2201-②)", () => {
    it("원격 사본 실패 경보가 수동 복구임을 밝힌다", () => {
      const alerts = detectRemoteIntegrityAlert(
        judgeRemoteIntegrity({
          found: false,
          remoteChecksum: null,
          recordedChecksum: "a".repeat(64),
        }),
      );
      expect(alerts[0].level).toBe("critical");
      expect(alerts[0].message).toContain("자동으로 다시 올리지 않습니다");
      // 무엇을 해야 하는지 적지 않은 경보는 읽어도 할 일이 없다
      expect(alerts[0].message).toContain("사람이 복구하세요");
      expect(alerts[0].message).toContain("disaster-recovery.md");
    });

    it("대조 경로가 업로드를 부르지 않는다", () => {
      // 대조하다가 다시 올리면, 로컬 덤프가 온전한지 확인하지 않은 채
      // 원격을 덮어써 **틀린 사본을 더 확실하게** 만들 수 있다
      const source = readFileSync(
        join(API_SRC, "ops", "backup.service.ts"),
        "utf8",
      );
      const verifySection = source.slice(
        source.indexOf("async verifyRemoteCopies"),
        source.indexOf("get rtoTargetMs"),
      );
      expect(verifySection.length).toBeGreaterThan(0);
      expect(verifySection).not.toContain("putBackupObject");
    });

    it("경보 문구에 마크다운을 쓰지 않는다 — 로그에 그대로 나간다", () => {
      const alerts = detectRemoteIntegrityAlert(
        judgeRemoteIntegrity({
          found: true,
          remoteChecksum: "b".repeat(64),
          recordedChecksum: "a".repeat(64),
        }),
      );
      expect(alerts[0].message).not.toContain("**");
    });
  });

  describe("STORAGE_PROVISIONING 플래그를 추가하지 않는다 (CTO 결정 2201-③)", () => {
    it("환경변수 선언에 없다", () => {
      expect(
        ENV_SPECS.some((spec) => spec.name === "STORAGE_PROVISIONING"),
      ).toBe(false);
    });

    it("그 이름을 설정해도 정책이 바뀌지 않는다", () => {
      const forced = resolveProvisioningPolicy({
        NODE_ENV: "production",
        STORAGE_PROVISIONING: "managed",
      });
      expect(forced.mode).toBe("external");
      expect(forced.mayCreateBucket).toBe(false);
    });

    it("정책은 NODE_ENV만 본다", () => {
      expect(resolveProvisioningPolicy({ NODE_ENV: "production" }).mode).toBe(
        "external",
      );
      expect(resolveProvisioningPolicy({ NODE_ENV: "staging" }).mode).toBe(
        "managed",
      );
    });
  });

  describe("애플리케이션은 스키마를 적용하지 않는다 (CTO 결정 2201-①)", () => {
    it("어느 환경에서도 적용 권한이 없다", () => {
      for (const env of [{ NODE_ENV: "production" }, {}]) {
        expect(resolveProvisioningPolicy(env).mayApplyMigrations).toBe(false);
      }
    });

    it("운영 정책 문구가 세 가지를 모두 말한다", () => {
      const detail = resolveProvisioningPolicy({
        NODE_ENV: "production",
      }).detail;
      expect(detail).toContain("저장소");
      expect(detail).toContain("접근 권한");
      expect(detail).toContain("스키마");
      expect(detail).toContain("검증만");
      // 로그·화면에 그대로 나간다
      expect(detail).not.toContain("**");
    });
  });
});
