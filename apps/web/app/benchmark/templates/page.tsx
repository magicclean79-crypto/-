import type { Metadata } from "next";
import Link from "next/link";
import { TemplatesView } from "./templates-view";

export const metadata: Metadata = {
  title: "생활용품 Template A~E 비교 | AI Product Content OS",
};

export default function BenchmarkTemplatesPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/benchmark" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← Benchmark Product
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">생활용품 Template A~E 비교</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          생활용품 디자인 원리(<code>reports/LIVING_GOODS_DESIGN_PRINCIPLES.md</code>)만으로
          공식 Benchmark 제품(분사기)의 상세페이지를 5개의 서로 다른 구성으로 생성했습니다.
          각 카드를 직접 보고 장단점을 검토해 승인·수정 요청해 주세요 — AI 참고 점수는
          보조 신호일 뿐이며, 최종 판단은 사람이 합니다.
        </p>
      </div>
      <TemplatesView />
    </main>
  );
}
