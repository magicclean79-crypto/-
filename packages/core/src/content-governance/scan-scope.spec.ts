import {
  ALL_SCAN_SCOPE,
  describeScanScope,
  projectScanScope,
  scanScopeProjectId,
} from "./scan-scope";

describe("스캔 범위 (TASK-2801, CTO 결정 2701-③④)", () => {
  it("전체와 프로젝트를 같은 문자열로 만들지 않는다", () => {
    expect(ALL_SCAN_SCOPE).toBe("all");
    expect(projectScanScope("p-1")).toBe("project:p-1");
    expect(projectScanScope("p-1")).not.toBe(ALL_SCAN_SCOPE);
  });

  it("범위에서 프로젝트를 되읽는다 — 전체는 null", () => {
    expect(scanScopeProjectId(projectScanScope("p-1"))).toBe("p-1");
    expect(scanScopeProjectId(ALL_SCAN_SCOPE)).toBeNull();
  });

  it("id에 콜론이 있어도 되읽을 수 있다", () => {
    // 접두어만 떼면 되므로 id 안의 콜론은 문제가 되지 않는다
    expect(scanScopeProjectId(projectScanScope("a:b"))).toBe("a:b");
  });

  describe("사람이 읽는 이름", () => {
    it("이름을 알면 이름을 쓴다 — id만 보여 주면 조치로 이어지지 않는다", () => {
      expect(
        describeScanScope(projectScanScope("p-1"), { "p-1": "매직클린" }),
      ).toBe("프로젝트 매직클린 (p-1)");
    });

    it("이름을 모르면 id를 쓰되 이름처럼 보여 주지 않는다", () => {
      expect(describeScanScope(projectScanScope("p-9"))).toBe("프로젝트 p-9");
    });

    it("전체 범위는 '전체'다", () => {
      expect(describeScanScope(ALL_SCAN_SCOPE)).toBe("전체");
      expect(describeScanScope(ALL_SCAN_SCOPE, { "p-1": "매직클린" })).toBe(
        "전체",
      );
    });
  });
});
