import type { Metadata } from "next";
import Link from "next/link";
import { HistoryList } from "./history-list";

export const metadata: Metadata = {
  title: "생성 이력 | AI Product Content OS",
};

export default function ProductProfileHistoryPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/product-profile"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← Product Detail Engine
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">생성 이력</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          지금까지 생성한 모든 Product Profile을 여기서 다시 열어볼 수
          있습니다. 같은 사진으로 다시 생성하거나, 이전 결과와 나란히
          비교할 수 있습니다.
        </p>
      </div>
      <HistoryList />
    </main>
  );
}
