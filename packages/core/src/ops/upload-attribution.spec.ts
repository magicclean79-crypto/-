import { checkUploadProject, resolveImageProject } from "./upload-attribution";

describe("resolveImageProject (TASK-4501, 정책 4501-②)", () => {
  it("상품에 붙어 있으면 그 프로젝트로 귀속한다", () => {
    const result = resolveImageProject({
      productProjectId: "prj_a",
      imageProjectId: null,
    });
    expect(result).toMatchObject({ projectId: "prj_a", source: "product" });
  });

  /**
   * 이것이 이번 정책의 핵심이다 — 상품에 붙기 전에 돌린 OCR의 비용이
   * 지금까지 전부 미귀속으로 떨어졌다.
   */
  it("상품에 안 붙었어도 업로드 때 밝힌 소속을 쓴다", () => {
    const result = resolveImageProject({
      productProjectId: null,
      imageProjectId: "prj_b",
    });
    expect(result).toMatchObject({ projectId: "prj_b", source: "upload" });
  });

  /**
   * 같은 사실에 두 개의 답이 생기면 둘 다 못 믿는다 — 그래서 어느 쪽을
   * 썼는지와 무엇이 달랐는지를 함께 말한다.
   */
  it("둘이 다르면 상품을 쓰되 다르다는 사실을 남긴다", () => {
    const result = resolveImageProject({
      productProjectId: "prj_a",
      imageProjectId: "prj_b",
    });
    expect(result.projectId).toBe("prj_a");
    expect(result.source).toBe("conflict");
    expect(result.detail).toContain("prj_a");
    expect(result.detail).toContain("prj_b");
  });

  it("둘 다 같으면 다툼이 아니다", () => {
    const result = resolveImageProject({
      productProjectId: "prj_a",
      imageProjectId: "prj_a",
    });
    expect(result.source).toBe("product");
  });

  /**
   * 배분할 수 없는 것을 배분하면 그 숫자는 만들어낸 것이다.
   */
  it("아무것도 모르면 null이다 — 공용으로 떠넘기지 않는다", () => {
    const result = resolveImageProject({
      productProjectId: null,
      imageProjectId: null,
    });
    expect(result.projectId).toBeNull();
    expect(result.source).toBe("unknown");
    expect(result.detail).toContain("만들어낸 것");
  });

  it("빈 문자열은 값이 아니다", () => {
    const result = resolveImageProject({
      productProjectId: "   ",
      imageProjectId: "",
    });
    expect(result.source).toBe("unknown");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const input of [
      { productProjectId: "prj_a", imageProjectId: "prj_b" },
      { productProjectId: null, imageProjectId: null },
      { productProjectId: null, imageProjectId: "prj_b" },
    ]) {
      expect(resolveImageProject(input).detail).not.toContain("**");
    }
  });
});

describe("checkUploadProject (TASK-4501, 정책 4501-②)", () => {
  const known = new Set(["clx0000000000000000000001"]);

  it("밝히지 않은 것은 잘못이 아니다", () => {
    expect(checkUploadProject(undefined, known).verdict).toBe("absent");
    expect(checkUploadProject("  ", known).verdict).toBe("absent");
  });

  it("존재하는 프로젝트는 받는다", () => {
    const result = checkUploadProject("clx0000000000000000000001", known);
    expect(result).toMatchObject({
      verdict: "accepted",
      projectId: "clx0000000000000000000001",
    });
  });

  /**
   * 조용히 버리면 사용자는 소속을 밝혔다고 믿는데 기록은 미귀속이다 —
   * 그 차이는 몇 주 뒤 비용 보고에서야 드러난다.
   */
  it("없는 프로젝트는 거부한다 — 조용히 버리지 않는다", () => {
    const result = checkUploadProject("clx0000000000000000000009", known);
    expect(result.verdict).toBe("unknown-project");
    expect(result.projectId).toBeNull();
    expect(result.detail).toContain("영영 귀속되지 않습니다");
  });

  it("id 모양이 아니면 거부한다", () => {
    expect(checkUploadProject("우리 프로젝트", known).verdict).toBe("malformed");
    expect(checkUploadProject("short", known).verdict).toBe("malformed");
  });
});
