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
