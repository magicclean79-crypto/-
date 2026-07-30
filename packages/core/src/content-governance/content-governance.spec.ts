import {
  applicableDisclosures,
  containsDisclosure,
  evaluateContentGovernance,
  parseBannedWords,
  parseDisclosures,
  worstGovernanceStatus,
} from "./content-governance";
import type {
  ContentGovernanceInput,
  DisclosureRule,
} from "./content-governance";
import { scanBannedWords } from "../ready-validation/ready-validation";

/** 통과하는 기본 입력 — 각 테스트는 필요한 곳만 바꾼다 */
function input(
  overrides: Partial<ContentGovernanceInput> = {},
): ContentGovernanceInput {
  return {
    content: {
      status: "REVIEW",
      title: "순한 주방세제 500ml",
      body: "주방에서 쓰는 세제입니다. 사용 후 물로 충분히 헹구세요.",
      productObject: { version: 3, status: "READY", category: "세제" },
      ...overrides.content,
    },
    bannedWords: overrides.bannedWords === undefined ? [] : overrides.bannedWords,
    disclosures: overrides.disclosures === undefined ? [] : overrides.disclosures,
    ruleSources: overrides.ruleSources,
    relatedRules: overrides.relatedRules ?? [],
  };
}

const find = (
  verdict: ReturnType<typeof evaluateContentGovernance>,
  key: string,
) => verdict.checks.find((check) => check.key === key)!;

describe("Content Governance (TASK-2501)", () => {
  it("문제가 없으면 통과하고 발행할 수 있다", () => {
    const verdict = evaluateContentGovernance(input());
    expect(verdict.status).toBe("PASS");
    expect(verdict.blockers).toEqual([]);
    expect(verdict.publishable).toBe(true);
  });

  it("다섯 검사가 모두 결과를 낸다 — 조용히 빠지는 항목이 없다", () => {
    const keys = evaluateContentGovernance(input()).checks.map((c) => c.key);
    expect(keys).toEqual([
      "content-body",
      "banned-words",
      "disclosures",
      "source-object",
      "related-rules",
    ]);
  });

  describe("금지어 — 발행되는 것을 검사한다", () => {
    it("본문에 있는 금지어를 잡아낸다 — 제목만 보면 놓친다", () => {
      // READY 판정은 상품의 제목·브랜드·OCR만 봤다. 본문은 아무도 안 봤다.
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "순한 주방세제 500ml",
            body: "이 제품은 업계 1위입니다.",
            productObject: { version: 3, status: "READY", category: "세제" },
          },
          bannedWords: ["1위", "최고"],
        }),
      );
      const check = find(verdict, "banned-words");
      expect(check.status).toBe("FAIL");
      expect(check.blocking).toBe(true);
      expect(verdict.publishable).toBe(false);
      expect(check.messages[0]).toContain("1위");
    });

    it("어디에 있는지 말한다 — 있다는 말만으로는 고칠 수 없다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "최고의 주방세제",
            body: "최고 등급 원료를 씁니다.",
            productObject: { version: 1, status: "READY", category: null },
          },
          bannedWords: ["최고"],
        }),
      );
      expect(find(verdict, "banned-words").messages[0]).toContain(
        "제목 1건 · 본문 1건",
      );
    });

    it("READY 판정과 같은 스캔 규칙을 쓴다", () => {
      // 상품에서는 걸리는 말이 콘텐츠에서는 안 걸리면 어느 쪽도 믿을 수 없다
      const words = ["최고", "1위"];
      const text = "업계 1위 최고 제품";
      expect(scanBannedWords(text, words)).toEqual(["최고", "1위"]);
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "제품",
            body: text,
            productObject: null,
          },
          bannedWords: words,
        }),
      );
      const message = find(verdict, "banned-words").messages[0];
      for (const word of words) {
        expect(message).toContain(word);
      }
    });

    it("목록이 미설정이면 주의이고, 통과가 아니라고 말한다", () => {
      const check = find(
        evaluateContentGovernance(input({ bannedWords: null })),
        "banned-words",
      );
      expect(check.status).toBe("WARNING");
      // 미구성과 실패는 다르다 — 막지는 않는다
      expect(check.blocking).toBe(false);
      expect(check.messages[0]).toContain("통과한 것이 아닙니다");
    });

    it("목록이 비어 있으면 검사한 것이다 — 미설정과 다르다", () => {
      const check = find(
        evaluateContentGovernance(input({ bannedWords: [] })),
        "banned-words",
      );
      expect(check.status).toBe("PASS");
      expect(check.messages[0]).toContain("0개 기준");
    });
  });

  describe("필수 고지", () => {
    const rules: DisclosureRule[] = [
      { id: "wash", text: "사용 후 물로 충분히 헹구세요.", reason: "사내 규정" },
      { id: "food", text: "건강기능식품 문구", whenCategory: "건강식품" },
    ];

    it("본문에 있으면 통과한다", () => {
      const check = find(
        evaluateContentGovernance(input({ disclosures: rules })),
        "disclosures",
      );
      expect(check.status).toBe("PASS");
      expect(check.messages[0]).toContain("1건 모두");
    });

    it("빠진 문구가 있으면 발행을 막고, 무엇이 없는지 그대로 보여준다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "주방세제",
            body: "좋은 세제입니다.",
            productObject: { version: 1, status: "READY", category: "세제" },
          },
          disclosures: rules,
        }),
      );
      const check = find(verdict, "disclosures");
      expect(check.status).toBe("FAIL");
      expect(verdict.publishable).toBe(false);
      expect(check.messages[0]).toContain("사용 후 물로 충분히 헹구세요.");
      // 왜 필요한지도 함께 — 문구만 있으면 나중에 아무도 못 지운다
      expect(check.messages[0]).toContain("사내 규정");
    });

    it("분류가 다른 고지는 요구하지 않는다 — 모든 고지를 다 붙이면 아무도 안 읽는다", () => {
      const check = find(
        evaluateContentGovernance(input({ disclosures: rules })),
        "disclosures",
      );
      // 건강식품 문구는 세제에 요구되지 않는다
      expect(check.status).toBe("PASS");
      expect(applicableDisclosures(rules, "세제").map((r) => r.id)).toEqual([
        "wash",
      ]);
      expect(applicableDisclosures(rules, "건강식품").map((r) => r.id)).toEqual([
        "wash",
        "food",
      ]);
    });

    it("분류를 모르면 전체 적용 규칙만 검사하고, 그 사실을 말한다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "제품",
            body: "사용 후 물로 충분히 헹구세요.",
            productObject: null,
          },
          disclosures: [rules[1]],
        }),
      );
      const check = find(verdict, "disclosures");
      expect(check.status).toBe("PASS");
      expect(check.messages[0]).toContain("분류를 알 수 없어");
    });

    it("공백 차이는 무시한다 — 붙여 넣은 문구는 줄바꿈이 다르다", () => {
      expect(
        containsDisclosure("앞말\n사용 후   물로\n충분히 헹구세요. 뒷말", "사용 후 물로 충분히 헹구세요."),
      ).toBe(true);
      expect(containsDisclosure("전혀 다른 본문", "사용 후 물로")).toBe(false);
    });

    it("규칙이 미설정이면 주의이고 막지 않는다", () => {
      const check = find(
        evaluateContentGovernance(input({ disclosures: null })),
        "disclosures",
      );
      expect(check.status).toBe("WARNING");
      expect(check.blocking).toBe(false);
      expect(check.messages[0]).toContain("통과한 것이 아닙니다");
    });
  });

  describe("제목·본문", () => {
    it("본문이 비면 발행을 막는다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "제목",
            body: "   \n  ",
            productObject: null,
          },
        }),
      );
      expect(find(verdict, "content-body").status).toBe("FAIL");
      expect(verdict.publishable).toBe(false);
      expect(find(verdict, "content-body").messages[0]).toContain("본문이 비어");
    });

    it("공백만 있는 제목은 있는 것으로 세지 않는다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "\t \n",
            body: "본문",
            productObject: null,
          },
        }),
      );
      expect(find(verdict, "content-body").messages[0]).toContain("제목이 비어");
    });
  });

  describe("근거 상품 연결", () => {
    it("연결이 끊기면 주의로 드러내되 막지 않는다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "제목",
            body: "본문",
            productObject: null,
          },
        }),
      );
      const check = find(verdict, "source-object");
      expect(check.status).toBe("WARNING");
      expect(check.blocking).toBe(false);
      // 본문 자체가 잘못된 것은 아니다 — 다만 근거를 추적할 수 없다
      expect(verdict.publishable).toBe(true);
      expect(check.messages[0]).toContain("추적할 수 없습니다");
    });

    it("READY가 아닌 상품에서 나온 콘텐츠는 주의로 남는다", () => {
      const check = find(
        evaluateContentGovernance(
          input({
            content: {
              status: "REVIEW",
              title: "제목",
              body: "본문",
              productObject: { version: 2, status: "DRAFT", category: null },
            },
          }),
        ),
        "source-object",
      );
      expect(check.status).toBe("WARNING");
      expect(check.messages[0]).toContain("DRAFT 상태입니다");
      expect(check.messages[0]).toContain("READY 판정을 받지 않은");
    });
  });

  describe("판정 당시 기준 기록", () => {
    it("적용된 기준을 함께 돌려준다 — 규칙은 나중에 바뀐다", () => {
      const verdict = evaluateContentGovernance(
        input({
          bannedWords: ["최고", "1위", "유일"],
          disclosures: [
            { id: "wash", text: "사용 후 물로 충분히 헹구세요." },
            { id: "food", text: "건강기능식품", whenCategory: "건강식품" },
          ],
        }),
      );
      expect(verdict.appliedRules.bannedWordCount).toBe(3);
      // 세제에 적용된 것만 — "전체 규칙 수"가 아니라 "이 판정에 쓰인 것"이다
      expect(verdict.appliedRules.disclosureIds).toEqual(["wash"]);
    });

    it("검사하지 못한 기준은 0이 아니라 null이다", () => {
      const verdict = evaluateContentGovernance(
        input({ bannedWords: null, disclosures: null }),
      );
      expect(verdict.appliedRules.bannedWordCount).toBeNull();
      expect(verdict.appliedRules.disclosureIds).toBeNull();
    });
  });

  describe("차단과 경보를 구분한다", () => {
    it("주의만 있으면 발행할 수 있다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "제목",
            body: "본문",
            productObject: null,
          },
          bannedWords: null,
          disclosures: null,
          relatedRules: [{ title: "화장품 표시 규정", category: "LEGAL" }],
        }),
      );
      expect(verdict.status).toBe("WARNING");
      expect(verdict.blockers).toEqual([]);
      expect(verdict.publishable).toBe(true);
    });

    it("막는 항목만 blockers에 담긴다", () => {
      const verdict = evaluateContentGovernance(
        input({
          content: {
            status: "REVIEW",
            title: "최고 제품",
            body: "본문",
            productObject: null,
          },
          bannedWords: ["최고"],
        }),
      );
      expect(verdict.blockers.map((b) => b.key)).toEqual(["banned-words"]);
      expect(verdict.status).toBe("FAIL");
    });

    it("전체 판정은 최악 값이다", () => {
      expect(worstGovernanceStatus(["PASS", "WARNING", "PASS"])).toBe("WARNING");
      expect(worstGovernanceStatus(["WARNING", "FAIL"])).toBe("FAIL");
      expect(worstGovernanceStatus([])).toBe("PASS");
    });
  });

  describe("미설정과 형식 오류를 구분한다 (TASK-2501 자체 발견 결함)", () => {
    it("형식 오류에 '설정되지 않았다'고 말하지 않는다", () => {
      // 뭉개면 운영자는 등록하러 갔다가 이미 등록된 것을 발견한다 —
      // 상태와 설명이 모순되는 그 상태다
      const verdict = evaluateContentGovernance(
        input({
          bannedWords: null,
          disclosures: null,
          ruleSources: { bannedWords: "invalid", disclosures: "invalid" },
        }),
      );
      for (const key of ["banned-words", "disclosures"]) {
        const check = find(verdict, key);
        expect(check.status).toBe("WARNING");
        expect(check.messages[0]).toContain("형식이 올바르지 않아");
        expect(check.messages[0]).toContain("등록은 되어 있습니다");
        expect(check.messages[0]).not.toContain("설정되지 않아");
      }
    });

    it("미설정에는 등록하라고 말한다", () => {
      const verdict = evaluateContentGovernance(
        input({
          bannedWords: null,
          disclosures: null,
          ruleSources: { bannedWords: "missing", disclosures: "missing" },
        }),
      );
      for (const key of ["banned-words", "disclosures"]) {
        const check = find(verdict, key);
        expect(check.messages[0]).toContain("설정되지 않아");
        expect(check.messages[0]).not.toContain("등록은 되어 있습니다");
      }
    });

    it("출처를 주지 않으면 미설정으로 본다 — 기존 호출부가 그대로 동작한다", () => {
      const check = find(
        evaluateContentGovernance(input({ bannedWords: null })),
        "banned-words",
      );
      expect(check.messages[0]).toContain("설정되지 않아");
    });

    it("어느 출처에서도 판정과 차단 강도는 같다 — 둘 다 검사하지 못한 것이다", () => {
      for (const source of ["missing", "invalid"] as const) {
        const verdict = evaluateContentGovernance(
          input({
            bannedWords: null,
            disclosures: null,
            ruleSources: { bannedWords: source, disclosures: source },
          }),
        );
        expect(verdict.status).toBe("WARNING");
        expect(verdict.publishable).toBe(true);
        expect(verdict.appliedRules.bannedWordCount).toBeNull();
      }
    });
  });

  describe("판정 문구", () => {
    it("어떤 입력에서도 마크다운 강조가 새지 않는다", () => {
      // 로그·화면에 그대로 나가는 문자열이다 (같은 결함 계열 5번째 방지)
      for (const candidate of [
        input(),
        input({ bannedWords: null, disclosures: null }),
        input({
          content: {
            status: "REVIEW",
            title: "최고",
            body: "",
            productObject: { version: 1, status: "DRAFT", category: "세제" },
          },
          bannedWords: ["최고"],
          disclosures: [{ id: "x", text: "없는 문구", reason: "법령" }],
          relatedRules: [{ title: "규정", category: "RULE" }],
        }),
      ]) {
        for (const check of evaluateContentGovernance(candidate).checks) {
          for (const message of check.messages) {
            expect(message).not.toContain("**");
          }
        }
      }
    });
  });
});

describe("Memory 값 해석 (TASK-2501)", () => {
  it("금지어는 문자열 배열만 받는다", () => {
    expect(parseBannedWords(["최고", "1위"])).toEqual(["최고", "1위"]);
    expect(parseBannedWords([])).toEqual([]);
  });

  it("형식이 틀린 금지어는 빈 목록이 아니라 미설정으로 본다", () => {
    // 빈 목록으로 읽으면 "위반 없음"이 된다 — 그것이 거짓 통과다
    for (const value of [null, "최고", { words: [] }, ["최고", 1], [null]]) {
      expect(parseBannedWords(value)).toBeNull();
    }
  });

  it("고지 규칙을 해석한다", () => {
    expect(
      parseDisclosures([
        { id: "a", text: "문구 A" },
        { id: "b", text: "문구 B", whenCategory: "세제", reason: "법령" },
      ]),
    ).toEqual([
      { id: "a", text: "문구 A", whenCategory: null, reason: null },
      { id: "b", text: "문구 B", whenCategory: "세제", reason: "법령" },
    ]);
  });

  it("항목 하나가 잘못되면 전체를 미설정으로 본다 — 일부만 검사한 사실이 남지 않는다", () => {
    for (const value of [
      [{ id: "a" }],
      [{ text: "문구" }],
      [{ id: "", text: "문구" }],
      [{ id: "a", text: "  " }],
      [{ id: "a", text: "문구" }, "문자열"],
      "배열 아님",
    ]) {
      expect(parseDisclosures(value)).toBeNull();
    }
  });
});
