import {
  parseTraceparent,
  RequestContextMiddleware,
  RequestContextService,
  REQUEST_ID_HEADER,
} from "./request-context.service";
import type { RequestTrace } from "./request-context.service";
import type { NextFunction, Request, Response } from "express";

/**
 * 요청 추적 컨텍스트 검증. (TASK-3601 — CTO 정책 3601-②)
 *
 * 한 번의 사용자 요청이 부른 호출들을 묶는 끈이다. 그 끈이 **가끔만
 * 있으면** 아무도 그것에 기대지 않으므로, 여기서 보는 것은 "언제나 있는가"와
 * "앞단이 준 값을 존중하는가"다.
 */
describe("RequestContextService (TASK-3601)", () => {
  const run = (headers: Record<string, unknown>) => {
    const context = new RequestContextService();
    const middleware = new RequestContextMiddleware(context);
    const setHeader = jest.fn();
    const captured: { value: RequestTrace | null } = { value: null };
    const next: NextFunction = () => {
      captured.value = context.current();
    };
    middleware.use(
      { headers } as unknown as Request,
      { setHeader } as unknown as Response,
      next,
    );
    return { seen: captured.value, setHeader, context };
  };

  it("요청마다 추적 정보를 세운다 — 헤더가 없어도", () => {
    const { seen } = run({});
    expect(seen?.requestId).toBeTruthy();
    expect(seen?.traceId).toBe(seen?.requestId);
  });

  it("앞단이 준 x-request-id를 그대로 쓴다 — 우리가 새로 만들면 로그가 끊긴다", () => {
    const { seen } = run({ [REQUEST_ID_HEADER]: "gateway-abc" });
    expect(seen?.requestId).toBe("gateway-abc");
  });

  it("응답에도 실어 보낸다 — 신고받은 값 하나로 기록을 찾을 수 있어야 한다", () => {
    const { setHeader, seen } = run({});
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, seen?.requestId);
  });

  it("traceparent가 있으면 그 추적에 붙는다", () => {
    const { seen } = run({
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    });
    expect(seen?.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    // 우리 요청 id는 따로 유지된다 — 하나의 추적에 여러 요청이 있을 수 있다
    expect(seen?.requestId).not.toBe(seen?.traceId);
  });

  it("형식이 아닌 traceparent는 무시한다 — 지어내지 않는다", () => {
    const { seen } = run({ traceparent: "그냥-문자열" });
    expect(seen?.traceId).toBe(seen?.requestId);
  });

  it("터무니없이 긴 값은 잘라 쓴다", () => {
    const { seen } = run({ [REQUEST_ID_HEADER]: "x".repeat(5000) });
    expect(seen?.requestId.length).toBeLessThanOrEqual(200);
  });

  it("요청 밖에서는 null이다 — 없는 것을 만들어 내지 않는다", () => {
    expect(new RequestContextService().current()).toBeNull();
  });

  describe("traceparent 해석", () => {
    it("W3C 형식만 받는다", () => {
      expect(
        parseTraceparent("00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"),
      ).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(parseTraceparent("00-short-00f067aa0ba902b7-01")).toBeNull();
      expect(parseTraceparent(undefined)).toBeNull();
      expect(parseTraceparent(123)).toBeNull();
    });
  });
});
