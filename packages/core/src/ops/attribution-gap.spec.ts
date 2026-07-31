import { analyzeAttributionGap } from "./attribution-gap";
import type { AttributionRecord } from "./attribution-gap";

function records(
  spec: [feature: string | null, source: "llm" | "ocr", attributed: boolean, count: number][],
): AttributionRecord[] {
  return spec.flatMap(([feature, source, attributed, count]) =>
    Array.from({ length: count }, () => ({ feature, source, attributed })),
  );
}

describe("analyzeAttributionGap", () => {
  it("경로별로 나눠 세고 귀속률을 낸다", () => {
    const report = analyzeAttributionGap({
      records: records([
        ["content-generation", "llm", true, 18],
        ["vision-analysis", "llm", false, 2],
      ]),
      target: 95,
    });
    expect(report.total).toBe(20);
    expect(report.coverage).toBe(90);
    expect(report.rows).toHaveLength(2);
    expect(report.worst?.feature).toBe("vision-analysis");
  });

  /**
   * 귀속률만 보면 "덜 됐다"까지만 알 수 있다. 어디를 고쳐야 하는지 말하는
   * 것이 이 파일의 존재 이유다.
   */
  it("어느 경로가 빠뜨리는지 이름으로 말한다", () => {
    const report = analyzeAttributionGap({
      records: records([
        ["content-generation", "llm", true, 30],
        ["vision-analysis", "llm", false, 12],
      ]),
      target: 95,
    });
    expect(report.detail).toContain("vision-analysis");
    expect(report.next).toContain("vision-analysis");
  });

  /**
   * 비율로 정렬하면 2건 중 1건 빠뜨린 경로가 100건 중 30건 빠뜨린 경로보다
   * 위에 오고, 고쳐야 할 순서가 뒤집힌다.
   */
  it("비율이 아니라 건수로 세운다", () => {
    const report = analyzeAttributionGap({
      records: records([
        ["small", "llm", false, 1],
        ["small", "llm", true, 1],
        ["big", "llm", false, 30],
        ["big", "llm", true, 70],
      ]),
      target: 95,
    });
    expect(report.rows[0].feature).toBe("big");
    expect(report.worst?.feature).toBe("big");
  });

  /**
   * 2건 중 2건으로 "목표 달성"을 적으면 다음 주에 30건이 들어왔을 때
   * 조용히 무너진다.
   */
  it("표본이 모자라면 달성도 미달도 아니다", () => {
    const report = analyzeAttributionGap({
      records: records([["content-generation", "llm", true, 2]]),
      target: 95,
    });
    expect(report.coverage).toBe(100);
    expect(report.verdict).toBe("insufficient");
    expect(report.detail).toContain("달성도 미달도 아닙니다");
  });

  it("표본이 충분하고 목표를 넘으면 달성이라고 말한다", () => {
    const report = analyzeAttributionGap({
      records: records([
        ["content-generation", "llm", true, 39],
        ["vision-analysis", "llm", false, 1],
      ]),
      target: 95,
    });
    expect(report.verdict).toBe("met");
    expect(report.detail).toContain("목표 95%를 넘었습니다");
  });

  it("표본이 충분한데 목표에 못 미치면 그렇게 말한다", () => {
    const report = analyzeAttributionGap({
      records: records([
        ["content-generation", "llm", true, 20],
        ["vision-analysis", "llm", false, 10],
      ]),
      target: 95,
    });
    expect(report.verdict).toBe("below");
    expect(report.detail).toContain("못 미칩니다");
  });

  /**
   * "기타"로 뭉치면 그 칸이 영원히 안 줄어든다.
   */
  it("기능을 모르는 기록을 기타로 뭉치지 않는다", () => {
    const report = analyzeAttributionGap({
      records: records([
        [null, "ocr", false, 3],
        [null, "llm", false, 2],
      ]),
      target: 95,
    });
    expect(report.rows.map((row) => row.key).sort()).toEqual([
      "llm:unknown",
      "ocr:unknown",
    ]);
    expect(report.detail).toContain("OCR (기능 구분 없음)");
  });

  it("표본이 하나도 없으면 셀 것이 없다고 말한다", () => {
    const report = analyzeAttributionGap({ records: [], target: 95 });
    expect(report.coverage).toBeNull();
    expect(report.verdict).toBe("insufficient");
    expect(report.detail).toContain("셀 것이 없습니다");
    expect(report.next).toBeNull();
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    const report = analyzeAttributionGap({
      records: records([["vision-analysis", "llm", false, 5]]),
      target: 95,
    });
    expect(report.detail).not.toContain("**");
    for (const row of report.rows) {
      expect(row.detail).not.toContain("**");
    }
  });
});
