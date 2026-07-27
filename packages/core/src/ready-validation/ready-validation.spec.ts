import {
  evaluateReadyValidation,
  scanBannedWords,
  worstStatus,
} from "./ready-validation";
import type { ReadyValidationContext } from "./ready-validation";

function baseInput(): ReadyValidationContext {
  return {
    productObject: {
      status: "DRAFT",
      title: "Magic Clean PVC Mat",
      brand: null,
      category: "생활용품",
      ocrText: "Magic Clean PVC Mat 60x90",
      ocrSummary: { combinedText: "Magic Clean PVC Mat 60x90" },
      visionSummary: null,
    },
    bannedWords: ["최고", "1위"],
    relatedRules: [],
    relatedDecisions: [],
    hasStandardSop: true,
  };
}

describe("READY Validation Engine", () => {
  it("전체 판정은 개별 검사 중 최악 값이다 (FAIL > WARNING > PASS)", () => {
    expect(worstStatus(["PASS", "PASS"])).toBe("PASS");
    expect(worstStatus(["PASS", "WARNING", "PASS"])).toBe("WARNING");
    expect(worstStatus(["WARNING", "FAIL", "PASS"])).toBe("FAIL");
    expect(worstStatus([])).toBe("PASS");
  });

  it("모든 조건 충족 시 PASS — 6개 검사 전부 수행", () => {
    const result = evaluateReadyValidation(baseInput());

    expect(result.status).toBe("PASS");
    expect(result.checks.map((check) => check.key)).toEqual([
      "transition",
      "requirements",
      "banned-words",
      "knowledge-rules",
      "decisions",
      "sop",
    ]);
    expect(result.checks.every((check) => check.status === "PASS")).toBe(true);
  });

  it("금지어 발견 시 FAIL — 제목/브랜드/카테고리/OCR 텍스트를 스캔한다", () => {
    const input = baseInput();
    input.productObject.title = "국내 1위 매트";
    const result = evaluateReadyValidation(input);

    const check = result.checks.find((item) => item.key === "banned-words");
    expect(check?.status).toBe("FAIL");
    expect(check?.messages[0]).toContain("1위");
    expect(result.status).toBe("FAIL");

    expect(scanBannedWords("최고의 제품", ["최고", "1위"])).toEqual(["최고"]);
    expect(scanBannedWords("평범한 제품", ["최고"])).toEqual([]);
  });

  it("금지어 목록 미설정이면 WARNING (검사 건너뜀 안내)", () => {
    const input = baseInput();
    input.bannedWords = null;
    const result = evaluateReadyValidation(input);

    expect(
      result.checks.find((item) => item.key === "banned-words")?.status,
    ).toBe("WARNING");
    expect(result.status).toBe("WARNING");
  });

  it("전이 불가(ARCHIVED)·필수 조건 미충족은 FAIL", () => {
    const archived = baseInput();
    archived.productObject.status = "ARCHIVED";
    expect(
      evaluateReadyValidation(archived).checks.find(
        (item) => item.key === "transition",
      )?.status,
    ).toBe("FAIL");

    const missing = baseInput();
    missing.productObject.title = "";
    missing.productObject.ocrSummary = null;
    missing.productObject.visionSummary = null;
    const result = evaluateReadyValidation(missing);
    expect(
      result.checks.find((item) => item.key === "requirements")?.status,
    ).toBe("FAIL");
    expect(result.status).toBe("FAIL");
  });

  it("관련 RULE/LEGAL 지식은 WARNING, 관련 결정은 정보성 PASS, SOP 부재는 WARNING", () => {
    const input = baseInput();
    input.relatedRules = [{ title: "상세페이지 금지어", category: "RULE" }];
    input.relatedDecisions = [{ title: "금지어 정책 도입" }];
    input.hasStandardSop = false;

    const result = evaluateReadyValidation(input);
    expect(
      result.checks.find((item) => item.key === "knowledge-rules")?.status,
    ).toBe("WARNING");
    expect(
      result.checks.find((item) => item.key === "decisions")?.status,
    ).toBe("PASS");
    expect(result.checks.find((item) => item.key === "sop")?.status).toBe(
      "WARNING",
    );
    expect(result.status).toBe("WARNING");
  });
});
