import {
  GOVERNANCE_SCAN_ALERT_KEY,
  NEW_VIOLATION_SAMPLE_LIMIT,
  compareScan,
  describeNewViolations,
  describeScanRun,
  detectGovernanceScanAlert,
  diffViolations,
  shouldSyncScanAlerts,
  totalViolations,
} from "./scan-alert";
import type { ScanTotals, ViolatingContent } from "./scan-alert";

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

  describe("새로 위반된 콘텐츠 (TASK-2801, CTO 결정 2701-⑤)", () => {
    const violating = (id: string, title = `제목 ${id}`): ViolatingContent => ({
      contentId: id,
      title,
      contentStatus: "REVIEW",
    });

    describe("대조", () => {
      it("지난 목록에 없던 것만 새로 위반이다", () => {
        const diff = diffViolations(["a"], [violating("a"), violating("b")]);
        expect(diff.newly.map((item) => item.contentId)).toEqual(["b"]);
        expect(diff.newlyCount).toBe(1);
        expect(diff.resolvedCount).toBe(0);
        expect(diff.comparable).toBe(true);
      });

      it("사라진 것도 센다 — 총량이 같아도 구성이 바뀔 수 있다", () => {
        const diff = diffViolations(["a", "b"], [violating("b"), violating("c")]);
        expect(diff.newlyCount).toBe(1);
        expect(diff.resolvedCount).toBe(1);
      });

      it("지난 목록이 없으면 0건이 아니라 '가릴 수 없음'이다", () => {
        // null과 빈 배열을 섞으면 목록을 두기 전의 위반이 전부 "새로 생겼다"로
        // 보고된다 — 첫 실행에 10건이 경보 문구에 실리는 그 결함
        const unknown = diffViolations(null, [violating("a")]);
        expect(unknown.comparable).toBe(false);
        expect(unknown.newly).toEqual([]);

        const known = diffViolations([], [violating("a")]);
        expect(known.comparable).toBe(true);
        expect(known.newlyCount).toBe(1);
      });
    });

    describe("문구", () => {
      it("제목과 id를 적는다 — 숫자만으로는 어디를 볼지 알 수 없다", () => {
        const text = describeNewViolations(
          diffViolations([], [violating("c-1", "매트 상세")]),
        );
        expect(text).toContain("새로 위반된 콘텐츠 1건");
        expect(text).toContain("매트 상세(c-1)");
      });

      it("이미 나간 것은 목록에서도 구분한다", () => {
        const text = describeNewViolations(
          diffViolations(
            [],
            [{ contentId: "c-1", title: "매트", contentStatus: "PUBLISHED" }],
          ),
        );
        expect(text).toContain("이미 발행됨");
      });

      it("10건까지만 담고 생략 건수를 밝힌다 — 조용히 자르지 않는다", () => {
        const many = Array.from({ length: 14 }, (_, index) =>
          violating(`c-${index}`),
        );
        const text = describeNewViolations(diffViolations([], many));
        expect(text).toContain("새로 위반된 콘텐츠 14건");
        expect(text).toContain("나머지 4건은 문구에 담지 않았습니다");
        expect(text.split("·")).toHaveLength(NEW_VIOLATION_SAMPLE_LIMIT);
      });

      it("표본만 남은 이력에서도 건수는 전체를 말한다", () => {
        // 저장은 표본 10건이지만 newlyCount는 30건 — 목록은 잘라도 숫자는
        // 사실이어야 한다
        const sample = Array.from({ length: 10 }, (_, index) =>
          violating(`c-${index}`),
        );
        const text = describeNewViolations({
          newly: sample,
          newlyCount: 30,
          resolvedCount: 0,
          comparable: true,
        });
        expect(text).toContain("새로 위반된 콘텐츠 30건");
        expect(text).toContain("나머지 20건");
      });

      it("가릴 수 없으면 '없다'고 하지 않는다", () => {
        const text = describeNewViolations(diffViolations(null, [violating("a")]));
        expect(text).toContain("가릴 수 없습니다");
        expect(text).not.toContain("없습니다 (이미 있던");
      });

      it("비교했고 새 것이 없으면 그렇게 말한다", () => {
        expect(describeNewViolations(diffViolations(["a"], [violating("a")]))).toContain(
          "새로 위반된 콘텐츠는 없습니다",
        );
      });
    });

    describe("경보 문구", () => {
      it("증가 수와 새로 위반된 콘텐츠를 함께 담는다", () => {
        const [alert] = detectGovernanceScanAlert(
          compareScan(totals(1), totals(3)),
          totals(3),
          {
            scope: "all",
            diff: diffViolations(
              ["old"],
              [violating("old"), violating("n-1", "세제"), violating("n-2")],
            ),
          },
        );
        expect(alert.message).toContain("1건에서 3건으로 2건 늘었습니다");
        expect(alert.message).toContain("새로 위반된 콘텐츠 2건");
        expect(alert.message).toContain("세제(n-1)");
      });

      it("새로 생긴 수와 증가 수가 다르면 둘을 구분해 말한다", () => {
        // 2건이 새로 생기고 1건이 해소되면 총량은 1건만 늘었다 —
        // 한 숫자로 뭉치면 문구가 거짓이 된다
        const [alert] = detectGovernanceScanAlert(
          compareScan(totals(2), totals(3)),
          totals(3),
          {
            scope: "all",
            diff: diffViolations(
              ["a", "b"],
              [violating("b"), violating("c"), violating("d")],
            ),
          },
        );
        expect(alert.message).toContain("새로 위반된 콘텐츠 2건");
        expect(alert.message).toContain("1건은 해소되어 총량은 1건 늘었습니다");
      });

      it("범위를 제목에 적는다 — 프로젝트별 경보를 구분해야 한다", () => {
        const [alert] = detectGovernanceScanAlert(
          compareScan(totals(1), totals(2)),
          totals(2),
          { scope: "project:p-1", projectNames: { "p-1": "매직클린" } },
        );
        expect(alert.title).toContain("매직클린");
        expect(alert.message).toContain("프로젝트 매직클린 (p-1) 범위에서");
      });

      it("대조 결과를 주지 않으면 목록을 말하지 않는다", () => {
        const [alert] = detectGovernanceScanAlert(
          compareScan(totals(1), totals(2)),
          totals(2),
          { scope: "all" },
        );
        expect(alert.message).not.toContain("새로 위반된");
      });
    });

    describe("이력 문구", () => {
      it("늘지 않은 실행에도 구성 변화를 남긴다 — 부르지는 않는다", () => {
        const change = compareScan(totals(2), totals(2));
        const diff = diffViolations(["a", "b"], [violating("b"), violating("c")]);
        const detail = describeScanRun(change, totals(2), diff);

        expect(detail).toContain("지난번과 같습니다");
        expect(detail).toContain("새로 위반된 콘텐츠 1건");
        expect(detail).toContain("해소 1건");
        // 경보는 여전히 만들지 않는다 (결정 2601-③)
        expect(
          detectGovernanceScanAlert(change, totals(2), { scope: "all", diff }),
        ).toEqual([]);
      });

      it("대조할 수 없었으면 구성 변화를 적지 않는다", () => {
        const detail = describeScanRun(
          compareScan(totals(1), totals(2)),
          totals(2),
          diffViolations(null, [violating("a"), violating("b")]),
        );
        expect(detail).not.toContain("새로 위반된 콘텐츠");
      });
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
