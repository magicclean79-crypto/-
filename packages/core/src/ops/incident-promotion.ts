/**
 * 경보 → 장애 **초안** 자동 승격. (TASK-3901, Sprint 39 — CTO 정책 3901-⑤)
 *
 * TASK-3701에서 우리는 **"경보와 장애는 다르다"** 고 못박았습니다. 경보는
 * 자동으로 뜨는 신호이고, 장애는 사람이 선언한 사건입니다. 경보에서 장애를
 * 자동으로 뽑아내려는 시도는 늘 둘 중 하나로 끝난다고 적었습니다 —
 * 아무것도 아닌 것이 장애가 되거나, 조용히 지나간 진짜 장애가 빠지거나.
 *
 * 그 판단은 지금도 맞습니다. 그런데 반대쪽 실패도 실제로 있었습니다:
 * **아무도 적지 않아서 이력이 비는 것.** 새벽 3시에 CRITICAL 경보가 40분간
 * 살아 있다가 저절로 풀렸다면, 그건 장애였는데 기록이 없습니다.
 *
 * ## 그래서 초안입니다
 *
 * 자동으로 만드는 것은 **초안(DRAFT)** 이지 장애가 아닙니다.
 *
 * | | 초안 | 장애 |
 * | --- | --- | --- |
 * | 누가 만드나 | 시스템 | 사람 |
 * | MTTR에 들어가나 | **아니오** | 예 |
 * | 무엇을 요구하나 | **사람의 확인** | 복구 방법 |
 * | 아니면 | **기각(사유 필수)** | — |
 *
 * 초안은 "이건 장애였을 수 있습니다, 봐 주세요"라는 **질문**입니다. 사람이
 * 확인하면 장애가 되고, 기각하면 **사유와 함께** 남습니다 — "아무것도
 * 아니었다"는 판단도 다음에 쓰입니다(같은 경보가 또 뜰 때 이미 한 번
 * 판단했다는 사실이 시간을 아낍니다).
 *
 * ## 자동 승격이 가져야 할 절제
 *
 * - **CRITICAL만.** warning으로 초안을 만들면 목록이 초안으로 뒤덮이고,
 *   그러면 아무도 초안을 안 봅니다.
 * - **오래 살아 있어야.** 5분 만에 풀리는 경보는 장애가 아닙니다.
 * - **같은 경보로 두 번 만들지 않습니다.** 경보는 쿨다운마다 다시 알리므로,
 *   승격이 그때마다 일어나면 초안이 쌓입니다.
 */

import type { IncidentComponent, IncidentSeverity } from "./incident";

/** 승격 기본 임계 — 이보다 오래 살아 있은 CRITICAL 경보만 */
export const DEFAULT_PROMOTION_AFTER_MS = 30 * 60 * 1000;

/** 설정 키 */
export const PROMOTION_SETTING_KEY = "incident.promotion.afterMinutes";
export const PROMOTION_ENABLED_KEY = "incident.promotion.enabled";

/** 승격 판정에 필요한 경보 상태 */
export interface PromotableAlert {
  key: string;
  kind: string;
  level: "warning" | "critical";
  status: "ACTIVE" | "RESOLVED" | "ARCHIVED";
  title: string;
  message: string;
  /** 이 경보를 처음 본 시각 (ms) */
  firstRaisedAt: number;
}

/** 만들 초안 1건 */
export interface DraftIncident {
  /** 어느 경보에서 왔는가 — 같은 경보로 두 번 만들지 않기 위한 키 */
  sourceAlertKey: string;
  component: IncidentComponent;
  severity: IncidentSeverity;
  summary: string;
  /** 경보를 처음 본 시각 = 장애 시작으로 본다 */
  startedAt: Date;
  /** 우리가 알아챈 시각 = 경보가 난 그때다 (감지 지연이 0이라는 뜻이 아니다) */
  detectedAt: Date;
  detail: string;
}

/**
 * 경보 종류 → 구성 요소.
 *
 * 모르는 종류는 `other`입니다 — **지어내지 않습니다.** 사람이 확인할 때
 * 고쳐 넣으면 됩니다.
 */
const KIND_COMPONENT: Record<string, IncidentComponent> = {
  "provider-failure": "llm",
  budget: "llm",
  "unpriced-model": "llm",
  "price-source": "llm",
  "pricing-drift": "llm",
  "cost-forecast": "llm",
  configuration: "api",
  "scheduler-stopped": "api",
  "migration-governance": "database",
  "backup-performance": "storage",
  "backup-integrity": "storage",
  "recovery-drill": "storage",
  "governance-scan": "web",
};

export interface PromotionInput {
  alerts: PromotableAlert[];
  /** 이미 초안이나 장애가 있는 경보 키 — 두 번 만들지 않는다 */
  existingSourceKeys: string[];
  /** 이보다 오래 살아 있어야 승격한다 */
  afterMs: number;
  now: number;
  /** 꺼져 있으면 아무것도 만들지 않는다 */
  enabled: boolean;
}

export interface PromotionReport {
  drafts: DraftIncident[];
  /** 조건은 봤지만 아직 이른 경보 수 */
  waiting: number;
  /** 이미 초안·장애가 있어 건너뛴 수 */
  skipped: number;
  detail: string;
}

/**
 * 승격할 경보를 고른다 (순수 함수, CTO 정책 3901-⑤).
 *
 * **해소된 경보도 승격 대상입니다.** 새벽에 40분간 살아 있다가 저절로
 * 풀린 CRITICAL이 정확히 우리가 놓치던 것이고, "지금 살아 있는 것"만 보면
 * 그것을 영원히 못 잡습니다. 다만 **살아 있던 시간**으로 판정합니다.
 */
export function judgeIncidentPromotion(input: PromotionInput): PromotionReport {
  if (!input.enabled) {
    return {
      drafts: [],
      waiting: 0,
      skipped: 0,
      detail:
        "자동 승격이 꺼져 있습니다 — 장애는 사람이 엽니다 (CTO 정책 3701-④). " +
        `켜려면 ${PROMOTION_ENABLED_KEY}를 true로 두세요.`,
    };
  }

  const existing = new Set(input.existingSourceKeys);
  const drafts: DraftIncident[] = [];
  let waiting = 0;
  let skipped = 0;

  for (const alert of input.alerts) {
    // warning으로 초안을 만들면 목록이 초안으로 뒤덮이고, 그러면 아무도
    // 초안을 안 본다
    if (alert.level !== "critical") {
      continue;
    }
    if (existing.has(alert.key)) {
      skipped += 1;
      continue;
    }
    const livedMs = input.now - alert.firstRaisedAt;
    if (livedMs < input.afterMs) {
      waiting += 1;
      continue;
    }

    drafts.push({
      sourceAlertKey: alert.key,
      component: KIND_COMPONENT[alert.kind] ?? "other",
      severity: "CRITICAL",
      summary: alert.title,
      startedAt: new Date(alert.firstRaisedAt),
      detectedAt: new Date(alert.firstRaisedAt),
      detail:
        `CRITICAL 경보 \`${alert.key}\`가 ${Math.round(livedMs / 60000)}분째 ` +
        `이어져 자동으로 만든 초안입니다. ${alert.message}\n\n` +
        "이것은 장애가 아니라 질문입니다 — 실제로 사용자가 영향을 받았다면 " +
        "확인해 장애로 올리고, 아니면 사유와 함께 기각하세요.",
    });
  }

  const parts: string[] = [];
  if (drafts.length > 0) {
    parts.push(`초안 ${drafts.length}건을 만들었습니다 — 사람의 확인이 필요합니다.`);
  }
  if (waiting > 0) {
    parts.push(
      `아직 이른 경보 ${waiting}건 (${Math.round(input.afterMs / 60000)}분을 넘겨야 합니다).`,
    );
  }
  if (skipped > 0) {
    parts.push(`이미 초안·장애가 있는 경보 ${skipped}건은 건너뛰었습니다.`);
  }
  if (parts.length === 0) {
    parts.push("승격할 경보가 없습니다.");
  }

  return { drafts, waiting, skipped, detail: parts.join(" ") };
}

/** 초안 기각이 성립하는가 — **사유 없이 기각하지 않는다** */
export function validateDismissal(input: {
  status: string;
  reason: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.status !== "DRAFT") {
    return {
      ok: false,
      reason: "초안만 기각할 수 있습니다 — 확인된 장애는 기각이 아니라 복구로 닫습니다.",
    };
  }
  if (input.reason.trim().length < 5) {
    return {
      ok: false,
      reason:
        "기각 사유를 적어 주세요 — '아무것도 아니었다'는 판단도 다음에 " +
        "쓰입니다. 같은 경보가 또 떴을 때 이미 한 번 판단했다는 사실이 " +
        "시간을 아낍니다 (CTO 정책 3901-⑤).",
    };
  }
  return { ok: true };
}

/** 초안 확인이 성립하는가 */
export function validateConfirmation(input: {
  status: string;
  summary: string;
}): { ok: true } | { ok: false; reason: string } {
  if (input.status !== "DRAFT") {
    return { ok: false, reason: "초안만 확인할 수 있습니다." };
  }
  if (input.summary.trim().length < 5) {
    return {
      ok: false,
      reason:
        "무슨 일이 있었는지 한 줄로 적어 주세요 — 자동으로 붙은 경보 제목은 " +
        "경보의 이름이지 장애의 설명이 아닙니다.",
    };
  }
  return { ok: true };
}

/** 승격 임계 설정 해석 (순수 함수) */
export function resolvePromotionSettings(settings: Record<string, string>): {
  enabled: boolean;
  afterMs: number;
  rejected: { key: string; reason: string }[];
} {
  const rejected: { key: string; reason: string }[] = [];
  // **기본은 꺼짐**입니다 — 자동으로 장애 목록에 무언가를 넣는 기능은
  // 운영자가 켜기로 결정해야 합니다 (결정 1301-①과 같은 판단).
  const enabled = (settings[PROMOTION_ENABLED_KEY] ?? "false").trim() === "true";

  let afterMs = DEFAULT_PROMOTION_AFTER_MS;
  const raw = settings[PROMOTION_SETTING_KEY];
  if (raw !== undefined) {
    const minutes = Number(raw);
    if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440) {
      rejected.push({
        key: PROMOTION_SETTING_KEY,
        reason:
          `승격 임계는 5~1440분 사이의 정수여야 합니다 (받은 값: ${raw}). ` +
          "5분보다 짧으면 잠깐 튄 것도 초안이 되고, 하루보다 길면 초안이 " +
          "장애가 끝난 뒤에 생깁니다.",
      });
    } else {
      afterMs = minutes * 60 * 1000;
    }
  }

  return { enabled, afterMs, rejected };
}
