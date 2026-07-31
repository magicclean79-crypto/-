"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type {
  ActivationHistoryDto,
  IncidentBoardDto,
  ProductionActivationDto,
  SmokeReportDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 운영 활성화 대시보드. (TASK-3701, Sprint 37 — CTO 정책 3701-③)
 *
 * `/admin/production`이 **부품별 상태**를 보여 준다면, 이 화면은 하나의
 * 질문에 답합니다 — **"우리는 지금 운영인가, 그리고 어떻게 여기까지 왔나."**
 *
 * 그래서 네 가지를 한 화면에 둡니다:
 *
 * 1. **지금** — 세 조건(자격 증명·네트워크·전환 판정) 중 무엇이 남았는가
 * 2. **과정** — 언제부터 이 상태인지, 되던 것이 되돌아간 적이 있는지
 * 3. **증거** — 실제로 불러 본 결과(스모크). 스텁의 200은 통과가 아니다
 * 4. **장애** — 진행 중인 것과 복구된 것, 그리고 복구 방법
 *
 * 이 화면이 하지 않는 일: **좋아 보이게 만드는 것.** 셋 중 둘이 충족된
 * 상태는 게이지 3분의 2가 아니라 **여전히 전환되지 않은 상태**이고,
 * 화면은 그렇게 말합니다.
 */

const DURATION_UNITS: [number, string][] = [
  [24 * 60 * 60 * 1000, "일"],
  [60 * 60 * 1000, "시간"],
  [60 * 1000, "분"],
];

function duration(ms: number): string {
  if (ms < 60 * 1000) {
    return "1분 미만";
  }
  for (const [unit, label] of DURATION_UNITS) {
    if (ms >= unit) {
      return `${Math.floor(ms / unit)}${label}`;
    }
  }
  return "1분 미만";
}

const SMOKE_LABEL: Record<string, string> = {
  passed: "실제 호출 통과",
  failed: "실패",
  stubbed: "스텁 응답 — 통과 아님",
  skipped: "부르지 않음",
};

const SMOKE_STYLE: Record<string, string> = {
  passed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  // 스텁 성공을 초록으로 보여 주면 이 화면은 다시 거짓말을 한다
  stubbed: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  skipped: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  MAJOR: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  MINOR: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const COMPONENTS = [
  "llm",
  "ocr",
  "storage",
  "database",
  "queue",
  "web",
  "api",
  "other",
];

export default function ActivationDashboardPage() {
  const [activation, setActivation] = useState<ProductionActivationDto | null>(null);
  const [history, setHistory] = useState<ActivationHistoryDto | null>(null);
  const [smoke, setSmoke] = useState<SmokeReportDto | null>(null);
  const [incidents, setIncidents] = useState<IncidentBoardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const get = async <T,>(path: string): Promise<T | null> => {
        const response = await fetch(`${API_URL}${path}`, authFetchInit());
        return response.ok ? ((await response.json()) as T) : null;
      };
      const [next, log, probe, board] = await Promise.all([
        get<ProductionActivationDto>("/ops/activation"),
        get<ActivationHistoryDto>("/ops/activation/history"),
        get<SmokeReportDto>("/ops/smoke"),
        get<IncidentBoardDto>("/ops/incidents"),
      ]);
      setActivation(next);
      setHistory(log);
      setSmoke(probe);
      setIncidents(board);
      setError(next === null ? "활성화 판정을 읽지 못했습니다 (ADMIN 로그인이 필요합니다)." : null);
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 실 호출 스모크 — **돈이 나갑니다.** 그래서 눌러야만 돕니다 */
  async function runSmoke() {
    setSmokeRunning(true);
    setNotice(null);
    try {
      const response = await fetch(`${API_URL}/ops/smoke`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setNotice("스모크를 돌리지 못했습니다.");
        return;
      }
      const next = (await response.json()) as SmokeReportDto;
      setSmoke(next);
      setNotice(next.detail);
    } catch {
      setNotice("API 서버에 연결할 수 없습니다.");
    } finally {
      setSmokeRunning(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:underline dark:text-zinc-400"
        >
          ← 홈으로
        </Link>
        <h1 className="text-2xl font-semibold">운영 활성화 대시보드</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          지금 운영인가 · 어떻게 여기까지 왔나 · 실제로 불러 봤는가 · 무엇이
          무너졌었나. (TASK-3701, CTO 정책 3701-①②③④)
        </p>
      </header>

      {error ? (
        <p
          data-testid="activation-error"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-zinc-500">불러오는 중…</p> : null}

      {/* 1. 지금 — 세 조건 */}
      {activation ? (
        <section
          data-testid="activation-now"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-medium">지금</h2>
            <span
              data-testid="activation-verdict"
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                activation.activated
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
              }`}
            >
              {activation.activated ? "활성화됨" : "아직 활성화 아님"}
            </span>
            <span className="text-xs text-zinc-500">
              환경 {activation.environment}
              {activation.applicable ? "" : " · 이 환경은 전환 대상이 아닙니다"}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {activation.detail}
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-3">
            {activation.conditions.map((condition) => (
              <li
                key={condition.id}
                data-testid={`condition-${condition.id}`}
                className={`rounded-lg border p-3 text-xs ${
                  condition.met
                    ? "border-emerald-200 dark:border-emerald-900"
                    : "border-amber-200 dark:border-amber-900"
                }`}
              >
                <p className="font-medium">
                  {condition.met ? "충족" : "아직"} · {condition.title}
                </p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">
                  {condition.detail}
                </p>
                <p className="mt-1 text-zinc-500">다음 할 일: {condition.next}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 2. 과정 — 이력 */}
      {history ? (
        <section
          data-testid="activation-history"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-lg font-medium">과정</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {history.detail}
          </p>
          {history.truncated ? (
            <p className="mt-1 text-xs text-zinc-500">
              최근 {history.timeline.length}건만 보고 있습니다 — 이것이 전체
              이력은 아닙니다.
            </p>
          ) : null}

          {history.timeline.length === 0 ? (
            <p
              data-testid="history-empty"
              className="mt-3 text-sm text-zinc-500"
            >
              아직 기록이 없습니다. 이력이 없다는 것은 &quot;활성화되지
              않았다&quot;가 아니라 &quot;아직 판정한 적이 없다&quot;는 뜻입니다.
            </p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
              {history.timeline.map((item) => (
                <li
                  key={item.recordedAt}
                  data-testid="history-item"
                  className="rounded-lg border border-zinc-100 p-3 dark:border-zinc-900"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {new Date(item.recordedAt).toLocaleString("ko-KR")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        item.activated
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {item.activated ? "활성화" : `충족 ${item.met.length}/3`}
                    </span>
                    <span className="text-xs text-zinc-500">
                      {item.ongoing
                        ? `${duration(item.heldMs)}째 (진행 중)`
                        : duration(item.heldMs)}
                      {" · "}관측 {item.observations}회
                    </span>
                  </div>
                  {item.gained.length > 0 || item.lost.length > 0 ? (
                    <p className="mt-1 text-xs">
                      {item.gained.length > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          + {item.gained.join(" · ")}
                        </span>
                      ) : null}{" "}
                      {item.lost.length > 0 ? (
                        <span
                          data-testid="history-regression"
                          className="text-red-700 dark:text-red-400"
                        >
                          − {item.lost.join(" · ")} (되돌아감)
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                  {/*
                    마지막 관측 이후 구간은 "그대로였다"가 아니라 "모른다"다.
                    이걸 안 적으면 오래된 화면이 확신처럼 읽힌다.
                  */}
                  {item.unobservedMs > 60 * 60 * 1000 ? (
                    <p
                      data-testid="history-unobserved"
                      className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                    >
                      마지막 확인 이후 {duration(item.unobservedMs)} 동안 아무도
                      보지 않았습니다 — 그 구간은 확인된 상태가 아닙니다.
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}

      {/* 3. 증거 — 스모크 */}
      {smoke ? (
        <section
          data-testid="smoke-section"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-medium">실제로 불러 본 결과</h2>
            <button
              type="button"
              data-testid="run-smoke"
              onClick={() => void runSmoke()}
              disabled={smokeRunning}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {smokeRunning ? "부르는 중…" : "스모크 실행 (실 호출·과금)"}
            </button>
          </div>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {smoke.detail}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {smoke.ranAt === null
              ? "한 번도 돌린 적이 없습니다."
              : `마지막 실행 ${new Date(smoke.ranAt).toLocaleString("ko-KR")}`}
            {" · "}실 호출은 돈이 나가므로 예약으로 돌지 않습니다.
          </p>
          {notice ? (
            <p data-testid="smoke-notice" className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {notice}
            </p>
          ) : null}

          <ul data-testid="smoke-results" className="mt-3 grid gap-2 sm:grid-cols-3">
            {smoke.results.map((result) => (
              <li
                key={result.target}
                data-testid={`smoke-${result.target}`}
                className="rounded-lg border border-zinc-100 p-3 text-xs dark:border-zinc-900"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{result.title}</span>
                  <span
                    data-testid={`smoke-status-${result.target}`}
                    className={`rounded-full px-2 py-0.5 ${SMOKE_STYLE[result.status] ?? SMOKE_STYLE.skipped}`}
                  >
                    {SMOKE_LABEL[result.status] ?? result.status}
                  </span>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{result.detail}</p>
                <p className="mt-1 text-zinc-500">
                  상대 {result.baseUrl ?? "기록 없음"}
                  {result.latencyMs === null ? "" : ` · ${result.latencyMs}ms`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 4. 장애 */}
      {incidents ? (
        <IncidentSection board={incidents} onChanged={() => void load()} />
      ) : null}
    </main>
  );
}

/**
 * 장애 이력 (CTO 정책 3701-④).
 *
 * **장애는 사람이 엽니다** — 경보는 자동으로 뜨는 신호이고, 장애는 "사용자가
 * 무엇을 못 했다"를 사람이 선언한 사건입니다. 그래서 이 목록은 자동으로
 * 채워지지 않고, 이 화면에 여는 자리가 있습니다.
 */
function IncidentSection({
  board,
  onChanged,
}: {
  board: IncidentBoardDto;
  onChanged: () => void;
}) {
  const [component, setComponent] = useState("llm");
  const [severity, setSeverity] = useState("MAJOR");
  const [summary, setSummary] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/ops/incidents`, {
        ...authFetchInit({ headers: { "Content-Type": "application/json" } }),
        method: "POST",
        body: JSON.stringify({
          component,
          severity,
          summary,
          startedAt: startedAt === "" ? new Date().toISOString() : new Date(startedAt).toISOString(),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { message?: string }
          | null;
        setMessage(body?.message ?? "장애를 기록하지 못했습니다.");
        return;
      }
      setSummary("");
      setStartedAt("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string) {
    const recovery = window.prompt("무엇으로 살렸는지 적어 주세요 (필수)");
    if (recovery === null) {
      return;
    }
    const response = await fetch(`${API_URL}/ops/incidents/${id}/resolve`, {
      ...authFetchInit({ headers: { "Content-Type": "application/json" } }),
      method: "POST",
      body: JSON.stringify({ recovery }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      setMessage(body?.message ?? "복구를 기록하지 못했습니다.");
      return;
    }
    onChanged();
  }

  return (
    <section
      data-testid="incident-section"
      className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <h2 className="text-lg font-medium">운영 장애 이력</h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{board.detail}</p>
      {board.drafts > 0 ? (
        <p
          data-testid="incident-drafts"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          확인 대기 초안 {board.drafts}건 — 경보에서 자동으로 만든 것이며,
          <strong> 아직 장애가 아닙니다.</strong> 사람이 확인해야 장애가 되고,
          평균에도 넣지 않았습니다.
        </p>
      ) : null}
      <p className="mt-1 text-xs text-zinc-500">
        진행 중 {board.open}건 · 초안 {board.drafts}건 · 복구 {board.resolved}건 ·{" "}
        {/* 복구된 것이 없으면 0분이 아니라 "낼 수 없음"이다 */}
        평균 복구 {board.mttrMs === null ? "낼 수 없음" : duration(board.mttrMs)} ·
        평균 감지 {board.mttdMs === null ? "기록 없음" : duration(board.mttdMs)}
      </p>

      {message ? (
        <p
          data-testid="incident-message"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <select
          aria-label="구성 요소"
          value={component}
          onChange={(event) => setComponent(event.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {COMPONENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="등급"
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        >
          {["MINOR", "MAJOR", "CRITICAL"].map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <input
          aria-label="시작 시각"
          type="datetime-local"
          value={startedAt}
          onChange={(event) => setStartedAt(event.target.value)}
          className="rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          data-testid="open-incident"
          onClick={() => void open()}
          disabled={busy || summary.trim() === ""}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          장애 기록
        </button>
      </div>
      <input
        aria-label="한 줄 설명"
        value={summary}
        onChange={(event) => setSummary(event.target.value)}
        placeholder="무슨 일이 있었는지 한 줄로 (한 달 뒤에 읽는 사람이 알아볼 수 있게)"
        className="mt-2 w-full rounded-lg border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      />

      {board.incidents.length === 0 ? (
        <p data-testid="incident-empty" className="mt-3 text-sm text-zinc-500">
          기록된 장애가 없습니다 — 장애가 없었다는 뜻일 수도, 아무도 적지
          않았다는 뜻일 수도 있습니다.
        </p>
      ) : (
        <ul data-testid="incident-list" className="mt-3 space-y-2 text-sm">
          {board.incidents.map((incident) => (
            <li
              key={incident.id}
              data-testid="incident-item"
              className={`rounded-lg border p-3 ${
                incident.ongoing
                  ? "border-red-200 dark:border-red-900"
                  : "border-zinc-100 dark:border-zinc-900"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[incident.severity] ?? SEVERITY_STYLE.MINOR}`}
                >
                  {incident.severity}
                </span>
                {incident.status === "DRAFT" ? (
                  <span
                    data-testid="incident-draft-badge"
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                  >
                    초안
                  </span>
                ) : null}
                {incident.status === "DISMISSED" ? (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    기각됨
                  </span>
                ) : null}
                <span className="font-medium">{incident.summary}</span>
                <span className="text-xs text-zinc-500">
                  {incident.component} · {incident.durationLabel}
                </span>
                {incident.ongoing && incident.status === "CONFIRMED" ? (
                  <button
                    type="button"
                    data-testid={`resolve-${incident.id}`}
                    onClick={() => void resolve(incident.id)}
                    className="rounded-lg border border-zinc-300 px-2 py-0.5 text-xs transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    복구 기록
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-zinc-500">
                시작 {new Date(incident.startedAt).toLocaleString("ko-KR")}
                {incident.detectedAt === null
                  ? " · 알아챈 시각 기록 없음"
                  : ` · 감지까지 ${duration(incident.detectionMs ?? 0)}`}
              </p>
              {incident.cause !== null || incident.recovery !== null ? (
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {incident.cause === null ? "원인 미기록" : `원인: ${incident.cause}`}
                  {incident.recovery === null ? "" : ` · 복구: ${incident.recovery}`}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
