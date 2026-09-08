import { ICONS, iconMarkup } from "./product-page-icons";

describe("product-page-icons", () => {
  it("모든 아이콘은 외부 네트워크 없이 그대로 렌더링되는 인라인 SVG다", () => {
    for (const svg of Object.values(ICONS)) {
      expect(svg).toContain("<svg");
      expect(svg).not.toContain("http://");
      expect(svg).not.toContain("https://");
    }
  });

  it("iconMarkup은 'none'이면 빈 문자열을 반환한다 — 장식용 아이콘을 만들어내지 않는다", () => {
    expect(iconMarkup("none")).toBe("");
  });

  it("iconMarkup은 실제 아이콘 id면 해당 SVG를 반환한다", () => {
    expect(iconMarkup("check")).toBe(ICONS.check);
  });
});
