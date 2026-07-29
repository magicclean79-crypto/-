import Link from "next/link";
import { APP_NAME } from "@acos/shared";
import { Card } from "@acos/ui";
import { ApiStatus } from "./api-status";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          AI 기반 제품 콘텐츠 운영 시스템 — pnpm + Turborepo Monorepo
        </p>
        <div className="mt-4 flex gap-3">
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            📸 상품 사진 업로드
          </Link>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🗂️ 프로젝트
          </Link>
          <Link
            href="/products"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            📦 상품 목록
          </Link>
          <Link
            href="/executions"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            📊 실행 대시보드
          </Link>
          <Link
            href="/providers"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🔌 Provider 현황
          </Link>
          <Link
            href="/routing"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🔀 Routing 현황
          </Link>
          <Link
            href="/experiments"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🧪 Experiment 현황
          </Link>
          <Link
            href="/admin/console"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ⚙️ Provider 관리 콘솔
          </Link>
          <Link
            href="/admin/health"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🩺 배포 준비 상태
          </Link>
          <Link
            href="/admin/production"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            📡 Provider 운영 점검
          </Link>
          <Link
            href="/admin/operations"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🛟 운영 대시보드
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🔐 로그인
          </Link>
          <Link
            href="/admin/users"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            👥 사용자 관리
          </Link>
          <Link
            href="/account"
            className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            🔑 내 계정
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Web (Next.js)">
          Next.js + TypeScript + Tailwind CSS로 구성된 프론트엔드입니다.
        </Card>
        <Card title="API (NestJS)">
          <ApiStatus />
        </Card>
        <Card title="Packages">
          @acos/core · @acos/shared · @acos/agents · @acos/ui
        </Card>
        <Card title="Infrastructure">
          PostgreSQL · Redis · MinIO (docker compose up -d)
        </Card>
      </div>
    </main>
  );
}
