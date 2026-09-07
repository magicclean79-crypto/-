"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_NAME } from "@acos/shared";
import type { LoginResponseDto } from "@acos/shared";
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 회원가입 (T1-215) — `POST /auth/signup`으로 실제 계정을 만든다.
 * 생성된 계정은 항상 VIEWER 역할이다(관리자 권한은 이 화면으로 부여되지
 * 않는다 — `apps/api/src/auth/auth.service.ts`의 `signup()` 참고).
 * 성공하면 로그인과 동일하게 세션이 발급돼 바로 홈으로 이동한다.
 */
export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) {
      setNextPath(requested);
    }
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, password }),
        credentials: "include", // httpOnly 세션 쿠키 수신
      });
      const data = (await response.json()) as LoginResponseDto & {
        message?: string;
      };
      if (!response.ok) {
        setError(data.message ?? `가입 실패 (HTTP ${response.status})`);
        setBusy(false);
        return;
      }
      // 쿠키 전용 모드(운영)에서는 본문 토큰이 없다 — 쿠키만 사용
      if (data.token) {
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
      router.push(nextPath);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6 py-16">
      <div>
        <Link
          href="/login"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 로그인으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">회원가입</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {APP_NAME} 계정을 만듭니다. 생성된 계정은 조회 권한(VIEWER)으로
          시작하며, 편집 권한이 필요하면 관리자에게 요청해 주세요.
        </p>
      </div>

      <form
        onSubmit={submit}
        data-testid="signup-form"
        className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">이름</span>
          <input
            type="text"
            name="name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">이메일 (로그인 ID)</span>
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
          <span className="text-xs text-zinc-500">비밀번호 (8자 이상, 영문+숫자)</span>
          <input
            type="password"
            name="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">비밀번호 확인</span>
          <input
            type="password"
            name="confirm"
            required
            minLength={8}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="rounded-md border border-zinc-300 bg-transparent px-3 py-2 dark:border-zinc-700"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="mt-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "가입 처리 중…" : "회원가입"}
        </button>
        {error ? (
          <p data-testid="signup-error" className="text-xs text-red-600">
            {error}
          </p>
        ) : null}
      </form>

      <p className="text-center text-sm text-zinc-500">
        이미 계정이 있으신가요?{" "}
        <Link
          href="/login"
          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          로그인
        </Link>
      </p>
    </main>
  );
}
