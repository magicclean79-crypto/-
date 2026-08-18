import { NextResponse } from "next/server";
import { rewriteEmbeddedImageAssetUrls } from "@acos/core";

/**
 * `/product-profile/[id]/final-html` — Chrome에서 직접 여는 최종
 * 상세페이지 브라우저 미리보기 (T1-158).
 *
 * 왜 이 라우트가 필요한가: API의 `GET /product-profile/:id/final-html`
 * (`apps/api`, `product-profile.controller.ts`)은 다운로드용
 * 자기완결(self-contained) HTML을 만들려고 실제 제품 이미지를 전부
 * Base64로 인라인한다 — 벤치마크 제품 기준 실측 90MB(과거 최대
 * 167MB, T1-157). 이 문서를 브라우저가 직접 열면 응답 자체가 거대해
 * 렌더링이 느리거나 멈춘 것처럼 보인다(사용자 보고, T1-157 확인).
 *
 * 어떻게 줄였는가: 렌더링 로직(`packages/core`의 Product Story
 * 렌더러, 지금 이 순간 T1-155가 동시에 수정 중이라 직접 손대지
 * 않았다)을 다시 구현하지 않고, API가 만든 완전한 HTML을 서버(Next.js
 * Route Handler, 브라우저가 아니라 이 서버가 API를 호출한다)에서 그대로
 * 받은 뒤 `rewriteEmbeddedImageAssetUrls()`(신규,
 * `packages/core/src/product-profile/product-story-final-html-assets.ts`)
 * 로 실제 제품 이미지의 `data:...;base64,...`만 이미 존재하는
 * `GET /uploads/images/:id/file` asset URL로 되돌린다. 브라우저는 이
 * 줄어든 HTML만 받고, `<img>` 태그가 그 URL로 이미지를 각자 따로
 * 불러온다 — 다운로드용 API `/final-html`은 자기완결 문서 그대로
 * 유지된다(요청 사양 1).
 */

export const dynamic = "force-dynamic";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}/product-profile/${encodeURIComponent(id)}/final-html`, {
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { message: `API 서버(${API_URL})에 연결할 수 없습니다.` },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => "");
    return new NextResponse(body || `상세페이지를 불러오지 못했습니다 (HTTP ${upstream.status}).`, {
      status: upstream.status,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const originalHtml = await upstream.text();
  const { html } = rewriteEmbeddedImageAssetUrls(
    originalHtml,
    (imageId) => `${API_URL}/uploads/images/${imageId}/file`,
  );

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
