/**
 * 진단 이력과 비교. (TASK-4101, Sprint 41 — CTO 정책 4101-②)
 *
 * TASK-4001의 진단은 **부를 때마다 새로 냅니다.** 그래서 화면이 "실패
 * 2건"이라고 말해도, 그것이 **오늘 새로 생긴 것**인지 **지난주부터 계속
 * 그랬던 것**인지 알 수 없습니다. 그 둘은 완전히 다른 소식입니다:
 *
 * - 새로 생긴 실패 → **어제 무언가를 바꿨다.** 지금 되돌릴 수 있습니다.
 * - 계속된 실패 → 아무도 안 고치고 있다는 뜻이고, 그건 다른 문제입니다.
 *
 * ## 이 파일이 특히 조심하는 것: 사라진 항목
 *
 * 비교를 순진하게 짜면 **항목이 사라진 것을 "복구됨"으로 셉니다.** 그런데
 * 활성화 항목은 해당되지 않으면 아예 만들어지지 않고, 기동 진단의 관측 이력
 * 항목은 일일 진단에 없습니다. 그것들이 "고쳐졌다"로 집계되면 **없어진
 * 검사가 성과로 보고됩니다** — 우리가 여러 번 경계해 온
 * "**없어진 검사는 실패하지 않는다**"의 정확히 반대편 실수입니다.
 *
 * 그래서 `recovered`(빨갛다가 정상이 됨)와 `disappeared`(항목 자체가
 * 없어짐)를 **다른 칸**에 담습니다.
 */

export type DiagnosticStatus = "ok" | "warn" | "fail" | "unknown";

/** 저장된 진단 실행 1건 (비교 입력) */
export interface DiagnosticRunRecord {
  id: string;
  /** startup | daily | manual */
  stage: string;
  /** development | staging | production */
  tier: string;
  ranAt: number;
  checks: { id: string; title: string; status: DiagnosticStatus }[];
  ok: number;
  warn: number;
  fail: number;
  unknown: number;
}

/** 항목 하나의 변화 */
export interface DiagnosticChange {
  id: string;
  title: string;
  from: DiagnosticStatus | null;
  to: DiagnosticStatus | null;
}

export interface DiagnosticComparison {
  /** 정상이었다가 나빠진 항목 — **어제 무언가를 바꿨다는 뜻** */
  regressed: DiagnosticChange[];
  /** 나빴다가 정상이 된 항목 */
  recovered: DiagnosticChange[];
  /** 나빴고 지금도 나쁜 항목 — 아무도 안 고치고 있다 */
  persisting: DiagnosticChange[];
  /**
   * 이전에는 있었는데 **이번에 아예 없는** 항목.
   * `recovered`와 절대 섞지 않는다 — 없어진 검사는 성과가 아니다.
   */
  disappeared: DiagnosticChange[];
  /** 이번에 새로 생긴 항목 (검사가 추가됐다) */
  appeared: DiagnosticChange[];
  /** 비교 대상이 있었는가 — 첫 실행은 비교가 아니다 */
  comparable: boolean;
  /** 비교 대상 시각 */
  comparedTo: number | null;
  detail: string;
}

/** 나쁜 상태인가 — `unknown`도 좋은 것이 아니다 */
function isBad(status: DiagnosticStatus): boolean {
  return status !== "ok";
}

const STATUS_LABEL: Record<DiagnosticStatus, string> = {
  ok: "정상",
  warn: "주의",
  fail: "실패",
  unknown: "확인 못 함",
};

/**
 * 두 진단을 비교한다 (순수 함수, CTO 정책 4101-②).
 *
 * **같은 단계·같은 배포 단계끼리만 비교해야 합니다.** 기동 진단과 일일
 * 진단은 항목 구성이 다르고, 스테이징과 운영은 판정 기준이 다릅니다.
 * 이 함수는 넘겨받은 것을 비교만 하므로, 무엇을 넘길지는 호출부가
 * 책임집니다.
 */
export function compareDiagnostics(
  previous: DiagnosticRunRecord | null,
  current: DiagnosticRunRecord,
): DiagnosticComparison {
  if (previous === null) {
    return {
      regressed: [],
      recovered: [],
      persisting: [],
      disappeared: [],
      appeared: [],
      comparable: false,
      comparedTo: null,
      // **첫 실행을 "변화 없음"으로 적지 않는다** — 변화가 없는 것과
      // 비교할 대상이 없는 것은 다르다
      detail: "비교할 지난 진단이 없습니다 — 이번이 기준선입니다.",
    };
  }

  const before = new Map(previous.checks.map((check) => [check.id, check]));
  const after = new Map(current.checks.map((check) => [check.id, check]));

  const regressed: DiagnosticChange[] = [];
  const recovered: DiagnosticChange[] = [];
  const persisting: DiagnosticChange[] = [];
  const disappeared: DiagnosticChange[] = [];
  const appeared: DiagnosticChange[] = [];

  for (const [id, now] of after) {
    const then = before.get(id);
    if (then === undefined) {
      appeared.push({ id, title: now.title, from: null, to: now.status });
      continue;
    }
    if (!isBad(then.status) && isBad(now.status)) {
      regressed.push({ id, title: now.title, from: then.status, to: now.status });
    } else if (isBad(then.status) && !isBad(now.status)) {
      recovered.push({ id, title: now.title, from: then.status, to: now.status });
    } else if (isBad(then.status) && isBad(now.status)) {
      persisting.push({ id, title: now.title, from: then.status, to: now.status });
    }
  }

  for (const [id, then] of before) {
    if (!after.has(id)) {
      // **복구가 아니다.** 검사가 없어진 것이고, 없어진 검사는 실패하지 않는다
      disappeared.push({ id, title: then.title, from: then.status, to: null });
    }
  }

  const parts: string[] = [];
  if (regressed.length > 0) {
    // 새로 나빠진 것을 **먼저** 말한다 — 지금 되돌릴 수 있는 것이 이것이다
    parts.push(
      `새로 나빠진 항목 ${regressed.length}건: ${regressed
        .map((row) => `${row.title}(${STATUS_LABEL[row.from ?? "ok"]} → ${STATUS_LABEL[row.to ?? "ok"]})`)
        .join(" · ")}. 지난 진단 이후에 바뀐 것이 있다는 뜻입니다.`,
    );
  }
  if (persisting.length > 0) {
    parts.push(
      `계속 나쁜 항목 ${persisting.length}건: ${persisting
        .map((row) => row.title)
        .join(" · ")}. 새 사건이 아니라 아무도 고치지 않은 것입니다.`,
    );
  }
  if (recovered.length > 0) {
    parts.push(`정상으로 돌아온 항목 ${recovered.length}건.`);
  }
  if (disappeared.length > 0) {
    parts.push(
      `이번 진단에 없는 항목 ${disappeared.length}건: ${disappeared
        .map((row) => row.title)
        .join(" · ")}. 고쳐진 것이 아니라 검사 자체가 없어진 것입니다 — ` +
        "없어진 검사는 실패하지 않습니다.",
    );
  }
  if (appeared.length > 0) {
    parts.push(`이번에 새로 생긴 항목 ${appeared.length}건.`);
  }
  if (parts.length === 0) {
    parts.push("지난 진단과 달라진 항목이 없습니다.");
  }

  return {
    regressed,
    recovered,
    persisting,
    disappeared,
    appeared,
    comparable: true,
    comparedTo: previous.ranAt,
    detail: parts.join(" "),
  };
}

/**
 * 새로 나빠진 항목을 경보로 (순수 함수, CTO 정책 4101-②).
 *
 * **계속 나쁜 것은 경보로 내지 않습니다.** 이미 한 번 알렸고, 매일 다시
 * 부르면 그 경보부터 무시하게 됩니다(정책 1302의 쿨다운과 같은 판단).
 * 여기서 알리고 싶은 것은 **"어제까지 괜찮던 것이 오늘 아니다"** 하나입니다.
 */
export function detectRegressionAlerts(
  comparison: DiagnosticComparison,
  input: { tier: string; stage: string; alerting: boolean },
): {
  kind: "diagnostics";
  key: string;
  level: "warning" | "critical";
  title: string;
  message: string;
}[] {
  if (!input.alerting || comparison.regressed.length === 0) {
    return [];
  }
  const hasFail = comparison.regressed.some((row) => row.to === "fail");
  return [
    {
      kind: "diagnostics",
      // 단계·배포 단계별로 키를 나눈다 — 스테이징의 회귀가 운영의 회귀를
      // 덮어쓰면 안 된다
      key: `diagnostics:regression:${input.tier}:${input.stage}`,
      // 운영이 아니면 **critical로 올리지 않는다** — 스테이징의 빨간불이
      // 운영 장애와 같은 등급으로 울리면 진짜 장애가 그 속에 묻힌다
      level: hasFail && input.tier === "production" ? "critical" : "warning",
      title: `[${input.tier}] 지난 진단 이후 나빠진 항목 ${comparison.regressed.length}건`,
      message:
        comparison.regressed
          .map(
            (row) =>
              `${row.title}: ${STATUS_LABEL[row.from ?? "ok"]} → ${STATUS_LABEL[row.to ?? "ok"]}`,
          )
          .join(" · ") +
        ". 지난 진단 이후에 바뀐 것이 있다는 뜻입니다 — 지금이라면 무엇을 " +
        "바꿨는지 기억할 수 있습니다.",
    },
  ];
}
