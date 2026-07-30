"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  BillingReportDto,
  CostForecastDto,
  PricingBoardDto,
  PricingDetectionDto,
  PricingOriginDto,
  PricingProposalDto,
  PricingStageDto,
  PricingTargetDto,
} from "@acos/shared";
import { authFetchInit } from "../../../lib/auth-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const STAGE_LABEL: Record<PricingStageDto, string> = {
  DETECTED: "감지됨",
  DRAFT: "작성됨",
  REVIEWED: "검토됨",
  APPROVED: "승인됨",
  APPLIED: "적용됨",
  REJECTED: "반려됨",
};

const STAGE_STYLE: Record<PricingStageDto, string> = {
  // 감지는 "무엇인가 달라졌다"는 신호다 — 정상(초록)도 실패(빨강)도 아니다
  DETECTED:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  DRAFT: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  REVIEWED: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
  APPROVED:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  APPLIED:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  REJECTED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

/** 사람이 낸 제안과 자동 감지를 화면에서 가른다 (TASK-3201) */
const ORIGIN_LABEL: Record<PricingOriginDto, string> = {
  manual: "직접 제안",
  detected: "자동 감지",
};

/** 단계별로 지금 누를 수 있는 버튼 (경로 이름 = 행동) */
const STAGE_ACTION: Record<PricingStageDto, string> = {
  // 감지가 검토를 대신한다 — 근거를 보고 승인만 하면 된다 (정책 3201-①)
  DETECTED: "approve",
  DRAFT: "review",
  REVIEWED: "approve",
  APPROVED: "apply",
  APPLIED: "",
  REJECTED: "",
};

const ACTION_LABEL: Record<string, string> = {
  review: "검토 완료",
  approve: "승인",
  apply: "적용",
};

function money(value: number | null): string {
  return value === null ? "미산정" : `$${value.toFixed(6)}`;
}

function percent(value: number | null): string {
  // 0%로 적으면 "안 썼다"로 읽힌다 — 나눌 수 없으면 말하지 않는다
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** 단가 한 줄 (LLM은 입력·출력, OCR은 단위당) */
function priceText(
  target: PricingTargetDto,
  price: Record<string, number> | null,
): string {
  if (price === null) {
    return "가격표에 없던 항목";
  }
  return target === "llm"
    ? `입력 $${price.inputPerMillion}/1M · 출력 $${price.outputPerMillion}/1M`
    : `단위당 $${price.perUnitUsd}`;
}

/**
 * AI 비용 인텔리전스·자동화 (TASK-3101 · 3201) — ADMIN 전용.
 *
 * 가격 변경은 **감지 → 승인 → 적용**이고(정책 3201-①), 감지는 근거를 들고
 * 오지만 **적용은 사람이** 한다. 적용은 결정이고 **발효는 시각**이다
 * (정책 3201-③) — 예약된 단가는 그 시각까지 어떤 계산에도 쓰이지 않는다.
 *
 * 세 가지를 한 화면에 둔다. **셋의 성격이 서로 다르다는 사실**을 화면이 직접
 * 말한다 — 섞이면 사람은 추정을 청구서로, 리포트를 회계로 다룬다:
 *
 * - **가격표**: 검토 → 승인 → 적용 절차를 거친다 (정책 3101-①). 적용된
 *   단가는 **이후 호출**에만 쓰이고 과거 기록은 바뀌지 않는다 (정책 3101-②).
 * - **월말 예측**: 참고자료다 (정책 3101-③) — 이 숫자로 호출이 막히지 않는다.
 * - **운영 비용 리포트**: 운영 지표다 (정책 3101-④) — 회계 청구서가 아니다.
 */
export default function CostIntelligencePage() {
  const [board, setBoard] = useState<PricingBoardDto | null>(null);
  const [forecast, setForecast] = useState<CostForecastDto | null>(null);
  const [billing, setBilling] = useState<BillingReportDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 제안 입력 (LLM은 입력·출력 단가, OCR은 단위 단가)
  const [target, setTarget] = useState<PricingTargetDto>("ocr");
  const [key, setKey] = useState("google-vision");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [perUnit, setPerUnit] = useState("");
  const [reason, setReason] = useState("");
  /** 적용 예약 시각 (datetime-local) — 비우면 즉시 발효 (정책 3201-③) */
  const [effectiveFrom, setEffectiveFrom] = useState("");

  async function get<T>(path: string): Promise<T | null> {
    const response = await fetch(`${API_URL}${path}`, authFetchInit());
    if (!response.ok) {
      setError(
        response.status === 401 || response.status === 403
          ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
          : `조회 실패 (HTTP ${response.status})`,
      );
      return null;
    }
    return (await response.json()) as T;
  }

  async function load() {
    setBusy(true);
    try {
      const [nextBoard, nextForecast, nextBilling] = await Promise.all([
        get<PricingBoardDto>("/ops/pricing"),
        get<CostForecastDto>("/ops/cost-forecast"),
        get<BillingReportDto>("/ops/billing"),
      ]);
      if (nextBoard) {
        setError(null);
        setBoard(nextBoard);
      }
      if (nextForecast) {
        setForecast(nextForecast);
      }
      if (nextBilling) {
        setBilling(nextBilling);
      }
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 단가 변경 제안 — 사유 없이는 등록되지 않는다 */
  async function propose() {
    setBusy(true);
    setNote(null);
    try {
      const price =
        target === "llm"
          ? {
              inputPerMillion: Number(input),
              outputPerMillion: Number(output),
            }
          : { perUnitUsd: Number(perUnit) };
      const response = await fetch(`${API_URL}/ops/pricing`, {
        ...authFetchInit(),
        method: "POST",
        headers: {
          ...authFetchInit().headers,
          "content-type": "application/json",
        },
        body: JSON.stringify({ target, key, price, reason }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        // 거절 사유를 그대로 보여 준다 — "실패했습니다"만 적으면 무엇을
        // 고쳐야 할지 알 수 없다
        setError(
          typeof body.message === "string"
            ? body.message
            : `제안 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setError(null);
      setNote("제안을 등록했습니다 — 검토 → 승인 → 적용 절차가 남았습니다.");
      setReason("");
      await load();
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 가격 변경 감지 — 예약을 기다리지 않고 지금 (정책 3201-①) */
  async function detect() {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`${API_URL}/ops/pricing/detect`, {
        ...authFetchInit(),
        method: "POST",
      });
      if (!response.ok) {
        setError(
          response.status === 401 || response.status === 403
            ? "ADMIN 권한이 필요합니다 — 관리자 계정으로 로그인해 주세요."
            : `감지 실패 (HTTP ${response.status})`,
        );
        return;
      }
      const result = (await response.json()) as PricingDetectionDto;
      setError(null);
      // 감지는 적용이 아니다 — 무엇이 만들어졌고 무엇을 해야 하는지 말한다
      setNote(
        result.created.length > 0
          ? `${result.created.length}건을 감지해 제안을 등록했습니다 — 근거를 확인하고 승인해 주세요. 감지만으로 단가는 바뀌지 않습니다.`
          : result.unresolved.length > 0
            ? `${result.unresolved.length}건이 가격표와 어긋나지만 단가를 가를 수 없어 제안을 만들지 않았습니다 — 직접 제안을 내주세요.`
            : "가격표와 어긋나는 기록이 없습니다.",
      );
      await load();
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  /** 단계 진행 (검토·승인·적용·반려) */
  async function advance(
    proposal: PricingProposalDto,
    action: string,
    rejectReason?: string,
  ) {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(
        `${API_URL}/ops/pricing/${proposal.id}/${action}`,
        {
          ...authFetchInit(),
          method: "POST",
          headers: {
            ...authFetchInit().headers,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            rejectReason !== undefined
              ? { reason: rejectReason }
              : // 적용에만 발효 시각을 보낸다 — 비어 있으면 즉시 발효
                action === "apply" && effectiveFrom !== ""
                ? { effectiveFrom: new Date(effectiveFrom).toISOString() }
                : {},
          ),
        },
      );
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(
          typeof body.message === "string"
            ? body.message
            : `진행 실패 (HTTP ${response.status})`,
        );
        return;
      }
      setError(null);
      setNote(
        action === "apply"
          ? effectiveFrom === ""
            ? "적용했습니다 — 이후 호출에 이 단가가 쓰입니다. 과거 비용 기록은 바뀌지 않습니다."
            : `적용했습니다 — ${new Date(effectiveFrom).toLocaleString("ko-KR")}부터 이 단가가 쓰입니다 (예약). 그때까지는 이전 단가로 계산합니다.`
          : `${ACTION_LABEL[action] ?? "반려"} 처리했습니다.`,
      );
      if (action === "apply") {
        setEffectiveFrom("");
      }
      await load();
    } catch {
      setError("API 서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-16">
      <div>
        <Link
          href="/"
          className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← 홈으로
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">AI 비용 관리</h1>
        <p className="mt-1 text-sm text-zinc-500">
          가격표 거버넌스 · 월말 예측 · 운영 비용 리포트 (ADMIN 전용)
        </p>
      </div>

      {error ? (
        <div
          data-testid="costs-error"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </div>
      ) : null}

      {note ? (
        <div
          data-testid="costs-note"
          className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
        >
          {note}
        </div>
      ) : null}

      {board ? (
        <section
          data-testid="pricing-board"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-lg font-semibold">가격표</h2>
          <p className="mt-1 text-sm text-zinc-500">{board.detail}</p>

          <h3 className="mt-4 text-sm font-semibold">실효 가격표</h3>
          <p className="text-xs text-zinc-500">
            지금 계산에 쓰는 단가입니다. 적용 이력 {board.effective.appliedCount}건
            {board.effective.lastAppliedAt
              ? ` · 마지막 적용 ${new Date(board.effective.lastAppliedAt).toLocaleString("ko-KR")}`
              : ""}
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1">모델 · 엔진</th>
                  <th className="py-1">단가</th>
                  <th className="py-1">출처</th>
                </tr>
              </thead>
              <tbody data-testid="effective-pricing">
                {board.effective.llm.map((row) => (
                  <tr
                    key={`llm-${row.model}`}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1">LLM {row.model}</td>
                    <td className="py-1">
                      입력 ${row.inputPerMillion}/1M · 출력 $
                      {row.outputPerMillion}/1M
                    </td>
                    {/* 승인된 단가와 코드 기본값은 구분되어야 한다 */}
                    <td className="py-1 text-xs text-zinc-500">{row.note}</td>
                  </tr>
                ))}
                {board.effective.ocr.map((row) => (
                  <tr
                    key={`ocr-${row.provider}`}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1">OCR {row.provider}</td>
                    <td className="py-1">단위당 ${row.perUnitUsd}</td>
                    {/* 승인된 단가와 코드 기본값은 구분되어야 한다 */}
                    <td className="py-1 text-xs text-zinc-500">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {board.effective.scheduled.length > 0 ? (
            <div
              className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm dark:border-sky-900 dark:bg-sky-950"
              data-testid="scheduled-pricing"
            >
              {/* 발효된 것과 섞으면 예약된 단가가 이미 쓰이는 것처럼 보인다 */}
              <p className="font-medium">
                예약된 변경 {board.effective.scheduled.length}건 — 아직 계산에
                쓰이지 않습니다
              </p>
              <ul className="mt-1 space-y-1 text-zinc-600 dark:text-zinc-400">
                {board.effective.scheduled.map((row) => (
                  <li key={`${row.target}-${row.key}-${row.effectiveFrom}`}>
                    {row.target}/{row.key}:{" "}
                    {priceText(row.target, row.price)} —{" "}
                    {new Date(row.effectiveFrom).toLocaleString("ko-KR")}부터
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 className="mt-6 text-sm font-semibold">
            진행 중인 제안 ({board.open.length}건)
          </h3>
          {board.open.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-500">
              진행 중인 제안이 없습니다.
            </p>
          ) : (
            <ul className="mt-2 space-y-3" data-testid="open-proposals">
              {board.open.map((proposal) => (
                <li
                  key={proposal.id}
                  className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[proposal.stage]}`}
                    >
                      {STAGE_LABEL[proposal.stage]}
                    </span>
                    {/* 자동화가 만든 제안을 사람이 낸 것으로 읽지 않게 한다 */}
                    <span
                      data-testid={`origin-${proposal.origin}`}
                      className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
                    >
                      {ORIGIN_LABEL[proposal.origin]}
                    </span>
                    <span className="font-medium">
                      {proposal.target}/{proposal.key}
                    </span>
                    <span className="text-zinc-500">
                      {priceText(proposal.target, proposal.currentPrice)} →{" "}
                      {priceText(proposal.target, proposal.price)}
                    </span>
                  </div>
                  <p className="mt-1 text-zinc-500">사유: {proposal.reason}</p>
                  {proposal.evidence !== null ? (
                    // 근거 없는 제안은 승인할 수 없다 — 무엇을 보고 판단했는지
                    // 화면에 있어야 승인이 확인이 된다
                    <p
                      className="mt-1 text-xs text-zinc-500"
                      data-testid="proposal-evidence"
                    >
                      근거: 표본 {proposal.evidence.sampleIds.length}건 ·{" "}
                      {new Date(proposal.evidence.from).toLocaleString("ko-KR")} ~{" "}
                      {new Date(proposal.evidence.to).toLocaleString("ko-KR")} · 차이{" "}
                      {(proposal.evidence.relativeDiff * 100).toFixed(1)}%
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-zinc-500">
                    {/* 감지된 제안의 제안자는 "알 수 없음"이 아니라 시스템이다 —
                        모르는 것과 사람이 아닌 것은 다르다 */}
                    제안{" "}
                    {proposal.proposedBy ??
                      (proposal.origin === "detected"
                        ? "시스템 (자동 감지)"
                        : "알 수 없음")}
                    {proposal.reviewedBy
                      ? ` · 검토 ${proposal.reviewedBy}`
                      : ""}
                    {proposal.approvedBy
                      ? ` · 승인 ${proposal.approvedBy}`
                      : ""}
                  </p>
                  {proposal.selfApproval ? (
                    <p
                      className="mt-1 text-xs text-amber-700 dark:text-amber-400"
                      data-testid="self-approval-warning"
                    >
                      {proposal.selfApproval}
                    </p>
                  ) : null}
                  {STAGE_ACTION[proposal.stage] === "apply" ? (
                    <label className="mt-2 block text-xs text-zinc-500">
                      발효 시각 (비우면 즉시) — 적용은 결정이고 발효는 시각입니다
                      <input
                        type="datetime-local"
                        data-testid="pricing-effective-from"
                        value={effectiveFrom}
                        onChange={(event) => setEffectiveFrom(event.target.value)}
                        className="mt-1 block w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                      />
                    </label>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {STAGE_ACTION[proposal.stage] ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void advance(proposal, STAGE_ACTION[proposal.stage])
                        }
                        className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {ACTION_LABEL[STAGE_ACTION[proposal.stage]]}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void advance(
                          proposal,
                          "reject",
                          "화면에서 반려했습니다.",
                        )
                      }
                      className="rounded-lg border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      반려
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-6 text-sm font-semibold">단가 변경 제안</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-zinc-500">
              대상
              <select
                data-testid="pricing-target"
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as PricingTargetDto)
                }
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="ocr">OCR 엔진</option>
                <option value="llm">LLM 모델</option>
              </select>
            </label>
            <label className="text-xs text-zinc-500">
              모델 · 엔진 이름
              <input
                data-testid="pricing-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            {target === "llm" ? (
              <>
                <label className="text-xs text-zinc-500">
                  입력 단가 (USD / 1M tokens)
                  <input
                    data-testid="pricing-input"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
                <label className="text-xs text-zinc-500">
                  출력 단가 (USD / 1M tokens)
                  <input
                    data-testid="pricing-output"
                    value={output}
                    onChange={(event) => setOutput(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              </>
            ) : (
              <label className="text-xs text-zinc-500">
                단위 단가 (USD / 단위)
                <input
                  data-testid="pricing-per-unit"
                  value={perUnit}
                  onChange={(event) => setPerUnit(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            )}
            <label className="text-xs text-zinc-500 sm:col-span-2">
              변경 사유 (필수)
              <input
                data-testid="pricing-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="예: 2026-07 Google Cloud Vision 단가 공지 반영"
                className="mt-1 w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="pricing-propose"
              disabled={busy}
              onClick={() => void propose()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              제안 등록
            </button>
            {/* 예약(6시간)을 기다리지 않고 지금 대조한다 — 감지는 적용이 아니다 */}
            <button
              type="button"
              data-testid="pricing-detect"
              disabled={busy}
              onClick={() => void detect()}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              지금 감지
            </button>
          </div>

          {board.closed.length > 0 ? (
            <>
              <h3 className="mt-6 text-sm font-semibold">끝난 제안</h3>
              <ul className="mt-2 space-y-2 text-sm" data-testid="closed-proposals">
                {board.closed.slice(0, 10).map((proposal) => (
                  <li key={proposal.id} className="flex flex-wrap gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[proposal.stage]}`}
                    >
                      {STAGE_LABEL[proposal.stage]}
                    </span>
                    <span className="text-zinc-500">{proposal.detail}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}

      {forecast ? (
        <section
          data-testid="cost-forecast"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">월말 예측</h2>
            {/* 참고자료라는 사실을 제목 옆에서 말한다 — 숫자만 있으면
                사람은 그것을 사실로 다룬다 */}
            <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              참고자료
            </span>
            {forecast.verdict === "insufficient" ? (
              <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                표본 부족
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-zinc-500">{forecast.detail}</p>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-zinc-500">이번 달 실제 지출</dt>
              <dd>{money(forecast.monthToDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">하루 평균</dt>
              <dd>{money(forecast.dailyAverage)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">월말 예상</dt>
              <dd>{money(forecast.projectedMonthEnd)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">예산 대비</dt>
              <dd>{percent(forecast.projectedRatio)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-500">
            관측 {forecast.observedDays}일 / 최소 {forecast.minDays}일 · 예산
            차단은 실제 비용만 사용합니다. 예상이 예산을 넘으면{" "}
            <strong>경보만</strong> 나가고 호출은 막히지 않습니다 (CTO 정책
            3201-④).
          </p>
        </section>
      ) : null}

      {billing ? (
        <section
          data-testid="billing-report"
          className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">운영 비용 리포트</h2>
            <span className="rounded bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              운영 지표
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {new Date(billing.period.from).toLocaleDateString("ko-KR")} ~{" "}
            {new Date(billing.period.to).toLocaleDateString("ko-KR")} · 호출{" "}
            {billing.calls}건 · 합계 {money(billing.total)} (LLM{" "}
            {money(billing.bySource.llm)} · OCR {money(billing.bySource.ocr)})
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-zinc-500">
                <tr>
                  <th className="py-1">원장</th>
                  <th className="py-1">Provider · 모델</th>
                  <th className="py-1">호출</th>
                  <th className="py-1">비용</th>
                  <th className="py-1">비중</th>
                </tr>
              </thead>
              <tbody data-testid="billing-rows">
                {billing.rows.map((row) => (
                  <tr
                    key={`${row.source}-${row.provider}-${row.model}`}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="py-1 uppercase">{row.source}</td>
                    <td className="py-1">
                      {row.provider} · {row.model}
                    </td>
                    <td className="py-1">
                      {row.calls}
                      {row.unpricedCalls > 0
                        ? ` (미산정 ${row.unpricedCalls})`
                        : ""}
                    </td>
                    <td className="py-1">{money(row.cost)}</td>
                    <td className="py-1">{percent(row.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {billing.rows.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">
              이 기간에 집계된 호출이 없습니다.
            </p>
          ) : null}
          {/* 면책 문구는 항상 남는다 — 숫자만 있으면 누군가 그것을 청구서로
              다루고, 회계와 어긋나는 순간 리포트 전체가 신뢰를 잃는다 */}
          <p
            data-testid="billing-disclaimer"
            className="mt-3 text-xs text-zinc-500"
          >
            {billing.disclaimer}
          </p>
        </section>
      ) : null}

      <button
        type="button"
        data-testid="costs-refresh"
        disabled={busy}
        onClick={() => void load()}
        className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        {busy ? "조회 중…" : "다시 조회"}
      </button>
    </main>
  );
}
