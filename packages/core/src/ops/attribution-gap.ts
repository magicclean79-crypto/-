/**
 * 미귀속 실행 경로 분석. (TASK-4401, Sprint 44 — CTO 정책 4401-②)
 *
 * TASK-4301은 귀속률을 전체 창과 최근 창으로 갈라 냈고, 최근 창이
 * **57.1%** 라고 보고했습니다. 그 숫자는 "아직 덜 됐다"는 것만 말하고
 * **어디가 덜 됐는지는 말하지 않습니다.** 그래서 다음에 무엇을 고쳐야 하는지
 * 알 수 없었습니다.
 *
 * 이 파일은 미귀속 호출을 **경로별로 나눠 셉니다.** 그러면 "귀속률
 * 57%"가 "`vision-analysis`가 12건 빠뜨리고 있다"로 바뀝니다 — 앞은 감상이고
 * 뒤는 할 일입니다.
 *
 * ## 목표치를 판정에 넣을 때 조심하는 것
 *
 * 정책은 95%를 목표로 합니다. 목표가 있는 지표는 **목표를 맞추려고 지표를
 * 바꾸고 싶어집니다.** 그래서 두 가지를 못 하게 막습니다:
 *
 * 1. **표본이 적으면 달성이라고 말하지 않습니다.** 호출 2건 중 2건이
 *    귀속되면 100%인데, 그것으로 "목표 달성"이라고 적으면 다음 주에
 *    30건이 들어왔을 때 조용히 무너집니다. 최소 표본을 요구하고, 모자라면
 *    **달성도 미달도 아닌 "판정 보류"** 입니다.
 * 2. **분모를 이 파일에서 다시 정하지 않습니다.** 무엇이 귀속 대상인가는
 *    `project-cost.ts`가 정하고(정책 4301-②), 여기서는 그 판정이 이미
 *    "귀속 대상"이라고 한 것만 셉니다. 두 곳에서 정하면 둘이 어긋나는 날이
 *    옵니다.
 */

/** 목표를 달성했다고 말하려면 이만큼은 봐야 한다 */
export const ATTRIBUTION_MIN_SAMPLE = 20;

/** 미귀속 호출 한 줄 — 이미 "귀속 대상"으로 판정된 것만 들어온다 */
export interface AttributionRecord {
  /** 호출 기능 — 모르면 null */
  feature: string | null;
  source: "llm" | "ocr";
  /** 프로젝트가 붙었는가 */
  attributed: boolean;
}

export interface AttributionGapRow {
  key: string;
  feature: string | null;
  source: "llm" | "ocr";
  total: number;
  attributed: number;
  missing: number;
  /** 이 경로의 귀속률(%) */
  coverage: number;
  detail: string;
}

export type AttributionVerdict =
  /** 목표를 넘었다 */
  | "met"
  /** 목표에 못 미친다 */
  | "below"
  /** 표본이 모자라 판정하지 않는다 — **달성도 미달도 아니다** */
  | "insufficient";

export interface AttributionGapReport {
  rows: AttributionGapRow[];
  total: number;
  attributed: number;
  missing: number;
  /** 전체 귀속률(%) — 표본이 0이면 null */
  coverage: number | null;
  target: number;
  minSample: number;
  verdict: AttributionVerdict;
  /** 가장 많이 빠뜨리는 경로 — 없으면 null */
  worst: AttributionGapRow | null;
  detail: string;
  /** 다음에 할 일 — 없으면 null */
  next: string | null;
}

function label(feature: string | null, source: string): string {
  if (feature !== null) {
    return feature;
  }
  // 기능을 모르는 기록을 "기타"로 뭉치면 그 칸이 영원히 안 줄어든다 —
  // 무엇을 모르는지 이름으로 남긴다
  return source === "ocr" ? "OCR (기능 구분 없음)" : "기능을 모르는 호출";
}

/**
 * 미귀속 호출을 경로별로 나눈다 (순수 함수, CTO 정책 4401-②).
 *
 * 들어오는 것은 **이미 귀속 대상으로 판정된 호출만**입니다 — 개발용 호출과
 * 진단 호출을 여기서 다시 거르지 않습니다(그 판정은 `project-cost.ts`의
 * 일입니다).
 */
export function analyzeAttributionGap(input: {
  records: AttributionRecord[];
  target: number;
  minSample?: number;
}): AttributionGapReport {
  const minSample = input.minSample ?? ATTRIBUTION_MIN_SAMPLE;
  const buckets = new Map<string, AttributionGapRow>();

  for (const row of input.records) {
    const key = `${row.source}:${row.feature ?? "unknown"}`;
    const bucket = buckets.get(key) ?? {
      key,
      feature: row.feature,
      source: row.source,
      total: 0,
      attributed: 0,
      missing: 0,
      coverage: 0,
      detail: "",
    };
    bucket.total += 1;
    if (row.attributed) {
      bucket.attributed += 1;
    } else {
      bucket.missing += 1;
    }
    buckets.set(key, bucket);
  }

  const rows = [...buckets.values()]
    .map((row) => ({
      ...row,
      coverage: row.total === 0 ? 0 : Math.round((row.attributed / row.total) * 1000) / 10,
      detail:
        row.missing === 0
          ? `${label(row.feature, row.source)}: ${row.total}건 모두 귀속됐습니다.`
          : `${label(row.feature, row.source)}: ${row.total}건 중 ${row.missing}건에 ` +
            "프로젝트가 붙지 않았습니다.",
    }))
    // **많이 빠뜨리는 것부터** — 비율이 아니라 건수로 정렬합니다. 비율로
    // 세우면 2건 중 1건 빠뜨린 경로가 100건 중 30건 빠뜨린 경로보다 위에
    // 오고, 고쳐야 할 순서가 뒤집힙니다.
    .sort((a, b) => b.missing - a.missing || b.total - a.total);

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const attributed = rows.reduce((sum, row) => sum + row.attributed, 0);
  const missing = total - attributed;
  const coverage = total === 0 ? null : Math.round((attributed / total) * 1000) / 10;
  const worst = rows.find((row) => row.missing > 0) ?? null;

  const verdict: AttributionVerdict =
    total < minSample ? "insufficient" : (coverage ?? 0) >= input.target ? "met" : "below";

  const parts: string[] = [];
  if (total === 0) {
    parts.push("귀속 대상 호출이 없어 셀 것이 없습니다.");
  } else {
    parts.push(`귀속 대상 ${total}건 중 ${attributed}건 귀속 (${coverage}%).`);
  }
  if (verdict === "insufficient") {
    // **표본이 적으면 달성이라고 말하지 않습니다** — 2건 중 2건으로
    // "목표 달성"을 적으면 다음 주에 조용히 무너집니다
    parts.push(
      `표본이 ${minSample}건에 못 미쳐 목표(${input.target}%) 달성 여부를 ` +
        "판정하지 않았습니다 — 달성도 미달도 아닙니다.",
    );
  } else if (verdict === "met") {
    parts.push(`목표 ${input.target}%를 넘었습니다.`);
  } else {
    parts.push(`목표 ${input.target}%에 못 미칩니다.`);
  }
  if (missing > 0 && worst !== null) {
    parts.push(
      `가장 많이 빠뜨리는 경로는 ${label(worst.feature, worst.source)}입니다 ` +
        `(${worst.missing}건). 귀속률만 보면 "덜 됐다"까지만 알 수 있고, ` +
        "어디를 고쳐야 하는지는 이 목록이 말합니다.",
    );
  }

  return {
    rows,
    total,
    attributed,
    missing,
    coverage,
    target: input.target,
    minSample,
    verdict,
    worst,
    detail: parts.join(" "),
    next:
      worst === null
        ? null
        : `${label(worst.feature, worst.source)} 호출 경로에서 프로젝트가 ` +
          "전달되는지 확인하세요.",
  };
}
