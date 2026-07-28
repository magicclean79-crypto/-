"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  AdminAuditEntryDto,
  AdminConsoleDto,
  ResolvedSettingDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const SOURCE_LABEL: Record<ResolvedSettingDto["source"], string> = {
  override: "콘솔",
  env: "환경변수",
  default: "기본값",
};

const SOURCE_STYLE: Record<ResolvedSettingDto["source"], string> = {
  override:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  env: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  default: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
};

/** 값의 출처 배지 — "지금 무엇이 적용 중인지"를 한눈에 */
function SourceBadge({ setting }: { setting: ResolvedSettingDto }) {
  return (
    <span
      data-testid="setting-source"
      className={`rounded-full px-2 py-0.5 text-xs ${SOURCE_STYLE[setting.source]}`}
    >
      {SOURCE_LABEL[setting.source]}
    </span>
  );
}

/**
 * Provider Administration Console (TASK-1201) —
 * Provider Enable/Disable · Model · Budget · Experiment · Audit Log.
 *
 * 설정 원칙은 Code-first(환경변수)이고 콘솔은 그 위의 오버라이드다.
 * 해제하면 환경변수 값으로 되돌아간다.
 */
export default function AdminConsolePage() {
  const [data, setData] = useState<AdminConsoleDto | null>(null);
  const [audit, setAudit] = useState<AdminAuditEntryDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [consoleRes, auditRes] = await Promise.all([
        fetch(`${API_URL}/admin/console`, authFetchInit()),
        fetch(`${API_URL}/admin/audit`, authFetchInit()),
      ]);
      if (!consoleRes.ok) {
        setError(
          consoleRes.status === 401 || consoleRes.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `조회 실패 (HTTP ${consoleRes.status})`,
        );
        return;
      }
      setError(null);
      setData((await consoleRes.json()) as AdminConsoleDto);
      if (auditRes.ok) {
        setAudit((await auditRes.json()) as AdminAuditEntryDto[]);
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  /** 설정 변경/해제 — value가 null이면 환경변수로 복귀 */
  async function save(key: string, value: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch(
        `${API_URL}/admin/settings/${key}`,
        authFetchInit({
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value }),
        }),
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        setNotice(
          `변경 실패 (HTTP ${response.status}) — ${body?.message ?? "권한 또는 값을 확인해 주세요."}`,
        );
        return;
      }
      setNotice(
        value === null
          ? `${key} 오버라이드를 해제했습니다 (환경변수 값으로 복귀).`
          : `${key} = ${value} 로 변경했습니다.`,
      );
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      await load();
    } catch {
      setNotice("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 값 입력 + 적용/해제 버튼 한 줄 */
  function SettingRow({
    setting,
    placeholder,
  }: {
    setting: ResolvedSettingDto;
    placeholder?: string;
  }) {
    const draft = drafts[setting.key] ?? setting.value ?? "";
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          placeholder={placeholder ?? setting.fallback ?? "미설정"}
          onChange={(event) =>
            setDrafts((prev) => ({ ...prev, [setting.key]: event.target.value }))
          }
          className="w-56 rounded-lg border border-zinc-300 px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(setting.key, draft)}
          className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          적용
        </button>
        {setting.source === "override" ? (
          <button
            type="button"
            disabled={busy}
            data-testid="clear-override"
            onClick={() => void save(setting.key, null)}
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            해제
          </button>
        ) : null}
        <SourceBadge setting={setting} />
        {setting.env ? (
          <span className="font-mono text-xs text-zinc-500">{setting.env}</span>
        ) : null}
      </div>
    );
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
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          Provider 관리 콘솔
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Provider · 모델 · 예산 · 실험을 운영 중에 조정합니다 (ADMIN 전용).
          기본값은 환경변수이며, 해제하면 그 값으로 되돌아갑니다.
        </p>
      </div>

      {error ? (
        <div
          data-testid="console-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {notice ? (
        <div
          data-testid="console-notice"
          className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900"
        >
          {notice}
        </div>
      ) : null}

      {data ? (
        <>
          <section
            data-testid="provider-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">Provider 활성화</h2>
            <p className="mt-1 text-xs text-zinc-500">
              끈 Provider는 라우팅·실험·Failover 후보에서 빠집니다. 키가 없는
              Provider는 켜도 사용할 수 없습니다.
            </p>
            <div className="mt-3 space-y-2">
              {data.providers.map((provider) => (
                <div
                  key={provider.name}
                  data-testid="provider-row"
                  className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800"
                >
                  <span className="w-24 font-mono text-xs">{provider.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="provider-toggle"
                    onClick={() =>
                      void save(
                        provider.setting.key,
                        provider.enabled ? "false" : "true",
                      )
                    }
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                      provider.enabled
                        ? "border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950"
                        : "border-zinc-300 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {provider.enabled ? "활성" : "비활성"}
                  </button>
                  <span className="text-xs text-zinc-500">
                    키 {provider.keyConfigured ? "설정됨" : "없음"} · 후보{" "}
                    {provider.available ? "포함" : "제외"} · 기본 모델{" "}
                    <span className="font-mono">{provider.defaultModel}</span>
                  </span>
                  <SourceBadge setting={provider.setting} />
                </div>
              ))}
            </div>
          </section>

          <section
            data-testid="model-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">모델 관리</h2>
            <p className="mt-1 text-xs text-zinc-500">
              feature별 모델 지정 — 비우고 해제하면 Provider 기본 모델을
              사용합니다.
            </p>
            <div className="mt-3 space-y-3">
              {data.models.map((model) => (
                <div key={model.feature} data-testid="model-row">
                  <p className="text-xs font-medium">
                    <span className="font-mono">{model.feature}</span>
                    <span className="ml-2 text-zinc-500">
                      적용 중{" "}
                      <span className="font-mono">
                        {model.effective ?? "(Provider 기본)"}
                      </span>
                    </span>
                  </p>
                  <div className="mt-1">
                    <SettingRow setting={model.setting} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            data-testid="budget-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">예산 관리</h2>
            <p className="mt-1 text-xs text-zinc-500" data-testid="budget-status">
              일 ${data.budget.status.daily.spend.toFixed(4)} /{" "}
              {data.budget.status.daily.budget ?? "∞"} · 월 $
              {data.budget.status.monthly.spend.toFixed(4)} /{" "}
              {data.budget.status.monthly.budget ?? "∞"} · 경고 임계{" "}
              {(data.budget.status.alertRatio * 100).toFixed(0)}%
            </p>
            <div className="mt-3 space-y-3">
              {[
                { label: "일 예산 (USD)", setting: data.budget.daily },
                { label: "월 예산 (USD)", setting: data.budget.monthly },
                { label: "경고 임계 (0~1)", setting: data.budget.alertRatio },
              ].map((item) => (
                <div key={item.setting.key}>
                  <p className="text-xs font-medium">{item.label}</p>
                  <div className="mt-1">
                    <SettingRow setting={item.setting} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            data-testid="experiment-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">실험 관리</h2>
            <p className="mt-1 text-xs text-zinc-500">
              형식{" "}
              <span className="font-mono">이름|종류|변형=가중치,변형=가중치</span>{" "}
              — 정의를 바꾸면 고정 배정이 다시 정해지고 관측 기간이 초기화됩니다.
            </p>
            <div className="mt-3 space-y-3">
              {data.experiments.map((experiment) => (
                <div key={experiment.feature} data-testid="experiment-row">
                  <p className="font-mono text-xs font-medium">
                    {experiment.feature}
                  </p>
                  <div className="mt-1">
                    <SettingRow
                      setting={experiment.setting}
                      placeholder="openai=90,anthropic=10"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            data-testid="audit-section"
            className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <h2 className="text-sm font-semibold">변경 이력</h2>
            {audit.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500" data-testid="audit-empty">
                아직 콘솔에서 변경한 설정이 없습니다.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table
                  className="w-full text-left text-sm"
                  data-testid="audit-table"
                >
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">설정</th>
                      <th className="py-1 pr-3 font-medium">변경</th>
                      <th className="py-1 pr-3 font-medium">수행자</th>
                      <th className="py-1 pr-3 font-medium">시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr
                        key={entry.id}
                        data-testid="audit-row"
                        className="border-t border-zinc-100 dark:border-zinc-800"
                      >
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {entry.key}
                        </td>
                        <td className="py-1.5 pr-3 font-mono text-xs">
                          {entry.before ?? "(없음)"} →{" "}
                          {entry.after ?? "(환경변수)"}
                        </td>
                        <td className="py-1.5 pr-3 text-xs">
                          {entry.actor ?? "—"}
                        </td>
                        <td className="py-1.5 pr-3 text-xs text-zinc-500">
                          {new Date(entry.createdAt).toLocaleString("ko-KR")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
