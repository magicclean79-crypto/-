import type { DesignReviewDto } from "@acos/shared";
import { authFetchInit } from "./auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** html2canvas는 실제 DOM에 렌더된 요소만 캡처할 수 있다. 화면 밖(고정폭)
 * iframe에 HTML+CSS만 따로 주입해서 렌더한 뒤 캡처하고 즉시 제거한다 —
 * 부모 페이지의 Tailwind 전역 스타일(oklch/lab 등 html2canvas가 파싱하지
 * 못하는 최신 CSS color 함수)이 섞여 들어가지 않도록 완전히 격리한다.
 * (Benchmark Product V6 실측 버그 수정, Sprint 36 — /benchmark와
 * /benchmark/templates가 이 로직을 공유한다.) */
export async function captureHtmlAsPng(html: string, css: string): Promise<Blob> {
  const html2canvas = (await import("html2canvas")).default;
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "0";
  iframe.style.left = "-9999px";
  iframe.style.width = "800px";
  iframe.style.height = "1px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);
  try {
    const doc = iframe.contentDocument;
    if (!doc) throw new Error("캡처용 iframe을 초기화할 수 없습니다.");
    doc.open();
    doc.write(
      `<!doctype html><html><head><style>body{margin:0;background:#fff;}${css}</style></head><body>${html}</body></html>`,
    );
    doc.close();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const bodyHeight = Math.max(doc.body.scrollHeight, 600);
    iframe.style.height = `${bodyHeight}px`;
    const canvas = await html2canvas(doc.body, { width: 800, useCORS: true });
    const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("캡처한 화면을 이미지로 변환할 수 없습니다.");
    return blob;
  } finally {
    document.body.removeChild(iframe);
  }
}

export async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
  const formData = new FormData();
  formData.append("files", new File([blob], fileName, { type: "image/png" }));
  const response = await fetch(
    `${API_URL}/uploads/images`,
    authFetchInit({ method: "POST", body: formData }),
  );
  const body = (await response.json()) as { images?: { id: string }[]; message?: string | string[] };
  if (!response.ok || !body.images?.[0]) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `스크린샷 업로드 실패 (HTTP ${response.status})`);
  }
  return body.images[0].id;
}

/** HTML+CSS를 캡처 → 업로드 → design-review 호출까지 한 번에 수행한다 */
export async function captureAndReview(options: {
  html: string;
  css: string;
  fileName: string;
  category: string;
  notes?: string;
  productProfileId?: string;
  provider?: string;
}): Promise<DesignReviewDto> {
  const blob = await captureHtmlAsPng(options.html, options.css);
  const imageId = await uploadBlob(blob, options.fileName);
  const response = await fetch(
    `${API_URL}/design-review`,
    authFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        imageIds: [imageId],
        category: options.category,
        notes: options.notes,
        productProfileId: options.productProfileId,
        provider: options.provider,
      }),
    }),
  );
  const body = (await response.json()) as DesignReviewDto & { message?: string | string[] };
  if (!response.ok) {
    const message = Array.isArray(body.message) ? body.message.join(", ") : body.message;
    throw new Error(message ?? `디자인 리뷰 실행 실패 (HTTP ${response.status})`);
  }
  return body;
}
