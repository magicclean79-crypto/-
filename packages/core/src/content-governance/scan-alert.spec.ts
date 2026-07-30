import {
  GOVERNANCE_SCAN_ALERT_KEY,
  compareScan,
  describeScanRun,
  detectGovernanceScanAlert,
  shouldSyncScanAlerts,
  totalViolations,
} from "./scan-alert";
import type { ScanTotals } from "./scan-alert";

const totals = (
  blocked: number,
  publishedViolations = 0,
  scanned = 10,
): ScanTotals => ({ blocked, publishedViolations, scanned });

const detect = (
  previous: ScanTotals | null,
  current: ScanTotals,
  scope = "all",
) =>
  detectGovernanceScanAlert(compareScan(previous, current), current, { scope });

describe("예약 스캔 경보 (TASK-2701, CTO 결정 2601-③)", () => {
  it("막아야 할 위반만 센다 — 주의는 세지 않는다", () => {
    expect(totalViolations(totals(3, 2))).toBe(5);
    expect(totalViolations(totals(0, 0))).toBe(0);
  });

  describe("첫 스캔은 기준선이다", () => {
    it("위반이 많아도 경보하지 않는다", () => {
      // 규칙을 처음 켠 직후에 위반이 잔뜩 있는 것은 정상이고,
      // 그때 전량을 경보로 만들면 아무 뜻이 없다
      expect(detect(null, totals(30, 5))).toEqual([]);
      expect(compareScan(null, totals(30)).verdict).toBe("baseline");
    });

    it("기준선을 세웠다는 사실은 이력에 남는다", () => {
      const detail = describeScanRun(
        compareScan(null, totals(30, 5)),
        totals(30, 5),
      );
      expect(detail).toContain("첫 스캔이므로 기준선");
      expect(detail).toContain("경보하지 않았습니다");
    });
  });

  describe("늘었을 때만 부른다", () => {
    it("늘면 경보하고 증가분을 말한다", () => {
      const [alert] = detect(totals(2), totals(5));
      expect(alert.kind).toBe("governance-scan");
      expect(alert.level).toBe("warning");
      expect(alert.title).toContain("늘었습니다");
      expect(alert.message).toContain("2건에서 5건으로 3건 늘었습니다");
      expect(compareScan(totals(2), totals(5)).delta).toBe(3);
    });

    it("같으면 경보를 만들지 않는다", () => {
      // 증가가 없으면 경보가 생겨서는 안 된다 (결정 2601-③)
      expect(detect(totals(3), totals(3))).toEqual([]);
      expect(compareScan(totals(3), totals(3)).verdict).toBe("unchanged");
    });

    it("같은 결과의 이력 문구가 반복 경보하지 않는 이유를 밝힌다", () => {
      const detail = describeScanRun(
        compareScan(totals(3), totals(3)),
        totals(3),
      );
      expect(detail).toContain("지난번과 같습니다");
      expect(detail).toContain("반복 경보하지 않습니다");
      expect(detail).toContain("2601-③");
    });

    it("줄어든 것으로는 부르지 않는다 — 좋은 일로 사람을 깨우지 않는다", () => {
      expect(compareScan(totals(5), totals(2)).verdict).toBe("decreased");
      expect(detect(totals(5), totals(2))).toEqual([]);
      expect(
        describeScanRun(compareScan(totals(5), totals(2)), totals(2)),
      ).toContain("줄어든 것으로는 경보하지 않습니다");
    });
  });

  describe("경보 저장소를 언제 건드리는가 (자체 발견 결함)", () => {
    /**
     * `sync`는 "이번에 감지되지 않았으면 해소"로 판단한다. 그래서 아무 때나
     * 부르면 **늘지 않았는데 경보가 새로 생기거나**(결정 ③ 위반),
     * **남아 있는 위반이 풀렸다고 알려진다.**
     */
    it("늘었을 때와 0이 됐을 때만 동기화한다", () => {
      expect(shouldSyncScanAlerts(compareScan(totals(1), totals(3)))).toBe(true);
      expect(shouldSyncScanAlerts(compareScan(totals(3), totals(0)))).toBe(true);
    });

    it("첫 스캔·같음·줄었음에는 저장소를 건드리지 않는다", () => {
      for (const [previous, current] of [
        [null, totals(5)],
        [totals(3), totals(3)],
        [totals(5), totals(2)],
        [totals(0), totals(0)],
      ] as [ScanTotals | null, ScanTotals][]) {
        expect(shouldSyncScanAlerts(compareScan(previous, current))).toBe(false);
      }
    });

    it("동기화하지 않는 경우에는 감지 결과도 비어 있다 — 둘이 어긋나지 않는다", () => {
      for (const [previous, current] of [
        [null, totals(5)],
        [totals(3), totals(3)],
        [totals(5), totals(2)],
      ] as [ScanTotals | null, ScanTotals][]) {
        const change = compareScan(previous, current);
        expect(shouldSyncScanAlerts(change)).toBe(false);
        expect(
          detectGovernanceScanAlert(change, current, { scope: "all" }),
        ).toEqual([]);
      }
    });
  });

  describe("해소", () => {
    it("0이 되면 경보를 내려 해소한다", () => {
      expect(compareScan(totals(3), totals(0)).verdict).toBe("resolved");
      expect(detect(totals(3), totals(0))).toEqual([]);
    });

    it("없던 것이 계속 없는 것은 해소가 아니다 — 알릴 것이 없다", () => {
      // 해소는 있던 것이 없어졌을 때만이다
      expect(compareScan(totals(0), totals(0)).verdict).toBe("unchanged");
      expect(detect(totals(0), totals(0))).toEqual([]);
      expect(
        describeScanRun(compareScan(totals(0), totals(0)), totals(0)),
      ).toContain("지난번과 같습니다");
    });
  });

  describe("이미 나간 위반은 심각이다", () => {
    it("이미 발행된 위반이 섞이면 critical", () => {
      const [alert] = detect(totals(1), totals(1, 1));
      expect(alert.level).toBe("critical");
      expect(alert.message).toContain("이미 발행된 위반 1건");
      expect(alert.message).toContain("내려야 합니다");
    });

    it("막을 수 있는 것만이면 warning", () => {
      expect(detect(totals(1), totals(4))[0].level).toBe("warning");
    });
  });

  describe("범위마다 키가 다르다", () => {
    it("프로젝트와 전체를 한 경보로 뭉치지 않는다", () => {
      // 뭉치면 어디를 봐야 할지 알 수 없다
      const all = detect(totals(1), totals(2), "all")[0];
      const project = detect(totals(1), totals(2), "project:p-1")[0];
      expect(all.key).toBe(`${GOVERNANCE_SCAN_ALERT_KEY}:all`);
      expect(project.key).toBe(`${GOVERNANCE_SCAN_ALERT_KEY}:project:p-1`);
      expect(all.key).not.toBe(project.key);
    });

    it("같은 범위는 같은 키다 — 키가 바뀌면 중복 판정이 깨진다", () => {
      expect(detect(totals(1), totals(2), "all")[0].key).toBe(
        detect(totals(2), totals(9), "all")[0].key,
      );
    });
  });

  it("경보 문구가 스캔이 상태를 바꾸지 않는다고 밝힌다", () => {
    const [alert] = detect(totals(1), totals(3));
    expect(alert.message).toContain("상태를 바꾸지 않습니다");
  });

  it("어떤 조합에서도 마크다운 강조가 새지 않는다", () => {
    for (const [previous, current] of [
      [null, totals(3, 1)],
      [totals(1), totals(5, 2)],
      [totals(5), totals(2)],
      [totals(3), totals(3)],
      [totals(3), totals(0)],
    ] as [ScanTotals | null, ScanTotals][]) {
      for (const alert of detect(previous, current)) {
        expect(alert.title).not.toContain("**");
        expect(alert.message).not.toContain("**");
      }
      expect(
        describeScanRun(compareScan(previous, current), current),
      ).not.toContain("**");
    }
  });
});
