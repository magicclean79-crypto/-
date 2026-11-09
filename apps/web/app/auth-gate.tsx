"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { APP_NAME } from "@acos/shared";
import { AUTH_USER_KEY } from "../lib/auth-client";

type GateStatus = "checking" | "authed" | "guest";

/**
 * 루트("/") 진입 인증 게이트 (T1-212, T1-215에서 선택 화면으로 확장).
 *
 * 기존 인증 방식(로그인 시 `AUTH_USER_KEY`를 localStorage에 저장하는
 * 방식, `login/page.tsx`)을 그대로 재사용한다 — 새 인증 채널을 만들지
 * 않는다. 서버 미들웨어로 만들지 않은 이유: 이 저장소의 다른 화면들
 * (`/admin/users`·`/projects/...` 등)은 이미 "비로그인이면 화면 자체는
 * 열리고 그 안에서 401 안내를 보여준다"는 방식으로 구현·테스트돼 있다
 * (`e2e/admin-users.spec.ts`·`e2e/auth.spec.ts`). 서버 리다이렉트를 앱
 * 전체에 걸면 그 기존 동작·테스트가 깨진다. 이 게이트는 "정식 도메인
 * 루트"(요청 범위)에만 적용한다.
 *
 * T1-212는 비로그인 시 `/login`으로 즉시 리다이렉트했다. T1-215는 루트에서
 * 로그인/회원가입을 **선택**할 수 있어야 한다는 요청에 맞춰, 자동
 * 리다이렉트 대신 이 화면 안에서 두 선택지를 보여주는 것으로 바꿨다.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<GateStatus>("checking");

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_USER_KEY);
    setStatus(stored ? "authed" : "guest");
  }, []);

  if (status === "checking") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <p className="text-sm text-zinc-500">확인 중…</p>
      </main>
    );
  }

  if (status === "guest") {
    const next = encodeURIComponent(pathname || "/");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">{APP_NAME}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            계속하려면 로그인하거나 계정을 만들어 주세요.
          </p>
        </div>
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Link
            href={`/login?next=${next}`}
            data-testid="gate-login-link"
            className="rounded-lg bg-blue-600 px-4 py-2.5 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            로그인
          </Link>
          <Link
            href={`/signup?next=${next}`}
            data-testid="gate-signup-link"
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-center text-sm font-medium transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            회원가입
          </Link>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
