import {
  crossCheckMajorMigrations,
  isMajorMigrationName,
} from "./major-migrations";

describe("Major Migration 지정 (TASK-2101, CTO 결정 2001-③)", () => {
  describe("isMajorMigrationName", () => {
    it("_major_를 포함하면 major다", () => {
      expect(isMajorMigrationName("20260810000000_major_order_split")).toBe(
        true,
      );
    });

    it("포함하지 않으면 아니다", () => {
      expect(isMajorMigrationName("20260802000000_remote_verify")).toBe(false);
      // 단어의 일부로 우연히 걸리지 않는다
      expect(isMajorMigrationName("20260802000000_majority_vote")).toBe(false);
    });
  });

  describe("crossCheckMajorMigrations", () => {
    it("매니페스트와 파일명 규칙이 일치하면 통과", () => {
      const result = crossCheckMajorMigrations({
        manifest: ["20260101000000_a", "20260202000000_major_b"],
        migrationNames: [
          "20260101000000_a",
          "20260202000000_major_b",
          "20260303000000_c",
        ],
      });
      expect(result.ok).toBe(true);
      expect(result.effective).toEqual([
        "20260101000000_a",
        "20260202000000_major_b",
      ]);
    });

    it("파일명은 _major_인데 매니페스트에 없으면 어긋난 것이다", () => {
      const result = crossCheckMajorMigrations({
        manifest: [],
        migrationNames: ["20260202000000_major_b"],
      });
      expect(result.ok).toBe(false);
      expect(result.missingFromManifest).toEqual(["20260202000000_major_b"]);
      expect(result.detail).toContain("major-migrations.json에 추가하세요");
    });

    it("매니페스트에 있는데 마이그레이션이 없으면 지정이 사라진 것이다", () => {
      const result = crossCheckMajorMigrations({
        manifest: ["20260101000000_gone"],
        migrationNames: ["20260303000000_c"],
      });
      expect(result.ok).toBe(false);
      expect(result.unknownInManifest).toEqual(["20260101000000_gone"]);
      expect(result.detail).toContain("조용히 사라진");
    });

    it("매니페스트에만 있고 규칙을 안 따르는 것은 오류가 아니다", () => {
      // 규칙 도입 전에 지정한 마이그레이션 — 이름을 소급해 바꾸면
      // 적용 이력(_prisma_migrations)과 어긋난다
      const result = crossCheckMajorMigrations({
        manifest: ["20260101000000_legacy"],
        migrationNames: ["20260101000000_legacy"],
      });
      expect(result.ok).toBe(true);
      expect(result.effective).toEqual(["20260101000000_legacy"]);
    });

    it("두 지정을 합집합으로 본다 — 한쪽에만 적어도 놓치지 않는다", () => {
      const result = crossCheckMajorMigrations({
        manifest: ["20260101000000_legacy", "20260202000000_major_b"],
        migrationNames: [
          "20260101000000_legacy",
          "20260202000000_major_b",
          "20260303000000_major_c",
        ],
      });
      // _major_c는 매니페스트에 없어 ok는 아니지만, **major로는 센다** —
      // 지정을 놓치는 쪽이 리허설을 빠뜨리는 쪽보다 위험하다
      expect(result.ok).toBe(false);
      expect(result.effective).toContain("20260303000000_major_c");
    });

    it("둘 다 비어 있으면 통과하고 0건이라고 말한다", () => {
      const result = crossCheckMajorMigrations({
        manifest: [],
        migrationNames: ["20260303000000_c"],
      });
      expect(result.ok).toBe(true);
      expect(result.effective).toEqual([]);
      expect(result.detail).toContain("0건");
    });
  });
});
