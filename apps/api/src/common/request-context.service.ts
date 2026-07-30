import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/** 한 요청의 추적 정보 */
export interface RequestTrace {
  /** 우리 요청 1건의 id */
  requestId: string;
  /** 그 요청이 속한 추적 전체 (W3C traceparent가 있으면 그 값) */
  traceId: string;
}

/** 우리가 응답에 실어 보내는 헤더 — 사람이 로그와 기록을 맞춰 볼 수 있게 */
export const REQUEST_ID_HEADER = "x-request-id";

/**
 * 요청 추적 컨텍스트. (TASK-3601, Sprint 36 — CTO 정책 3601-②)
 *
 * 한 번의 사용자 요청이 LLM·OCR을 여러 번 부릅니다. 그 호출들을 묶는 끈이
 * 없으면 **"이 요청이 얼마를 썼는가"** 와 **"이 실패가 그 요청의 것인가"** 에
 * 답할 수 없고, 장애 때 로그와 기록을 손으로 맞춰 보게 됩니다.
 *
 * ## 왜 인자로 넘기지 않는가
 *
 * 호출 지점이 컨트롤러에서 몇 겹 아래에 있습니다. 인자로 넘기려면 그 사이의
 * 모든 함수에 매개변수를 하나씩 더해야 하고, 하나라도 빠뜨리면 **그 경로만
 * 조용히 추적이 끊깁니다.** `AsyncLocalStorage`는 그 사고를 구조적으로
 * 막습니다.
 *
 * ## 무엇을 받아들이는가
 *
 * - `x-request-id` — 앞단(게이트웨이·프록시)이 준 값이 있으면 **그대로
 *   씁니다.** 우리가 새로 만들면 앞단 로그와 이어지지 않습니다.
 * - `traceparent` (W3C) — 있으면 거기서 trace id를 꺼냅니다.
 * - 둘 다 없으면 만들어 씁니다. **없는 것을 없는 채로 두지 않는 이유**는,
 *   추적이 "가끔 있는 것"이면 아무도 그것에 기대지 않기 때문입니다.
 */
@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestTrace>();

  /** 지금 처리 중인 요청 — 밖에서 부르면 null */
  current(): RequestTrace | null {
    return this.storage.getStore() ?? null;
  }

  run<T>(trace: RequestTrace, fn: () => T): T {
    return this.storage.run(trace, fn);
  }
}

/** `traceparent`(W3C) → trace id — 형식이 아니면 null */
export function parseTraceparent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  // version-traceid-spanid-flags (traceid는 16진수 32자)
  const match = /^[\da-f]{2}-([\da-f]{32})-[\da-f]{16}-[\da-f]{2}$/i.exec(
    value.trim(),
  );
  return match === null ? null : match[1].toLowerCase();
}

/**
 * 요청마다 추적 정보를 세워 주는 미들웨어.
 *
 * 응답에도 `x-request-id`를 실어 보냅니다 — 사용자가 오류를 신고할 때 그
 * 값 하나로 기록을 찾을 수 있어야 합니다.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly context: RequestContextService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      typeof incoming === "string" && incoming.trim() !== ""
        ? incoming.trim().slice(0, 200)
        : randomUUID();
    const traceId = parseTraceparent(req.headers.traceparent) ?? requestId;

    res.setHeader(REQUEST_ID_HEADER, requestId);
    this.context.run({ requestId, traceId }, () => next());
  }
}
