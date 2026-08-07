import type { Metadata } from "next";
import Link from "next/link";
import { DesignReviewFlow } from "./design-review-flow";

export const metadata: Metadata = {
  title: "디자인 리뷰 | AI Product Content OS",
};

export default function DesignReviewPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">디자인 리뷰 (AI 참고용)</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          상세페이지 스크린샷을 AI(OpenAI / Claude / Gemini 중 선택)가 레이아웃·타이포·
          여백·사진배치·구매유도력·모바일 UX를 평가합니다. 실 LLM 호출만 사용합니다 —
          mock·가짜 응답은 없습니다. 단, <strong>이 점수는 참고 신호일 뿐 최종 승인
          기준이 아닙니다</strong> — 최종 디자인 평가는 사람이 직접 화면을 보고 합니다.
        </p>
      </div>
      <DesignReviewFlow />
    </main>
  );
}
