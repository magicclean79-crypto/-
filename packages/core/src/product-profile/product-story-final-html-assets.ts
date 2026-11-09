/**
 * 최종 상세페이지 HTML(`wrapProductProfileHtmlDocument()`가 만든 완전한
 * 문서, `product-page-html.ts`)에 Base64로 인라인된 실제 제품 이미지를
 * asset URL 참조로 되돌린다 (T1-158).
 *
 * 왜 필요한가: `product-story-html.ts`의 `dataUri()`는 다운로드용
 * 자기완결(self-contained) HTML을 만들기 위해 이미지를
 * `data:image/...;base64,...`로 그대로 박아 넣는다(줌 링크 `<a href>`와
 * `<img src>` 양쪽에 같은 문자열이 두 번 들어간다). 그 결과 문서 하나가
 * 수십~수백MB가 되어 브라우저가 직접 열기에는 부적합하다(T1-157 실측
 * 90MB). 다운로드 파일(자기완결)과 브라우저 미리보기(가벼움)는 서로 다른
 * 요구라서, 렌더러 자체(`product-story-html.ts`)를 고치는 대신 —
 * 그 파일은 이 작업과 동시에 다른 작업이 수정 중이라 충돌 위험도
 * 크다 — 이미 만들어진 HTML 문자열에서 실제 이미지 자산만 후처리로
 * 치환한다. 렌더링 로직을 다시 구현하지 않는다(순수 문자열 치환).
 *
 * 어떻게 짝을 찾는가: 렌더러가 이미 모든 `<img>` 태그에
 * `data-asset-id="<Image.id>"`를 남긴다(T1-144, "asset 매핑 정보를
 * DOM에 유지"). 그 속성이 있는 `<img src="data:...">`만 실제
 * `Image` 레코드로 조회 가능한 자산이므로, 같은 이미지가 `<a href>`에
 * 중복으로 들어가 있어도(같은 문자열이라 정확히 일치) 함께 치환된다.
 * 아이콘·보조 그래픽처럼 asset id가 없는 인라인 이미지는(DB 레코드가
 * 없어 URL로 대체할 수 없다) 그대로 둔다 — 대체로 개당 용량이 작고
 * 개수도 최대 2개로 제한돼 있다(`product-story-auxiliary-visual.ts`).
 *
 * **`data-asset-id`가 있어도 URL로 바꿀 수 없는 경우가 있다** — 실측으로
 * 발견(T1-158, 실제 Chromium으로 연 뒤 `naturalWidth === 0`인 깨진
 * 이미지 2장을 확인). `product-profile.service.ts`가 실제 업로드 사진의
 * crop(부분 확대)을 만들 때 `data-asset-id`를 `"<Image.id>::crop-1"`처럼
 * **합성 ID**로 붙인다 — 이 crop은 `sharp`로 그 자리에서 만든 바이트일
 * 뿐 `Image` 테이블에 저장되지 않으므로, `GET /uploads/images/:id/file`은
 * 그 ID를 절대 찾지 못한다(존재하지 않는 레코드로 항상 404). Prisma
 * `cuid()` ID는 `::`를 포함하지 않으므로, `::`가 있으면 이 함수가 만들 수
 * 없는 asset URL이라고 보고 **원본 base64를 그대로 남긴다** — 사진이 아예
 * 안 보이는 것보다 크더라도 보이는 쪽이 낫다(같은 원칙을 icon/보조
 * 그래픽에도 이미 쓰고 있다).
 */

const IMG_TAG_PATTERN = /<img\b[^>]*>/g;
const SRC_DATA_URI_PATTERN = /\bsrc="(data:[^"]*)"/;
const ASSET_ID_PATTERN = /\bdata-asset-id="([^"]*)"/;

/** `Image.id`(Prisma cuid)가 아니라 렌더 시점에만 존재하는 합성 ID(예: crop) */
function isSyntheticAssetId(assetId: string): boolean {
  return assetId.includes("::");
}

export interface RewriteEmbeddedImageAssetUrlsResult {
  /** asset URL로 치환된 뒤의 HTML 문서 */
  html: string;
  /** 실제로 치환된 서로 다른 이미지 자산 개수 */
  replacedAssetCount: number;
  /** 치환 대상을 찾지 못해(예: `data-asset-id` 없음) 그대로 남은 인라인 데이터 URI 개수 */
  remainingInlineCount: number;
  originalBytes: number;
  resultBytes: number;
}

/**
 * `<img>` 태그의 `data-asset-id`와 짝지어지는 `data:...;base64,...`
 * 문자열을 `assetUrl(imageId)`가 돌려주는 URL로 전부(같은 문자열이
 * 여러 번 나와도 전부) 치환한다. 순수 함수 — 네트워크·DB 접근 없음.
 */
export function rewriteEmbeddedImageAssetUrls(
  html: string,
  assetUrl: (imageId: string) => string,
): RewriteEmbeddedImageAssetUrlsResult {
  const dataUriToAssetId = new Map<string, string>();
  let remainingInlineCount = 0;

  for (const tagMatch of html.matchAll(IMG_TAG_PATTERN)) {
    const tag = tagMatch[0];
    const srcMatch = tag.match(SRC_DATA_URI_PATTERN);
    if (!srcMatch) continue;
    const assetIdMatch = tag.match(ASSET_ID_PATTERN);
    if (!assetIdMatch || !assetIdMatch[1] || isSyntheticAssetId(assetIdMatch[1])) {
      remainingInlineCount += 1;
      continue;
    }
    dataUriToAssetId.set(srcMatch[1], assetIdMatch[1]);
  }

  let result = html;
  let replacedAssetCount = 0;
  for (const [dataUri, imageId] of dataUriToAssetId) {
    if (!result.includes(dataUri)) continue;
    result = result.split(dataUri).join(assetUrl(imageId));
    replacedAssetCount += 1;
  }

  return {
    html: result,
    replacedAssetCount,
    remainingInlineCount,
    originalBytes: Buffer.byteLength(html, "utf8"),
    resultBytes: Buffer.byteLength(result, "utf8"),
  };
}
