/**
 * 기동·일일 운영 진단. (TASK-4001, Sprint 40 — CTO 정책 4001-④⑤)
 *
 * 우리에겐 판정이 많습니다. 문제는 그것들이 **누군가 부를 때만** 돈다는
 * 것입니다: `/ops/cutover`는 화면을 열어야, 스모크는 눌러야, 예약 점검은
 * 켜져 있어야 돕니다. 그래서 **배포 직후**와 **매일 아침**이라는 두 순간이
 * 비어 있었습니다.
 *
 * - **기동 직후**는 설정이 방금 바뀐 순간입니다. 환경변수 하나가 빠졌으면
 *   지금 알아야 하는데, 지금까지는 첫 사용자가 그것을 발견했습니다.
 * - **매일 아침**은 밤새 바뀐 것을 확인하는 순간입니다. 키가 만료됐거나
 *   방화벽 규칙이 정리됐다면 업무 시작 전에 알아야 합니다.
 *
 * ## 기동을 막지 않습니다
 *
 * 진단이 빨간색이어도 서버는 뜹니다. **경보와 차단은 다릅니다** — 알림
 * 채널이 미설정이라고 API가 안 뜨면 그것이 더 큰 사고입니다. 다만
 * **조용하지도 않습니다**: 로그와 기록에 남고, 운영 환경이면 경보가 납니다.
 *
 * ## 기동 직후의 "정상"은 아직 아무것도 안 해 본 정상입니다
 *
 * 방금 뜬 서버는 실행 기록이 없고, 그래서 "실패 0건"입니다. 그것을 건강함
 * 으로 읽으면 안 됩니다. 진단은 **무엇을 아직 모르는지**를 함께 말합니다.
 */

import { configuredUrgentChannels } from "./urgent-routing";
import type { NotificationChannel } from "./notification";

export const DIAGNOSTIC_STAGES = ["startup", "daily"] as const;
export type DiagnosticStage = (typeof DIAGNOSTIC_STAGES)[number];

/** 진단 한 항목 */
export interface DiagnosticCheck {
  id: string;
  title: string;
  /** ok | warn | fail | unknown — **`unknown`은 통과가 아니다** */
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  /** 사람이 다음에 할 일 — 문제가 없으면 null */
  next: string | null;
}

export interface DiagnosticReport {
  stage: DiagnosticStage;
  checks: DiagnosticCheck[];
  ok: number;
  warn: number;
  fail: number;
  unknown: number;
  /** 기동을 막았는가 — **언제나 false다** (경보와 차단은 다르다) */
  blocked: false;
  detail: string;
  ranAt: string;
}

export interface DiagnosticInput {
  stage: DiagnosticStage;
  production: boolean;
  env: Record<string, string | undefined>;
  /** 환경변수 검증 결과 */
  envErrors: { name: string; message: string }[];
  /** 데이터베이스에 닿는가 — 못 봤으면 null */
  database: boolean | null;
  /** 저장소에 닿는가 — 못 봤으면 null */
  storage: boolean | null;
  /** 미적용 마이그레이션 수 — 못 봤으면 null */
  pendingMigrations: number | null;
  /** 예약 점검이 켜져 있는가 */
  scheduledChecksEnabled: boolean;
  /**
   * 일반 알림 채널이 하나라도 설정돼 있는가 (긴급 경로 점검 입력).
   *
   * 이 판정을 **여기서** 하는 이유(라이브 검증에서 고침): 처음에는 어댑터가
   * `checkUrgentChannels`를 따로 부르고 결과 배열에만 붙였습니다. 그러면
   * 항목 목록에는 들어가지만 **요약 문장은 그것을 세지 않아**, 긴급 경로가
   * 주의일 때 "주의 2건"이라고 적고 목록에는 세 건이 보이는 상태가 됩니다.
   * 배지와 목록이 어긋나면 사람은 둘 다 안 믿게 됩니다.
   */
  anyChannelConfigured: boolean;
  /** 활성화 조건 충족 수 / 전체 */
  activation: { met: number; total: number; applicable: boolean } | null;
  /** 이 인스턴스가 뜬 지 얼마나 됐는가 (ms) */
  uptimeMs: number;
  now: number;
}

/**
 * 긴급 알림 경로 점검 (CTO 정책 4001-④).
 *
 * TASK-3901에서 긴급 경로를 나눴고, 미구성이면 일반 채널로 되돌립니다.
 * 되돌리는 것은 옳지만 **되돌린 채로 잊히는 것**이 문제입니다 — 폴백은
 * 임시 조치이고, 임시 조치는 누가 보고 있지 않으면 영구가 됩니다.
 *
 * 그래서 진단이 이것을 봅니다. **개발에서는 경고하지 않습니다** — 개발자
 * 로컬에 긴급 웹훅을 두라고 요구하면 그 경고는 배경 소음이 되고, 그러면
 * 정작 운영의 경고도 안 읽힙니다.
 */
export function checkUrgentChannels(input: {
  production: boolean;
  env: Record<string, string | undefined>;
  /** 일반 채널이 하나라도 설정돼 있는가 */
  anyChannelConfigured: boolean;
}): DiagnosticCheck {
  const configured: NotificationChannel[] = configuredUrgentChannels(input.env);

  if (!input.production) {
    return {
      id: "urgent-channel",
      title: "긴급 알림 경로",
      status: "ok",
      detail:
        configured.length > 0
          ? `긴급 경로 ${configured.join(" · ")}가 설정돼 있습니다.`
          : "개발 환경입니다 — 긴급 경로를 요구하지 않습니다.",
      next: null,
    };
  }

  if (!input.anyChannelConfigured) {
    return {
      id: "urgent-channel",
      title: "긴급 알림 경로",
      status: "fail",
      detail:
        "알림 채널이 하나도 설정돼 있지 않습니다 — 긴급이든 아니든 " +
        "로그가 유일한 흔적입니다.",
      next: "ALERT_SLACK_WEBHOOK_URL · ALERT_WEBHOOK_URL · ALERT_EMAIL_TO 중 하나를 설정하세요.",
    };
  }

  if (configured.length === 0) {
    return {
      id: "urgent-channel",
      title: "긴급 알림 경로",
      status: "warn",
      detail:
        "운영인데 긴급 경로가 없어 급한 알림이 일반 채널로 나갑니다. " +
        "지금은 동작하지만, 급한 것이 안 급한 것들 사이에 묻힙니다 — " +
        "폴백은 임시 조치이고 임시 조치는 아무도 보지 않으면 영구가 됩니다.",
      next: "ALERT_URGENT_SLACK_WEBHOOK_URL 또는 ALERT_URGENT_WEBHOOK_URL을 설정하세요.",
    };
  }

  return {
    id: "urgent-channel",
    title: "긴급 알림 경로",
    status: "ok",
    detail: `긴급 경로 ${configured.join(" · ")}가 설정돼 있습니다.`,
    next: null,
  };
}

/** 진단을 돌린다 (순수 함수, CTO 정책 4001-④⑤) */
export function runDiagnostics(input: DiagnosticInput): DiagnosticReport {
  const checks: DiagnosticCheck[] = [];

  checks.push({
    id: "env",
    title: "환경변수",
    status: input.envErrors.length === 0 ? "ok" : input.production ? "fail" : "warn",
    detail:
      input.envErrors.length === 0
        ? "필수 환경변수가 모두 설정돼 있습니다."
        : `문제 ${input.envErrors.length}건: ` +
          input.envErrors.map((row) => `${row.name}(${row.message})`).join(" · "),
    next: input.envErrors.length === 0 ? null : "설정을 고친 뒤 다시 배포하세요.",
  });

  checks.push(
    reachability("database", "데이터베이스", input.database, "연결 문자열과 네트워크를 확인하세요."),
  );
  checks.push(
    reachability("storage", "오브젝트 저장소", input.storage, "S3_ENDPOINT와 자격 증명을 확인하세요."),
  );

  checks.push({
    id: "migrations",
    title: "마이그레이션 적용",
    // **못 읽은 것을 0으로 세지 않는다** (결정 2301-④와 같은 판단)
    status:
      input.pendingMigrations === null
        ? "unknown"
        : input.pendingMigrations === 0
          ? "ok"
          : "fail",
    detail:
      input.pendingMigrations === null
        ? "적용 상태를 읽지 못했습니다 — 0건이라는 뜻이 아닙니다."
        : input.pendingMigrations === 0
          ? "미적용 마이그레이션이 없습니다."
          : `미적용 ${input.pendingMigrations}건 — 배포 전에 적용해야 합니다.`,
    next:
      input.pendingMigrations === null
        ? "pnpm --filter api exec prisma migrate status로 직접 확인하세요."
        : input.pendingMigrations === 0
          ? null
          : "prisma migrate deploy를 실행하세요.",
  });

  checks.push({
    id: "scheduler",
    title: "예약 점검",
    status: input.scheduledChecksEnabled ? "ok" : input.production ? "warn" : "ok",
    detail: input.scheduledChecksEnabled
      ? "예약 점검이 켜져 있습니다."
      : "예약 점검이 꺼져 있습니다 — 경보가 자동으로 나지 않습니다.",
    next: input.scheduledChecksEnabled ? null : "OPS_SCHEDULED_CHECKS를 켜세요.",
  });

  // 긴급 알림 경로 (정책 4001-④) — 다른 항목과 **같은 목록·같은 요약**에
  // 들어가야 한다
  checks.push(
    checkUrgentChannels({
      production: input.production,
      env: input.env,
      anyChannelConfigured: input.anyChannelConfigured,
    }),
  );

  if (input.activation !== null && input.activation.applicable) {
    const { met, total } = input.activation;
    checks.push({
      id: "activation",
      title: "운영 활성화",
      status: met === total ? "ok" : "warn",
      detail:
        met === total
          ? "세 조건이 모두 충족돼 있습니다."
          : `충족 ${met}/${total} — 아직 실 Provider로 전환되지 않았습니다.`,
      next: met === total ? null : "GET /ops/activation이 알려 주는 조건부터 처리하세요.",
    });
  }

  // 기동 직후의 "정상"은 아직 아무것도 안 해 본 정상이다 (정책 4001-⑤)
  if (input.stage === "startup") {
    checks.push({
      id: "fresh",
      title: "관측 이력",
      status: "unknown",
      detail:
        `이 인스턴스는 뜬 지 ${Math.max(1, Math.round(input.uptimeMs / 1000))}초 ` +
        "됐습니다 — 실행 기록이 없으므로 '실패 0건'은 건강함이 아니라 " +
        "아직 아무것도 안 해 봤다는 뜻입니다.",
      next: "첫 예약 점검이 돈 뒤에 /ops/kpi를 다시 보세요.",
    });
  }

  const count = (status: DiagnosticCheck["status"]): number =>
    checks.filter((check) => check.status === status).length;

  const fail = count("fail");
  const warn = count("warn");
  const unknown = count("unknown");

  const parts: string[] = [
    input.stage === "startup" ? "기동 진단." : "일일 진단.",
  ];
  if (fail > 0) {
    parts.push(
      `실패 ${fail}건: ${checks
        .filter((check) => check.status === "fail")
        .map((check) => check.title)
        .join(" · ")}.`,
    );
  }
  if (warn > 0) {
    parts.push(`주의 ${warn}건.`);
  }
  if (unknown > 0) {
    parts.push(`모르는 것 ${unknown}건 — 통과로 세지 않았습니다.`);
  }
  if (fail === 0 && warn === 0 && unknown === 0) {
    parts.push("모든 항목이 정상입니다.");
  }
  // **기동을 막지 않는다** — 경보와 차단은 다르다
  parts.push("진단 결과와 무관하게 서비스는 계속 뜹니다 (경보와 차단은 다릅니다).");

  return {
    stage: input.stage,
    checks,
    ok: count("ok"),
    warn,
    fail,
    unknown,
    blocked: false,
    detail: parts.join(" "),
    ranAt: new Date(input.now).toISOString(),
  };
}

function reachability(
  id: string,
  title: string,
  reachable: boolean | null,
  next: string,
): DiagnosticCheck {
  if (reachable === null) {
    return {
      id,
      title,
      // 못 본 것을 통과로 바꾸지 않는다
      status: "unknown",
      detail: "닿는지 확인하지 못했습니다 — '닿는다'가 아니라 '모른다'입니다.",
      next,
    };
  }
  return {
    id,
    title,
    status: reachable ? "ok" : "fail",
    detail: reachable ? "연결 정상입니다." : "닿지 못했습니다.",
    next: reachable ? null : next,
  };
}

/** 진단 실패를 경보로 (순수 함수) — **운영에서만** */
export function detectDiagnosticAlerts(report: DiagnosticReport, production: boolean): {
  kind: "diagnostics";
  key: string;
  level: "warning" | "critical";
  title: string;
  message: string;
}[] {
  if (!production) {
    // 개발의 빨간불이 운영 알림이 되면 그다음부터 아무도 안 본다
    return [];
  }
  const failing = report.checks.filter((check) => check.status === "fail");
  const warning = report.checks.filter((check) => check.status === "warn");
  if (failing.length === 0 && warning.length === 0) {
    return [];
  }
  return [
    {
      kind: "diagnostics",
      key: `diagnostics:${report.stage}`,
      level: failing.length > 0 ? "critical" : "warning",
      title: `${report.stage === "startup" ? "기동" : "일일"} 진단 — 실패 ${failing.length}건 · 주의 ${warning.length}건`,
      message: [...failing, ...warning]
        .map((check) => `${check.title}: ${check.detail}`)
        .join(" / "),
    },
  ];
}
