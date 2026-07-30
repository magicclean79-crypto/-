import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applicableDisclosures,
  evaluateContentGovernance,
} from "./content-governance";
import { scanBannedWords } from "../ready-validation/ready-validation";

/**
 * 하지 않기로 한 것을 고정한다. (TASK-2601 — CTO 결정 2501-②③④)
 *
 * **하지 않기로 한 일은 코드에 흔적이 없어서, 나중에 누가 "편의를 위해"
 * 되살려도 아무도 모른다.** 그래서 없다는 사실 자체를 테스트로 남긴다 —
 * 우회 플래그를 두지 않기로 한 것(결정 2201-③)을 고정한 것과 같은 이유다.
 */

const source = (relative: string) =>
  readFileSync(join(__dirname, relative), "utf8");

describe("Governance 경계 — 하지 않기로 한 것 (TASK-2601)", () => {
  describe("금지어는 부분 일치를 유지한다 (CTO 결정 2501-②)", () => {
    it("단어 경계를 보지 않는다 — '최고'가 '최고급'에도 걸린다", () => {
      // 넓게 걸고 사람이 판단한다. 좁히면 놓치는 쪽이 위험하다.
      expect(scanBannedWords("최고급 원료", ["최고"])).toEqual(["최고"]);
      expect(scanBannedWords("1위권 제품", ["1위"])).toEqual(["1위"]);
    });

    it("판정도 같은 규칙으로 막는다", () => {
      const verdict = evaluateContentGovernance({
        content: {
          status: "REVIEW",
          title: "최고급 주방세제",
          body: "본문",
          productObject: null,
        },
        bannedWords: ["최고"],
        disclosures: [],
        relatedRules: [],
      });
      expect(verdict.publishable).toBe(false);
    });

    it("예외 목록이라는 개념이 코드에 없다", () => {
      // 예외를 두면 "이 말은 괜찮다"는 판단이 코드에 숨는다
      const code = source("./content-governance.ts");
      for (const forbidden of [
        "allowList",
        "allowlist",
        "exception",
        "exemptWords",
        "wordBoundary",
        "\\\\b",
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it("금지어 스캔에 정규식을 쓰지 않는다 — 부분 일치는 includes로 한다", () => {
      const code = source("../ready-validation/ready-validation.ts");
      expect(code).toContain("includes(word.toLowerCase())");
      expect(code).not.toContain("new RegExp");
    });
  });

  describe("READY는 Advisory Mode를 유지한다 (CTO 결정 2501-③)", () => {
    it("READY 판정 모듈이 전이를 막는 코드를 갖지 않는다", () => {
      // 강제하는 것은 발행뿐이다 — 상품 단계는 판단만 돕는다
      const code = source("../ready-validation/ready-validation.ts");
      expect(code).not.toContain("BadRequest");
      expect(code).not.toContain("throw");
    });

    it("발행 판정만 publishable을 돌려준다", () => {
      // READY 판정에는 "막는다"에 해당하는 출력이 없다
      const ready = source("../ready-validation/ready-validation.ts");
      expect(ready).not.toContain("publishable");
      expect(ready).not.toContain("blocking");

      const governance = source("./content-governance.ts");
      expect(governance).toContain("publishable");
      expect(governance).toContain("blocking");
    });
  });

  describe("규칙 스코프는 GLOBAL만 유지한다 (CTO 결정 2501-④)", () => {
    it("판정 입력에 프로젝트·분류별 규칙 스코프가 없다", () => {
      const code = source("./content-governance.ts");
      for (const forbidden of [
        "scopeId",
        "projectRules",
        "ruleScope",
        "PROJECT",
      ]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it("고지 규칙의 분류 조건은 상품 분류일 뿐 규칙 스코프가 아니다", () => {
      // whenCategory는 "어느 상품에 요구하는가"이고, 규칙이 어디에
      // 저장되는가와는 무관하다
      const rules = [
        { id: "all", text: "전체" },
        { id: "one", text: "분류", whenCategory: "생활용품" },
      ];
      expect(applicableDisclosures(rules, "생활용품").map((r) => r.id)).toEqual([
        "all",
        "one",
      ]);
      expect(applicableDisclosures(rules, "식품").map((r) => r.id)).toEqual([
        "all",
      ]);
    });
  });

  describe("Preflight는 고치지 않는다 (CTO 결정 2501-①)", () => {
    it("스캔 요약에 '수정'에 해당하는 출력이 없다", () => {
      const code = source("./preflight.ts");
      for (const forbidden of ["fixed", "autoFix", "repaired", "rewritten"]) {
        expect(code).not.toContain(forbidden);
      }
    });

    it("자동 수정을 하지 않는 이유가 문서로 남아 있다", () => {
      // 왜 안 하는지가 없으면 다음 사람이 "편의를 위해" 넣는다
      const code = source("./preflight.ts");
      expect(code).toContain("자동 수정을 하지 않는 이유");
      expect(code).toContain("CTO 결정 2201-②");
    });
  });
});
