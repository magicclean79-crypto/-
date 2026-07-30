/**
 * Content Governance. (TASK-2501, Sprint 25)
 *
 * **발행되는 것을 검사한다.**
 *
 * 지금까지 거버넌스 검사는 Product Object의 READY 전환에만 있었다
 * (`evaluateReadyValidation`, TASK-0404). 그런데 세상에 나가는 것은 Product
 * Object가 아니라 **Content의 제목과 본문**이고, 그 경로에는 검사가 없었다 —
 * 발행 조건은 "REVIEW 상태이며 제목과 본문이 비어 있지 않다"뿐이었다.
 *
 * 그래서 금지어가 든 본문이, 필수 고지가 빠진 본문이, 상품과 연결이 끊긴
 * 본문이 **아무 판정 없이 발행될 수 있었다.** 상품을 검사하고 콘텐츠를
 * 검사하지 않는 것은 **재료를 검사하고 완성품은 안 보는 것**과 같다.
 *
 * 판정과 차단은 다르다:
 * - `FAIL` — 발행을 **막는다.** 나가면 되돌릴 수 없는 것들이다.
 * - `WARNING` — 막지 않고 **드러낸다.** 규칙이 미설정인 것과 규칙을 위반한
 *   것은 다르다 (미구성과 실패는 다르다).
 * - `PASS` — 이상 없음.
 */

import type { ContentStatus, ReadyValidationStatus } from "@acos/shared";

/** 판정 등급은 READY 판정과 같은 3단계를 쓴다 — 화면이 두 어휘를 배우지 않게 */
export type GovernanceStatus = ReadyValidationStatus;

const SEVERITY: Record<GovernanceStatus, number> = {
  PASS: 0,
  WARNING: 1,
  FAIL: 2,
};

/** 전체 판정 = 개별 검사 중 최악 값 (FAIL > WARNING > PASS) */
export function worstGovernanceStatus(
  statuses: GovernanceStatus[],
): GovernanceStatus {
  return statuses.reduce(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    "PASS" as GovernanceStatus,
  );
}

export interface GovernanceCheck {
  key: string;
  name: string;
  status: GovernanceStatus;
  messages: string[];
  /**
   * 이 검사가 실패했을 때 **발행을 막는가.**
   *
   * 상태와 따로 두는 이유: 같은 `WARNING`도 어떤 항목은 막아야 할 수 있고,
   * 무엇보다 **화면이 "주의인데 왜 막혔지"를 추측하지 않아도 되게** 해야 한다.
   */
  blocking: boolean;
}

/**
 * 필수 고지 규칙 (CTO_REQUEST #7의 "필수 고지").
 *
 * `whenCategory`가 있으면 그 분류의 상품에만 적용된다 — 모든 상품에 모든 고지를
 * 요구하면 본문이 고지문으로 덮이고, 그러면 아무도 읽지 않는다.
 */
export interface DisclosureRule {
  id: string;
  /** 본문에 반드시 있어야 하는 문구 */
  text: string;
  /** 이 분류에만 적용 — 없으면 전체 적용 */
  whenCategory?: string | null;
  /** 왜 필요한지 (법령·사내 규정) — 문구만 있으면 나중에 아무도 못 지운다 */
  reason?: string | null;
}

/**
 * 규칙을 읽은 결과의 출처 (TASK-2501).
 *
 * **미설정과 형식 오류는 다르다.** 둘을 `null` 하나로 뭉개면 "설정되지
 * 않았습니다"라고 말하게 되고, 운영자는 등록하러 갔다가 이미 등록된 것을
 * 발견한다 — 상태와 설명이 모순되는 그 상태다. 두 경우 모두 **검사하지
 * 못한 것**이라는 판정은 같지만, 해야 할 일이 다르다.
 */
export type RuleSource = "configured" | "missing" | "invalid";

export interface ContentGovernanceInput {
  content: {
    status: ContentStatus;
    title: string;
    body: string;
    /** 연결된 Product Object — 끊겼으면 null */
    productObject: {
      version: number;
      status: string;
      category: string | null;
    } | null;
  };
  /** Memory(GLOBAL, banned-words) — 읽지 못했으면 null */
  bannedWords: string[] | null;
  /** Memory(GLOBAL, required-disclosures) — 읽지 못했으면 null */
  disclosures: DisclosureRule[] | null;
  /**
   * 왜 읽지 못했는지 — 생략하면 `missing`으로 본다.
   * 값이 있는데도 `invalid`를 주면 값을 우선한다(모순된 입력을 만들지 않는다).
   */
  ruleSources?: {
    bannedWords?: RuleSource;
    disclosures?: RuleSource;
  };
  /** Knowledge(RULE/LEGAL) 검색 결과 */
  relatedRules: { title: string; category: string | null }[];
}

export interface ContentGovernanceVerdict {
  status: GovernanceStatus;
  checks: GovernanceCheck[];
  /** 발행을 막는 항목만 — 비어 있으면 발행할 수 있다 */
  blockers: GovernanceCheck[];
  /** 발행 가능 여부 — `blockers.length === 0` */
  publishable: boolean;
  /**
   * 판정에 실제로 쓰인 기준.
   *
   * **규칙은 나중에 바뀐다.** 지금 통과한 콘텐츠가 반년 뒤 기준으로는 위반일
   * 수 있고, 그때 "왜 발행됐지"에 답하려면 **그때의 기준**이 남아 있어야 한다.
   */
  appliedRules: {
    bannedWordCount: number | null;
    disclosureIds: string[] | null;
  };
}

/**
 * 금지어 스캔은 **READY 판정과 같은 함수를 쓴다** (`scanBannedWords`).
 *
 * 상품에서는 걸리는 말이 콘텐츠에서는 안 걸리면 어느 쪽 판정도 믿을 수 없다.
 * 그래서 여기서 다시 구현하지 않는다 — 규칙이 두 곳에 있으면 두 곳이 갈라진다.
 */
import { scanBannedWords as scan } from "../ready-validation/ready-validation";

/**
 * 본문에 고지 문구가 있는지 — 공백 차이는 무시한다.
 *
 * 사람이 붙여 넣은 문구는 줄바꿈·연속 공백이 원문과 다르기 마련이라,
 * 글자만 같으면 있는 것으로 본다. 없는데 있다고 하는 것보다
 * **있는데 없다고 하는 쪽이 발행을 막으므로** 더 조심해야 한다.
 */
export function containsDisclosure(body: string, text: string): boolean {
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const needle = normalize(text);
  if (needle.length === 0) {
    return true;
  }
  return normalize(body).includes(needle);
}

/** 이 상품 분류에 적용되는 고지 규칙만 고른다 */
export function applicableDisclosures(
  rules: DisclosureRule[],
  category: string | null,
): DisclosureRule[] {
  return rules.filter((rule) => {
    const scopeTo = rule.whenCategory?.trim();
    if (!scopeTo) {
      return true;
    }
    return (
      category !== null && category.toLowerCase() === scopeTo.toLowerCase()
    );
  });
}

/**
 * 발행 거버넌스 판정.
 *
 * 발행(`PUBLISHED` 전이) 직전에 부른다. 전이 규칙 자체(`canTransition`)는
 * 여기서 보지 않는다 — 그것은 파이프라인의 문법이고, 이것은 **내용의 판정**이다.
 */
export function evaluateContentGovernance(
  input: ContentGovernanceInput,
): ContentGovernanceVerdict {
  const { content } = input;
  const checks: GovernanceCheck[] = [];

  // 1) 발행 형식 — 제목·본문이 있어야 한다
  const missing: string[] = [];
  if (content.title.trim().length === 0) missing.push("제목");
  if (content.body.trim().length === 0) missing.push("본문");
  checks.push({
    key: "content-body",
    name: "제목·본문",
    status: missing.length === 0 ? "PASS" : "FAIL",
    blocking: true,
    messages:
      missing.length === 0
        ? [`제목 ${content.title.trim().length}자 · 본문 ${content.body.trim().length}자`]
        : [`${missing.join("·")}이 비어 있습니다.`],
  });

  // 2) 금지어 — 제목과 본문 **둘 다** 본다. 제목만 보면 본문에 든 것을 놓친다.
  if (input.bannedWords === null) {
    checks.push({
      key: "banned-words",
      name: "금지어 검사",
      // 미설정은 위반이 아니다 — 다만 통과도 아니다
      status: "WARNING",
      blocking: false,
      messages: [
        input.ruleSources?.bannedWords === "invalid"
          ? "금지어 목록의 형식이 올바르지 않아 검사하지 못했습니다 — 검사를 " +
            "통과한 것이 아닙니다. Memory(scope=GLOBAL, key=banned-words)의 값을 " +
            "문자열 배열로 고치세요 (등록은 되어 있습니다)."
          : "금지어 목록이 설정되지 않아 검사하지 못했습니다 — 검사를 통과한 것이 " +
            "아닙니다. Memory(scope=GLOBAL, key=banned-words)에 문자열 배열로 등록하세요.",
      ],
    });
  } else {
    const inTitle = scan(content.title, input.bannedWords);
    const inBody = scan(content.body, input.bannedWords);
    const hits = [...new Set([...inTitle, ...inBody])];
    checks.push({
      key: "banned-words",
      name: "금지어 검사",
      status: hits.length === 0 ? "PASS" : "FAIL",
      blocking: true,
      messages:
        hits.length === 0
          ? [`금지어 ${input.bannedWords.length}개 기준 위반 없음`]
          : [
              // 어디에 있는지 말한다 — "금지어가 있습니다"만으로는 고칠 수 없다
              `금지어 발견: ${hits.join(", ")}` +
                ` (제목 ${inTitle.length}건 · 본문 ${inBody.length}건)`,
            ],
    });
  }

  // 3) 필수 고지 — 분류에 해당하는 문구가 본문에 있어야 한다
  const category = content.productObject?.category ?? null;
  if (input.disclosures === null) {
    checks.push({
      key: "disclosures",
      name: "필수 고지",
      status: "WARNING",
      blocking: false,
      messages: [
        input.ruleSources?.disclosures === "invalid"
          ? "필수 고지 규칙의 형식이 올바르지 않아 검사하지 못했습니다 — 검사를 " +
            "통과한 것이 아닙니다. Memory(scope=GLOBAL, key=required-disclosures)의 " +
            "값을 {id, text} 객체 배열로 고치세요 (등록은 되어 있습니다)."
          : "필수 고지 규칙이 설정되지 않아 검사하지 못했습니다 — 검사를 통과한 것이 " +
            "아닙니다. Memory(scope=GLOBAL, key=required-disclosures)에 등록하세요.",
      ],
    });
  } else {
    const applicable = applicableDisclosures(input.disclosures, category);
    const absent = applicable.filter(
      (rule) => !containsDisclosure(content.body, rule.text),
    );
    checks.push({
      key: "disclosures",
      name: "필수 고지",
      status: absent.length === 0 ? "PASS" : "FAIL",
      blocking: true,
      messages:
        applicable.length === 0
          ? [
              // 적용 규칙이 0건인 것과 통과는 다르다 — 왜 0건인지 말한다
              category === null
                ? "분류를 알 수 없어 분류별 고지는 적용하지 않았습니다 — 전체 적용 규칙만 검사했습니다."
                : `분류 "${category}"에 적용되는 고지 규칙이 없습니다.`,
            ]
          : absent.length === 0
            ? [`적용 고지 ${applicable.length}건 모두 본문에 있습니다.`]
            : absent.map(
                (rule) =>
                  `본문에 없습니다 — "${rule.text}"` +
                  (rule.reason ? ` (${rule.reason})` : ""),
              ),
    });
  }

  // 4) 근거 상품 — 발행된 콘텐츠가 어디서 나왔는지 설명할 수 있어야 한다
  const source = content.productObject;
  checks.push({
    key: "source-object",
    name: "근거 상품 연결",
    status: source === null ? "WARNING" : source.status === "READY" ? "PASS" : "WARNING",
    // 막지 않는다 — 연결이 끊겨도 이미 쓰인 본문 자체가 잘못된 것은 아니다
    blocking: false,
    messages:
      source === null
        ? [
            "연결된 Product Object가 없습니다 — 발행 후 이 콘텐츠의 근거를 " +
              "추적할 수 없습니다.",
          ]
        : source.status === "READY"
          ? [`Product Object v${source.version} (READY)`]
          : [
              `Product Object v${source.version}이 ${source.status} 상태입니다 — ` +
                "READY 판정을 받지 않은 상품에서 만든 콘텐츠입니다.",
            ],
  });

  // 5) 관련 규칙 — 사람이 읽어야 하는 것이지 기계가 판정할 수 있는 것이 아니다
  checks.push({
    key: "related-rules",
    name: "관련 규칙 검토",
    status: input.relatedRules.length === 0 ? "PASS" : "WARNING",
    blocking: false,
    messages:
      input.relatedRules.length === 0
        ? ["관련 RULE/LEGAL 지식 없음"]
        : [
            `검토가 필요한 관련 규칙 ${input.relatedRules.length}건: ` +
              input.relatedRules
                .map((rule) => `${rule.title}(${rule.category ?? "-"})`)
                .join(", "),
          ],
  });

  const blockers = checks.filter(
    (check) => check.blocking && check.status === "FAIL",
  );

  return {
    status: worstGovernanceStatus(checks.map((check) => check.status)),
    checks,
    blockers,
    publishable: blockers.length === 0,
    appliedRules: {
      bannedWordCount: input.bannedWords?.length ?? null,
      disclosureIds:
        input.disclosures === null
          ? null
          : applicableDisclosures(input.disclosures, category).map(
              (rule) => rule.id,
            ),
    },
  };
}

/**
 * Memory 값에서 금지어 목록을 해석한다 — 형식이 다르면 `null`(미설정과 같게).
 *
 * **형식이 틀린 것을 빈 목록으로 읽으면 "위반 없음"이 된다.** 그래서 틀린
 * 형식은 검사하지 못한 것으로 본다.
 */
export function parseBannedWords(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((word) => typeof word === "string")) {
    return null;
  }
  return value as string[];
}

/**
 * Memory 값에서 필수 고지 규칙을 해석한다.
 *
 * `id`와 `text`가 없는 항목은 **버리지 않고 전체를 `null`로 돌린다** — 일부만
 * 읽으면 "규칙 3건 중 2건만 검사했다"는 사실이 아무 데도 남지 않는다.
 */
export function parseDisclosures(value: unknown): DisclosureRule[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const rules: DisclosureRule[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id.trim().length === 0 ||
      typeof record.text !== "string" ||
      record.text.trim().length === 0
    ) {
      return null;
    }
    rules.push({
      id: record.id,
      text: record.text,
      whenCategory:
        typeof record.whenCategory === "string" ? record.whenCategory : null,
      reason: typeof record.reason === "string" ? record.reason : null,
    });
  }
  return rules;
}
