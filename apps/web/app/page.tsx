import Link from "next/link";
import { APP_NAME } from "@acos/shared";
import { Card } from "@acos/ui";
import { ApiStatus } from "./api-status";
import { AuthGate } from "./auth-gate";

const CORE_FLOW = [
  {
    step: "STEP 1",
    href: "/upload",
    emoji: "📸",
    title: "상품 사진 업로드",
    desc: "상품 사진을 올리면 파이프라인이 시작됩니다.",
  },
  {
    step: "STEP 2",
    href: "/product-profile",
    emoji: "🧬",
    title: "제품 분석",
    desc: "OCR·Vision으로 실제 제품 정보를 확인·정정합니다.",
  },
  {
    step: "STEP 3",
    href: "/image-studio",
    emoji: "🖼️",
    title: "상세페이지 생성",
    desc: "AI가 만든 이미지를 보고 상세페이지를 완성합니다.",
  },
];

const SECONDARY_LINKS = [
  { href: "/projects", emoji: "🗂️", label: "프로젝트" },
  { href: "/products", emoji: "📦", label: "상품 목록" },
  { href: "/design-review", emoji: "🎨", label: "디자인 리뷰" },
];

const ACCOUNT_LINKS = [
  { href: "/login", emoji: "🔐", label: "로그인" },
  { href: "/account", emoji: "🔑", label: "내 계정" },
];

export default function Home() {
  return (
    <AuthGate>
      <HomeScreen />
    </AuthGate>
  );
}

function HomeScreen() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-10 px-6 py-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          상품 사진 몇 장으로 판매용 상세페이지를 만드는 AI 콘텐츠 제작
          시스템입니다.
        </p>
      </div>

      <section aria-labelledby="core-flow-heading">
        <h2
          id="core-flow-heading"
          className="text-sm font-semibold text-zinc-500 dark:text-zinc-400"
        >
          상세페이지 만들기
        </h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {CORE_FLOW.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-blue-400 hover:bg-blue-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-700 dark:hover:bg-blue-950"
            >
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                {item.step}
              </span>
              <span className="text-lg font-semibold">
                {item.emoji} {item.title}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {item.desc}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="secondary-links-heading">
        <h2
          id="secondary-links-heading"
          className="text-sm font-semibold text-zinc-500 dark:text-zinc-400"
        >
          더 보기
        </h2>
        <div className="mt-3 flex flex-wrap gap-3">
          {SECONDARY_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {item.emoji} {item.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <div className="flex flex-wrap gap-4">
          {ACCOUNT_LINKS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              {item.emoji} {item.label}
            </Link>
          ))}
        </div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
        >
          ⚙️ 관리자
        </Link>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Web (Next.js)">
          Next.js + TypeScript + Tailwind CSS로 구성된 프론트엔드입니다.
        </Card>
        <Card title="API (NestJS)">
          <ApiStatus />
        </Card>
      </div>
    </main>
  );
}

