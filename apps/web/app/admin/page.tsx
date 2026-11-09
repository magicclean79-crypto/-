import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "관리자 | AI Product Content OS",
};

type AdminLink = {
  href: string;
  emoji: string;
  label: string;
};

type AdminGroup = {
  title: string;
  desc: string;
  links: AdminLink[];
};

const ADMIN_GROUPS: AdminGroup[] = [
  {
    title: "운영 현황 (읽기 전용)",
    desc: "실행·Provider·Routing·실험 현황을 조회합니다.",
    links: [
      { href: "/executions", emoji: "📊", label: "실행 대시보드" },
      { href: "/providers", emoji: "🔌", label: "Provider 현황" },
      { href: "/routing", emoji: "🔀", label: "Routing 현황" },
      { href: "/experiments", emoji: "🧪", label: "Experiment 현황" },
    ],
  },
  {
    title: "Provider / 비용 관리",
    desc: "ADMIN 권한이 필요한 설정 변경 화면입니다.",
    links: [
      { href: "/admin/console", emoji: "⚙️", label: "Provider 관리 콘솔" },
      { href: "/admin/production", emoji: "📡", label: "Provider 운영 점검" },
      { href: "/admin/costs", emoji: "💵", label: "AI 비용 관리" },
    ],
  },
  {
    title: "운영 준비 · 체크리스트",
    desc: "배포·활성화·Go-Live 진행 상태를 확인합니다.",
    links: [
      { href: "/admin/health", emoji: "🩺", label: "배포 준비 상태" },
      { href: "/admin/activation", emoji: "🚦", label: "운영 활성화" },
      { href: "/admin/readiness", emoji: "✅", label: "운영 준비 상태" },
      { href: "/admin/runbook", emoji: "📖", label: "운영 활성화 런북" },
      { href: "/admin/go-live", emoji: "🏁", label: "Go-Live 체크리스트" },
      { href: "/admin/overview", emoji: "🧭", label: "통합 운영 상태" },
      { href: "/admin/operations", emoji: "🛟", label: "운영 대시보드" },
      { href: "/admin/jobs", emoji: "🧵", label: "작업 현황" },
      { href: "/admin/kpi", emoji: "📊", label: "운영 KPI" },
    ],
  },
  {
    title: "계정 관리",
    desc: "ADMIN 권한이 필요합니다.",
    links: [{ href: "/admin/users", emoji: "👥", label: "사용자 관리" }],
  },
  {
    title: "QA / 회귀 테스트",
    desc: "고정 Benchmark 제품으로 변경 전후를 비교합니다.",
    links: [
      { href: "/benchmark", emoji: "🎯", label: "Benchmark Product" },
      { href: "/benchmark/templates", emoji: "🧱", label: "Template A~E 비교" },
    ],
  },
];

export default function AdminIndexPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">관리자</h1>
        <p className="mt-1 text-sm text-zinc-500">
          운영·진단·실험 등 내부 운영 화면 모음입니다. 설정을 바꾸는 화면은
          ADMIN 권한 로그인이 필요하며, 권한이 없으면 각 화면에서 접근이
          제한됩니다.
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {ADMIN_GROUPS.map((group) => (
          <section
            key={group.title}
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">{group.title}</h2>
            <p className="mt-1 text-xs text-zinc-500">{group.desc}</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {group.links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  {link.emoji} {link.label}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
