import type { ProductProfile } from "@acos/shared";
import { applyCrossVerifiedProfile, crossVerifyProduct } from "./cross-verification";
import { identifyProduct } from "./product-identification";

const profile: ProductProfile = {
  productName: "베란다용 스텐 호스 세트 3M",
  brand: "삼정크린마스터(주)",
  model: null,
  material: "ABS, PVC, 스테인리스",
  features: [],
  specifications: {},
  usage: null,
  advantages: [],
  warnings: [],
  keywords: [],
  confidence: 0.8,
};

describe("crossVerifyProduct — 출처가 하나뿐이면 그대로 쓴다", () => {
  it("OCR에서만 브랜드를 찾았으면 그 값을 쓴다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const result = crossVerifyProduct({ identification, profile: null });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("single-source");
    expect(brand?.resolvedValue).toBe("삼정크린마스터(주)");
    expect(result.hasConflict).toBe(false);
  });

  it("GPT 분석에서만 브랜드를 찾았으면 그 값을 쓴다", () => {
    const identification = identifyProduct({ ocrText: null });
    const result = crossVerifyProduct({ identification, profile });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("single-source");
    expect(brand?.resolvedValue).toBe("삼정크린마스터(주)");
  });

  it("아무 출처도 값이 없으면 unknown이고 resolvedValue는 null이다", () => {
    const identification = identifyProduct({ ocrText: null });
    const result = crossVerifyProduct({ identification, profile: null });

    const brand = result.fields.find((f) => f.field === "brand");
    const model = result.fields.find((f) => f.field === "model");
    expect(brand?.status).toBe("unknown");
    expect(brand?.resolvedValue).toBeNull();
    expect(model?.status).toBe("unknown");
    expect(result.hasConflict).toBe(false);
  });
});

describe("crossVerifyProduct — 두 출처가 같은 값을 말하면 확정한다", () => {
  it("OCR과 GPT 분석이 같은 브랜드를 말하면 agreed다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const result = crossVerifyProduct({ identification, profile });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("agreed");
    expect(brand?.resolvedValue).toBe("삼정크린마스터(주)");
    expect(result.hasConflict).toBe(false);
  });

  it("띄어쓰기·괄호 차이는 같은 값으로 본다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터 주" });
    const result = crossVerifyProduct({ identification, profile });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("agreed");
  });
});

describe("crossVerifyProduct — 충돌하면 자동으로 채우지 않는다 (T1-23)", () => {
  it("OCR과 GPT 분석이 서로 다른 브랜드를 말하면 conflict이고 resolvedValue는 null이다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 다른회사(주)" });
    const result = crossVerifyProduct({ identification, profile });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("conflict");
    expect(brand?.resolvedValue).toBeNull();
    expect(brand?.observations).toEqual([
      { source: "OCR 직접 추출", value: "다른회사(주)" },
      { source: "GPT 분석(사진+OCR 종합)", value: "삼정크린마스터(주)" },
    ]);
    expect(result.hasConflict).toBe(true);
  });

  it("모델명이 충돌해도 브랜드 판정에는 영향을 주지 않는다 — 항목별로 독립 판정", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)\n모델명 XX-999" });
    const conflictingProfile: ProductProfile = { ...profile, model: "YY-111" };
    const result = crossVerifyProduct({ identification, profile: conflictingProfile });

    const brand = result.fields.find((f) => f.field === "brand");
    const model = result.fields.find((f) => f.field === "model");
    expect(brand?.status).toBe("agreed");
    expect(model?.status).toBe("conflict");
    expect(model?.resolvedValue).toBeNull();
  });
});

describe("applyCrossVerifiedProfile — STEP 5(카피·HTML)는 검증된 값만 받는다 (T1-24/T1-75)", () => {
  it("agreed면 그 값을 brand/model에 적용한다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const crossVerification = crossVerifyProduct({ identification, profile });

    const verified = applyCrossVerifiedProfile(profile, crossVerification);

    expect(verified.brand).toBe("삼정크린마스터(주)");
    expect(verified).not.toBe(profile); // 원본을 변경하지 않고 새 객체를 돌려준다
  });

  it("conflict면 STEP 4 원본 값이 있어도 null로 덮는다 — 사람 판단 전에는 확정하지 않는다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 다른회사(주)" });
    const crossVerification = crossVerifyProduct({ identification, profile });

    const verified = applyCrossVerifiedProfile(profile, crossVerification);

    expect(profile.brand).toBe("삼정크린마스터(주)"); // 원본은 그대로 보존된다
    expect(verified.brand).toBeNull();
  });

  it("brand/model 외의 필드는 그대로 보존한다", () => {
    const identification = identifyProduct({ ocrText: null });
    const crossVerification = crossVerifyProduct({ identification, profile });

    const verified = applyCrossVerifiedProfile(profile, crossVerification);

    expect(verified.productName).toBe(profile.productName);
    expect(verified.material).toBe(profile.material);
  });
});

describe("crossVerifyProduct — 공식 정보(T1-22)는 아직 없지만 자리는 열려 있다", () => {
  it("공식 정보가 없으면 비교에서 빠진다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const result = crossVerifyProduct({ identification, profile: null });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.observations).toHaveLength(1);
  });

  it("공식 정보가 주어지고 다른 출처와 다르면 충돌로 잡힌다", () => {
    const identification = identifyProduct({ ocrText: "제조 및 판매원 삼정크린마스터(주)" });
    const result = crossVerifyProduct({
      identification,
      profile: null,
      officialInfo: { brand: "다른회사", source: "https://example-official.co.kr" },
    });

    const brand = result.fields.find((f) => f.field === "brand");
    expect(brand?.status).toBe("conflict");
    expect(brand?.observations.map((o) => o.source)).toContain(
      "공식 정보(https://example-official.co.kr)",
    );
  });
});
