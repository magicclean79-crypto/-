import { rewriteEmbeddedImageAssetUrls } from "./product-story-final-html-assets";

describe("rewriteEmbeddedImageAssetUrls", () => {
  it("replaces the data URI in both the zoom-link href and the img src for an asset with data-asset-id", () => {
    const html =
      '<a href="data:image/png;base64,AAAA" target="_blank">' +
      '<img src="data:image/png;base64,AAAA" alt="" data-asset-id="img-1" data-asset-category="HERO"></a>';

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.html).toBe(
      '<a href="/uploads/images/img-1/file" target="_blank">' +
        '<img src="/uploads/images/img-1/file" alt="" data-asset-id="img-1" data-asset-category="HERO"></a>',
    );
    expect(result.replacedAssetCount).toBe(1);
    expect(result.remainingInlineCount).toBe(0);
  });

  it("leaves inline data URIs without a data-asset-id untouched (icons/auxiliary visuals)", () => {
    const html = '<img src="data:image/png;base64,BBBB" alt="" data-icon-source="gemini-generative-design">';

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.html).toBe(html);
    expect(result.replacedAssetCount).toBe(0);
    expect(result.remainingInlineCount).toBe(1);
  });

  it("replaces every occurrence of the same asset across multiple gallery entries", () => {
    const html =
      '<img src="data:image/jpeg;base64,CCCC" data-asset-id="img-2">' +
      '<img src="data:image/jpeg;base64,CCCC" data-asset-id="img-2">';

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.html).toBe(
      '<img src="/uploads/images/img-2/file" data-asset-id="img-2">' +
        '<img src="/uploads/images/img-2/file" data-asset-id="img-2">',
    );
    expect(result.replacedAssetCount).toBe(1);
  });

  it("leaves synthetic crop asset ids (id::crop-N) inline — they are not persisted Image rows and /uploads/images/:id/file 404s for them", () => {
    const html = '<img src="data:image/jpeg;base64,DDDD" data-asset-id="cmskd3e590006ulpwmcosfdsq::crop-1">';

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.html).toBe(html);
    expect(result.replacedAssetCount).toBe(0);
    expect(result.remainingInlineCount).toBe(1);
  });

  it("does not touch img tags that already reference a non-data src", () => {
    const html = '<img src="/uploads/images/img-3/file" data-asset-id="img-3">';

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.html).toBe(html);
    expect(result.replacedAssetCount).toBe(0);
    expect(result.remainingInlineCount).toBe(0);
  });

  it("reports byte sizes before/after so callers can confirm the payload actually shrank", () => {
    const bigBase64 = "A".repeat(1000);
    const html = `<img src="data:image/png;base64,${bigBase64}" data-asset-id="img-4">`;

    const result = rewriteEmbeddedImageAssetUrls(html, (id) => `/uploads/images/${id}/file`);

    expect(result.originalBytes).toBeGreaterThan(result.resultBytes);
  });
});
