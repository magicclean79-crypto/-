import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 하지 않기로 한 것을 고정한다. (TASK-2801 — CTO 결정 2701-①②)
 *
 * **하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가 "안전을 위해"
 * 되살려도 아무도 모른다.** 그래서 없다는 사실 자체를 테스트로 남긴다 —
 * 우회 플래그를 두지 않기로 한 것(결정 2201-③)을 고정한 것과 같은 이유다.
 */

const source = (relative: string) =>
  readFileSync(join(__dirname, relative), "utf8");

describe("발행 경계 — 하지 않기로 한 것 (TASK-2801)", () => {
  describe("되살리기 권한은 EDITOR 이상을 유지한다 (CTO 결정 2701-①)", () => {
    const controller = source("./contents.controller.ts");

    it("상태 전이는 EDITOR 이상이다 — 되살리기만 따로 올리지 않았다", () => {
      // 되살리기는 별도 API가 아니라 같은 상태 전이 경로다. 그 경로의 요구
      // 권한이 EDITOR라는 사실이 곧 결정 ①의 구현이다.
      expect(controller).toContain('@RequireRole("EDITOR")');
    });

    it("ADMIN을 요구하는 전이 경로가 없다", () => {
      // ADMIN으로 올리면 콘텐츠를 고치는 사람이 내린 것을 되살릴 수 없고,
      // 그러면 사람들은 새 콘텐츠를 만들어 우회한다 — 내린 이유가 끊긴다
      expect(controller).not.toContain('@RequireRole("ADMIN")');
      expect(controller).not.toContain("ADMIN");
    });

    it("되살리기를 별도 경로로 분리하지 않았다", () => {
      // 별도 경로를 만들면 권한·감사 이력이 두 갈래가 된다
      for (const forbidden of ["revive", "restore", "unarchive"]) {
        expect(controller.toLowerCase()).not.toContain(forbidden);
      }
    });
  });

  describe("최초 발행 시각은 덮어쓰지 않는다 (CTO 결정 2701-②)", () => {
    const service = source("./contents.service.ts");

    it("발행 시각 판정은 core의 순수 함수 하나만 쓴다", () => {
      // 시각을 두 곳에서 정하면 한쪽이 최초 시각을 덮어쓰는 순간을 아무도
      // 알아채지 못한다
      expect(service).toContain("resolvePublishTimestamps");
      expect(service.match(/resolvePublishTimestamps/g)).toHaveLength(2); // import + 호출
    });

    it("서비스가 직접 발행 시각을 만들지 않는다", () => {
      expect(service).not.toContain("publishedAt: new Date()");
      expect(service).not.toContain("lastPublishedAt: new Date()");
    });
  });
});
