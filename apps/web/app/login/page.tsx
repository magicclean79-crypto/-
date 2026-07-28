"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { LoginResponseDto, UserDto } from "@acos/shared";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * Login UI (TASK-0801). 세션 토큰은 localStorage에 보관하고
 * 클라이언트 API 호출에 Authorization: Bearer로 첨부한다.
 */
export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserDto | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(AUTH_USER_KEY);
    if (stored) {
      try {
        setCurrentUser(JSON.parse(stored) as UserDto);
      } catch {
        localStorage.removeItem(AUTH_USER_KEY);
      }
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = (await response.json()) as LoginResponseDto & {
        message?: string;
      };
      if (!response.ok) {
        setError(data.message ?? `로그인 실패 (HTTP ${response.status})`);
        setBusy(false);
        return;
      }
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      router.push("/");
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
      setBusy(false);
    }
  }

  async function logout() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (token) {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined);
    }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    setCurrentUser(null);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">로그인</h1>
        <p className="mt-1 text-sm text-zinc-500">
          발행 파이프라인 등 보호된 작업에는 로그인이 필요합니다.
        </p>
      </div>

      {currentUser ? (
        <div
          data-testid="login-current-user"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900 dark:bg-emerald-950"
        >
          <p>
            <span className="font-medium">{currentUser.name}</span> (
            {currentUser.email}) — {currentUser.role}
          </p>
          <button
            type="button"
            onClick={logout}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-white dark:border-zinc-700"
          >
            로그아웃
          </button>
        </div>
      ) : null}

      <form
        onSubmit={submit}
        data-testid="login-form"
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">이메일</span>
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">비밀번호</span>
          <input
            type="password"
            name="password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "로그인 중…" : "로그인"}
        </button>
        {error ? (
          <p data-testid="login-error" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
