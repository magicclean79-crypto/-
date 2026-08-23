import { GeminiAnalysisError, GeminiAnalysisGenerator, type GeminiAnalysisClient } from "./gemini-analysis.client";

function makeClient(response: { text?: string; finishReason?: string; modelVersion?: string }): GeminiAnalysisClient {
  return {
    models: {
      generateContent: jest.fn().mockResolvedValue({
        text: response.text,
        modelVersion: response.modelVersion,
        candidates: [{ finishReason: response.finishReason }],
      }),
    },
  };
}

describe("GeminiAnalysisGenerator", () => {
  it("정상 JSON 응답을 파싱해 검증된 정보/역할/페이지 계획을 반환한다", async () => {
    const payload = {
      verifiedProductFacts: {
        name: "베란다용 스텐 호스 세트 3M",
        brand: "삼정크린마스터(주)",
        model: null,
        manufacturer: null,
        originCountry: "대한민국",
        materials: ["ABS", "PVC"],
        dimensions: "3M",
        includedComponents: ["분사기", "호스"],
        specs: { 길이: "3M" },
        cautions: ["고온 주의"],
      },
      assetRoles: [
        { assetIndex: 0, role: "ACTUAL_PRODUCT" },
        { assetIndex: 1, role: "PACKAGING" },
      ],
      pagePlan: [
        { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "전체 샷" },
        { pageIndex: 2, pageRole: "FEATURES", title: "특징", designBrief: "클로즈업" },
        { pageIndex: 3, pageRole: "USE", title: "사용법", designBrief: "사용 장면" },
        { pageIndex: 4, pageRole: "COMPONENTS", title: "구성품", designBrief: "구성품 펼침" },
      ],
    };
    const client = makeClient({ text: JSON.stringify(payload), modelVersion: "gemini-2.5-flash-002" });
    const generator = new GeminiAnalysisGenerator({ apiKey: "k", client });

    const result = await generator.analyze([
      { base64: "AA==", mimeType: "image/jpeg" },
      { base64: "BB==", mimeType: "image/jpeg" },
    ]);

    expect(result.model).toBe("gemini-2.5-flash-002");
    expect(result.result.verifiedProductFacts.name).toBe("베란다용 스텐 호스 세트 3M");
    expect(result.result.assetRoles).toHaveLength(2);
    expect(result.result.pagePlan).toHaveLength(4);
  });

  it("확인되지 않은 필드를 지어내지 않고 null/빈 배열로 정제한다", async () => {
    const payload = {
      verifiedProductFacts: {
        name: "제품명",
        brand: 12345, // 잘못된 타입 — 무시되어야 함
        materials: "문자열(배열 아님)", // 무시되어야 함
      },
      assetRoles: [{ assetIndex: 0, role: "NOT_A_REAL_ROLE" }, { assetIndex: 99, role: "ACTUAL_PRODUCT" }],
      pagePlan: [
        { pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x" },
        { pageIndex: 2, pageRole: "FEATURES", title: "특징", designBrief: "y" },
        { pageIndex: 3, pageRole: "USE", title: "사용", designBrief: "z" },
        { pageIndex: 4, pageRole: "COMPONENTS", title: "구성품", designBrief: "w" },
      ],
    };
    const client = makeClient({ text: JSON.stringify(payload) });
    const generator = new GeminiAnalysisGenerator({ apiKey: "k", client });

    const result = await generator.analyze([{ base64: "AA==", mimeType: "image/jpeg" }]);

    expect(result.result.verifiedProductFacts.name).toBe("제품명");
    expect(result.result.verifiedProductFacts.brand).toBeNull();
    expect(result.result.verifiedProductFacts.materials).toEqual([]);
    // 잘못된 role 문자열·범위 밖 assetIndex는 버려진다.
    expect(result.result.assetRoles).toEqual([]);
  });

  it("JSON이 아닌 응답이면 GeminiAnalysisError를 던진다", async () => {
    const client = makeClient({ text: "이것은 JSON이 아닙니다" });
    const generator = new GeminiAnalysisGenerator({ apiKey: "k", client });

    await expect(generator.analyze([{ base64: "AA==", mimeType: "image/jpeg" }])).rejects.toBeInstanceOf(
      GeminiAnalysisError,
    );
  });

  it("응답 텍스트가 비어 있으면 GeminiAnalysisError를 던진다", async () => {
    const client = makeClient({ text: "", finishReason: "SAFETY" });
    const generator = new GeminiAnalysisGenerator({ apiKey: "k", client });

    await expect(generator.analyze([{ base64: "AA==", mimeType: "image/jpeg" }])).rejects.toBeInstanceOf(
      GeminiAnalysisError,
    );
  });

  it("페이지 계획이 최소 4장 미만이면 GeminiAnalysisError를 던진다", async () => {
    const payload = {
      verifiedProductFacts: {},
      assetRoles: [],
      pagePlan: [{ pageIndex: 1, pageRole: "HERO", title: "대표", designBrief: "x" }],
    };
    const client = makeClient({ text: JSON.stringify(payload) });
    const generator = new GeminiAnalysisGenerator({ apiKey: "k", client });

    await expect(generator.analyze([{ base64: "AA==", mimeType: "image/jpeg" }])).rejects.toBeInstanceOf(
      GeminiAnalysisError,
    );
  });
});
