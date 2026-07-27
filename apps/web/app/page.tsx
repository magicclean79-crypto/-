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
        <Link
          href="/upload"
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          📸 상품 사진 업로드
        </Link>
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
