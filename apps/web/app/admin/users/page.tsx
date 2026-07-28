"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { USER_ROLES } from "@acos/shared";
import type { UserAuditLogDto, UserDto, UserRole } from "@acos/shared";
import { authHeaders, getAuthToken } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 사용자 관리 UI (TASK-0802, ADMIN 전용) —
 * User List · User Create · Role Change · User Disable · 감사 로그.
 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [audit, setAudit] = useState<UserAuditLogDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "VIEWER" as UserRole,
  });
  // 비밀번호 재설정 (TASK-0803) — 행별 인라인 입력
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetValue, setResetValue] = useState("");

  const load = useCallback(async () => {
    if (!getAuthToken()) {
      setError("로그인이 필요합니다.");
      return;
    }
    try {
      const [usersRes, auditRes] = await Promise.all([
        fetch(`${API_URL}/auth/users`, { headers: authHeaders() }),
        fetch(`${API_URL}/auth/audit`, { headers: authHeaders() }),
      ]);
      if (!usersRes.ok) {
        const data = (await usersRes.json()) as { message?: string };
        setError(data.message ?? `조회 실패 (HTTP ${usersRes.status})`);
        return;
      }
      setError(null);
      setUsers(((await usersRes.json()) as { users: UserDto[] }).users);
      if (auditRes.ok) {
        setAudit(
          ((await auditRes.json()) as { audit: UserAuditLogDto[] }).audit,
        );
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`${API_URL}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = (await response.json()) as { message?: string };
        setActionError(data.message ?? `실패 (HTTP ${response.status})`);
      }
    } catch {
      setActionError("API 서버에 연결할 수 없습니다.");
    }
    setBusy(false);
    await load();
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault();
    await mutate("/auth/users", "POST", form);
    setForm({ email: "", name: "", password: "", role: "VIEWER" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">사용자 관리</h1>
        <p className="mt-1 text-sm text-zinc-500">
          ADMIN 전용 — 사용자 생성·역할 변경·비활성화와 감사 로그
        </p>
      </div>

      {error ? (
        <div
          data-testid="admin-users-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}{" "}
          <Link href="/login" className="underline">
            로그인
          </Link>
        </div>
      ) : null}

      {users ? (
        <>
          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">사용자 ({users.length})</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="user-table">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="py-1 pr-3 font-medium">이메일</th>
                    <th className="py-1 pr-3 font-medium">이름</th>
                    <th className="py-1 pr-3 font-medium">역할</th>
                    <th className="py-1 pr-3 font-medium">상태</th>
                    <th className="py-1 pr-3 font-medium">작업</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr
                      key={user.id}
                      data-testid="user-row"
                      className="border-t border-zinc-100 dark:border-zinc-800"
                    >
                      <td className="py-1.5 pr-3 font-mono text-xs">
                        {user.email}
                      </td>
                      <td className="py-1.5 pr-3">{user.name}</td>
                      <td className="py-1.5 pr-3">
                        <select
                          aria-label={`${user.email} 역할`}
                          value={user.role}
                          disabled={busy}
                          onChange={(event) =>
                            void mutate(`/auth/users/${user.id}`, "PATCH", {
                              role: event.target.value as UserRole,
                            })
                          }
                          className="rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        {user.disabled ? (
                          <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                            비활성
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                            활성
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void mutate(`/auth/users/${user.id}`, "PATCH", {
                                disabled: !user.disabled,
                              })
                            }
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            {user.disabled ? "활성화" : "비활성화"}
                          </button>
                          {resetTarget === user.id ? (
                            <>
                              <input
                                type="password"
                                aria-label={`${user.email} 새 비밀번호`}
                                placeholder="새 비밀번호 (8자+)"
                                minLength={8}
                                value={resetValue}
                                onChange={(event) =>
                                  setResetValue(event.target.value)
                                }
                                className="w-32 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700"
                              />
                              <button
                                type="button"
                                disabled={busy || resetValue.length < 8}
                                onClick={async () => {
                                  await mutate(
                                    `/auth/users/${user.id}/password-reset`,
                                    "POST",
                                    { newPassword: resetValue },
                                  );
                                  setResetTarget(null);
                                  setResetValue("");
                                }}
                                className="rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
                              >
                                확인
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setResetTarget(user.id);
                                setResetValue("");
                              }}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              비밀번호 재설정
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {actionError ? (
              <p data-testid="admin-action-error" className="mt-2 text-xs text-red-600">
                {actionError}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">사용자 생성</h2>
            <form
              onSubmit={createUser}
              data-testid="user-create-form"
              className="mt-3 flex flex-wrap items-end gap-3 text-sm"
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">이메일</span>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(event) =>
                    setForm({ ...form, email: event.target.value })
                  }
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">이름</span>
                <input
                  required
                  value={form.name}
                  onChange={(event) =>
                    setForm({ ...form, name: event.target.value })
                  }
                  className="w-28 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">비밀번호 (8자+)</span>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(event) =>
                    setForm({ ...form, password: event.target.value })
                  }
                  className="w-36 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-zinc-500">역할</span>
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm({ ...form, role: event.target.value as UserRole })
                  }
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 dark:border-zinc-700"
                >
                  {USER_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
              >
                생성
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">감사 로그 (최근 100건)</h2>
            {audit.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">기록이 없습니다.</p>
            ) : (
              <ul
                data-testid="user-audit-list"
                className="mt-2 flex flex-col gap-0.5 text-xs text-zinc-600 dark:text-zinc-400"
              >
                {audit.map((item) => (
                  <li key={item.id}>
                    {item.createdAt.slice(0, 19).replace("T", " ")} (UTC) —{" "}
                    <span className="font-medium">{item.action}</span> ·{" "}
                    {item.targetEmail}
                    {item.detail ? ` (${item.detail})` : ""} · by {item.actor}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
