import type { Metadata } from "next";
import Link from "next/link";
import { HistoryDetail } from "./history-detail";

export const metadata: Metadata = {
  title: "생성 결과 상세 | AI Product Content OS",
};

export default async function ProductProfileHistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/product-profile/history"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 생성 이력
        </Link>
      </div>
      <HistoryDetail id={id} />
    </main>
  );
}
