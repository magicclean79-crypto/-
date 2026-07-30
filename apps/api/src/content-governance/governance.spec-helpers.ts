import type { CompanyBrainQueryRequest } from "@acos/shared";
import {
  BANNED_WORDS_KEY,
  DISCLOSURES_KEY,
} from "./governance-rules.service";

/**
 * CompanyBrainService 목업 — 호출된 query에 따라 준비된 섹션을 돌려준다.
 *
 * **거버넌스 규칙을 읽는 곳이 하나이므로 목업도 하나다** (TASK-2501).
 * READY 판정과 발행 게이트가 같은 목업을 쓰지 않으면, 테스트에서는 두
 * 판정이 같은 규칙을 본다는 사실이 검증되지 않는다.
 *
 * - `bannedWords`: GLOBAL Memory(banned-words) value (undefined면 미설정)
 * - `disclosures`: GLOBAL Memory(required-disclosures) value (undefined면 미설정)
 */
export function createCompanyBrainMock(options?: {
  bannedWords?: unknown;
  disclosures?: unknown;
  ruleKnowledge?: { title: string; category: string | null }[];
  decisions?: { title: string }[];
  hasSop?: boolean;
}) {
  const hasSop = options?.hasSop ?? true;
  const memory = (key: string, value: unknown) => ({
    id: `mem-${key}`,
    scope: "GLOBAL",
    scopeId: null,
    key,
    value,
    description: null,
    createdAt: "",
    updatedAt: "",
  });

  return {
    query: jest.fn(async (request: CompanyBrainQueryRequest) => {
      const memoryItems =
        request.query === BANNED_WORDS_KEY && options?.bannedWords !== undefined
          ? [memory(BANNED_WORDS_KEY, options.bannedWords)]
          : request.query === DISCLOSURES_KEY &&
              options?.disclosures !== undefined
            ? [memory(DISCLOSURES_KEY, options.disclosures)]
            : [];
      return {
        query: request.query,
        results: [
          { source: "MEMORY", items: memoryItems },
          {
            source: "KNOWLEDGE",
            items: (options?.ruleKnowledge ?? []).map((rule, index) => ({
              id: `kn-${index}`,
              title: rule.title,
              content: "",
              category: rule.category,
              createdAt: "",
              updatedAt: "",
            })),
          },
          {
            source: "DECISION",
            items: (options?.decisions ?? []).map((decision, index) => ({
              id: `dec-${index}`,
              projectId: "proj-1",
              title: decision.title,
              description: null,
              reason: "",
              decisionType: "PROCESS",
              author: "CTO",
              createdAt: "",
              updatedAt: "",
            })),
          },
          {
            source: "SOP",
            items: hasSop
              ? [
                  {
                    key: "product-content",
                    name: "상품 콘텐츠 표준 절차",
                    description: "",
                    steps: [],
                  },
                ]
              : [],
          },
        ],
      };
    }),
  };
}
