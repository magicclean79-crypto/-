"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { UserDto } from "@acos/shared";
import {
  authFetchInit,
  AUTH_USER_KEY,
  getAuthToken,
} from "../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 내 계정 (TASK-0803) — 비밀번호 변경 셀프 서비스 (모든 역할).
 * 변경 성공 시 현재 세션만 유지되고 다른 기기 세션은 전부 로그아웃된다.
 */
export default function AccountPage() {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loggedOut, setLoggedOut] = useState(false);
  const [form, setForm] = useState({ current: "", next: "", confirm: "" });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getAuthToken()) {
      setLoggedOut(true);
      return;
    }
    const stored = localStorage.getItem(AUTH_USER_KEY);
    if (stored) {
      try {
        setUser(JSON.parse(stored) as UserDto);
      } catch {
        setUser(null);
      }
    }
  }, []);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (form.next !== form.confirm) {
      setError("새 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(
        `${API_URL}/auth/password`,
        authFetchInit({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: form.current,
            newPassword: form.next,
          }),
        }),
      );
      if (response.ok) {
        setSuccess(true);
        setForm({ current: "", next: "", confirm: "" });
      } else {
        const data = (await response.json()) as { message?: string };
        setError(data.message ?? `변경 실패 (HTTP ${response.status})`);
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">내 계정</h1>
        <p className="mt-1 text-sm text-zinc-500">
          비밀번호 변경 — 변경 시 다른 기기의 세션은 모두 로그아웃됩니다
        </p>
      </div>

      {loggedOut ? (
        <div
          data-testid="account-login-required"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300"
        >
          로그인이 필요합니다.{" "}
          <Link href="/login" className="underline">
            로그인
          </Link>
        </div>
      ) : (
        <>
          {user ? (
            <section className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
              <p>
                <span className="font-mono text-xs">{user.email}</span> ·{" "}
                {user.name} ·{" "}
                <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs dark:bg-zinc-800">
                  {user.role}
                </span>
              </p>
            </section>
          ) : null}

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">비밀번호 변경</h2>
            <form
              onSubmit={changePassword}
              data-testid="password-change-form"
              className="mt-3 flex flex-col gap-3 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">현재 비밀번호</span>
                <input
                  type="password"
                  required
                  value={form.current}
                  onChange={(event) =>
                    setForm({ ...form, current: event.target.value })
                  }
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">새 비밀번호 (8자+)</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.next}
                  onChange={(event) =>
                    setForm({ ...form, next: event.target.value })
                  }
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">새 비밀번호 확인</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.confirm}
                  onChange={(event) =>
                    setForm({ ...form, confirm: event.target.value })
                  }
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <button
                type="submit"
                disabled={busy}
                className="self-start rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                변경
              </button>
            </form>
            {error ? (
              <p data-testid="password-change-error" className="mt-2 text-xs text-red-600">
                {error}
              </p>
            ) : null}
            {success ? (
              <p
                data-testid="password-change-success"
                className="mt-2 text-xs text-emerald-700 dark:text-emerald-400"
              >
                비밀번호가 변경되었습니다. 다른 기기의 세션은 로그아웃되었습니다.
              </p>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}
