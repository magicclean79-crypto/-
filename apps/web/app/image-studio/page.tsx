import type { Metadata } from "next";
import Link from "next/link";
import { ImageStudioView } from "./image-studio-view";

export const metadata: Metadata = {
  title: "이미지 스튜디오 | AI Product Content OS",
};

export default function ImageStudioPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">이미지 스튜디오</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {/* T1-150 — Provider를 코드에서 교체 가능하게 만들었다(OpenAI GPT
              Image 2 / Gemini). 화면 문구는 특정 Provider 이름을 박아 두지
              않는다 — 실제로 어떤 Provider/모델이 만들었는지는 각 이미지
              카드의 "Provider"·"Model" 항목(generationMetadata)에서 그대로
              보인다. */}
          AI가 배경 제거 → 배경 생성 → 제품 합성까지 실제로 수행합니다(실 API 호출,
          mock 아님). 결과는 사람이 브라우저에서 직접 보고 판단합니다 — AI가 최종 승인을
          하지 않습니다.
        </p>
      </div>
      <ImageStudioView />
    </main>
  );
}
