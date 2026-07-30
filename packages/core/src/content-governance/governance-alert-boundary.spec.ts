import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_SCAN_SCOPE,
  NEW_VIOLATION_SAMPLE_LIMIT,
  compareScan,
  detectGovernanceScanAlert,
  diffViolations,
  projectScanScope,
} from ".";
import type { ScanTotals, ViolatingContent } from "./scan-alert";

/**
 * 유지하기로 한 것과 만들지 않기로 한 것을 고정한다.
 * (TASK-2901 — CTO 결정 2801-①②③④)
 *
 * 승인 결정에는 "유지한다"도 있습니다. **유지 결정은 코드에 흔적이 남지
 * 않아서**, 나중에 누가 "정리"하면서 없애도 아무도 모릅니다 — 그래서
 * 있다는 사실 자체를 테스트로 남깁니다.
 */

const source = (relative: string) =>
  readFileSync(join(__dirname, relative), "utf8");

const totals = (blocked: number, publishedViolations = 0): ScanTotals => ({
  blocked,
  publishedViolations,
  scanned: 10,
});

const violating = (id: string): ViolatingContent => ({
  contentId: id,
  title: `제목 ${id}`,
  contentStatus: "REVIEW",
});

describe("거버넌스 경보 경계 (TASK-2901, CTO 결정 2801-①~④)", () => {
  describe("전체 범위 Alert를 유지한다 (결정 2801-①)", () => {
    it("전체 범위에서도 경보가 만들어진다", () => {
      const [alert] = detectGovernanceScanAlert(
        compareScan(totals(1), totals(3)),
        totals(3),
        { scope: ALL_SCAN_SCOPE },
      );
      expect(alert).toBeDefined();
      expect(alert.key).toContain(`:${ALL_SCAN_SCOPE}`);
      expect(alert.title).toContain("전체");
    });
  });

  describe("프로젝트별 Alert도 유지한다 (결정 2801-②)", () => {
    it("프로젝트 범위 경보가 전체와 다른 키로 남는다", () => {
      // 둘 중 하나를 없애면 ⓐ 어디가 나빠졌는지 모르거나
      // ⓑ 전체 규모를 알 수 없게 된다 — 그래서 둘 다 유지한다
      const [all] = detectGovernanceScanAlert(
        compareScan(totals(1), totals(2)),
        totals(2),
        { scope: ALL_SCAN_SCOPE },
      );
      const [project] = detectGovernanceScanAlert(
        compareScan(totals(1), totals(2)),
        totals(2),
        { scope: projectScanScope("p-1") },
      );
      expect(all.key).not.toBe(project.key);
      expect(project.key).toContain("project:p-1");
    });
  });

  describe("신규 위반 표본은 10건 고정이다 (결정 2801-③)", () => {
    it("상한이 10이다", () => {
      expect(NEW_VIOLATION_SAMPLE_LIMIT).toBe(10);
    });

    it("환경변수로 바꿀 수 없다 — core는 환경을 읽지 않는다", () => {
      // 열어 두면 "일단 늘려 두는" 우회가 생기고 경보가 목록이 된다
      const code = source("./scan-alert.ts");
      expect(code).not.toContain("process.env");
      expect(code).not.toContain("SAMPLE_LIMIT_ENV");
    });

    it("11건이면 10건만 담고 생략을 밝힌다", () => {
      const many = Array.from({ length: 11 }, (_, index) =>
        violating(`c-${index}`),
      );
      const [alert] = detectGovernanceScanAlert(
        compareScan(totals(0), totals(11)),
        totals(11),
        { scope: ALL_SCAN_SCOPE, diff: diffViolations([], many) },
      );
      expect(alert.message).toContain("새로 위반된 콘텐츠 11건");
      expect(alert.message).toContain("나머지 1건은 문구에 담지 않았습니다");
    });
  });

  describe("작성자 직접 알림은 만들지 않았다 (결정 2801-④)", () => {
    it("경보에 수신자 개념이 없다", () => {
      // 경보는 운영 채널로만 갑니다. 작성자 알림을 넣으면 콘텐츠 1건이
      // 여러 사람에게 개별로 나가고, 그 경로의 실패는 아무도 보지 못합니다.
      const code = source("./scan-alert.ts");
      for (const forbidden of [
        "author",
        "recipient",
        "notifyUser",
        "assignee",
        "작성자",
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it("감지 결과에 사람 식별자가 없다", () => {
      const [alert] = detectGovernanceScanAlert(
        compareScan(totals(1), totals(2)),
        totals(2),
        { scope: ALL_SCAN_SCOPE, diff: diffViolations([], [violating("c-1")]) },
      );
      expect(Object.keys(alert).sort()).toEqual([
        "key",
        "kind",
        "level",
        "message",
        "title",
      ]);
    });
  });
});
