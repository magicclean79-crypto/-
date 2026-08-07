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
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Benchmark Product</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          기준 제품: <strong>{BENCHMARK_PRODUCT_NAME}</strong>. 이 사진은 삭제·변경하지 않고,
          모든 기능/Prompt/Template/디자인 변경마다 항상 이 사진으로 먼저 회귀 테스트합니다.
          "개선되었습니다"는 이 화면의 Benchmark Score가 실제로 올라갔을 때만 인정합니다.
        </p>
      </div>
      <BenchmarkView />
    </main>
  );
}
