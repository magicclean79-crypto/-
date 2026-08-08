import type { Metadata } from "next";
import Link from "next/link";
import { ProductProfileFlow } from "./product-profile-flow";

export const metadata: Metadata = {
  title: "Product Detail Engine | AI Product Content OS",
};

export default function ProductProfilePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">
            Product Detail Engine
          </h1>
          <Link
            href="/product-profile/history"
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            생성 이력 보기
          </Link>
        </div>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          사진만 넣으면 OCR·이미지 분석·제품 정보 통합을 거쳐 바로
          미리보고 다운로드할 수 있는 상세페이지 HTML까지 만듭니다. 실
          OCR·실 OpenAI만 사용합니다 — mock·가짜 응답은 없습니다.
        </p>
      </div>
      <ProductProfileFlow />
    </main>
  );
}
