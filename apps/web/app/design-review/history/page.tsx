import type { Metadata } from "next";
import Link from "next/link";
import { DesignReviewHistoryList } from "./history-list";

export const metadata: Metadata = {
  title: "디자인 리뷰 이력 | AI Product Content OS",
};

export default function DesignReviewHistoryPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/design-review"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 디자인 리뷰
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">디자인 리뷰 이력</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          같은 스크린샷을 다른 Provider로 평가한 결과를 골라 나란히 비교할 수 있습니다 —
          예: 같은 화면의 Claude 결과와 Gemini 결과.
        </p>
      </div>
      <DesignReviewHistoryList />
    </main>
  );
}
