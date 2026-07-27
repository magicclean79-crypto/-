import type { Metadata } from "next";
import Link from "next/link";
import { Uploader } from "./uploader";

export const metadata: Metadata = {
  title: "상품 사진 업로드 | AI Product Content OS",
};

export default function UploadPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          상품 사진 업로드
        </h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          업로드된 사진은 MinIO에 저장되고 이미지 URL이 반환됩니다.
        </p>
      </div>
      <Uploader />
    </main>
  );
}
