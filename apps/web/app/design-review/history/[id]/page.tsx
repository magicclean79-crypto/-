import type { Metadata } from "next";
import Link from "next/link";
import { DesignReviewDetail } from "./design-review-detail";

export const metadata: Metadata = {
  title: "디자인 리뷰 상세 | AI Product Content OS",
};

export default async function DesignReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/design-review/history"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 디자인 리뷰 이력
        </Link>
      </div>
      <DesignReviewDetail id={id} />
    </main>
  );
}
