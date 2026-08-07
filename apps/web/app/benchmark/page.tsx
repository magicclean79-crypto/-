import type { Metadata } from "next";
import Link from "next/link";
import { BenchmarkView } from "./benchmark-view";
import { BENCHMARK_PRODUCT_NAME } from "./constants";

export const metadata: Metadata = {
  title: "Benchmark Product | AI Product Content OS",
};

export default function BenchmarkPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← 홈으로
        </Link>
        <div className="mt-2 flex items-center justify-between gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Benchmark Product</h1>
          <Link
            href="/benchmark/templates"
            className="shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            생활용품 Template A~E 비교
          </Link>
        </div>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          기준 제품: <strong>{BENCHMARK_PRODUCT_NAME}</strong>. 이 사진은 삭제·변경하지 않고,
          모든 기능/Prompt/Template/디자인 변경마다 항상 이 사진으로 먼저 회귀 테스트합니다.
          "개선되었습니다"는 사람이 직접 화면을 보고 승인했을 때만 인정합니다 — AI 참고
          점수는 보조 신호일 뿐입니다.
        </p>
      </div>
      <BenchmarkView />
    </main>
  );
}
