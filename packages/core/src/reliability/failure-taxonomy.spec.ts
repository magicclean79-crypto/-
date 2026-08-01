import { classifyFailure } from "./failure-taxonomy";

describe("classifyFailure (TASK-4603)", () => {
  it("상태 코드로 가른다", () => {
    expect(classifyFailure(new Error("x"), { status: 401 }).kind).toBe("unauthorized");
    expect(classifyFailure(new Error("x"), { status: 403 }).kind).toBe("unauthorized");
    expect(classifyFailure(new Error("x"), { status: 429 }).kind).toBe("throttled");
    expect(classifyFailure(new Error("x"), { status: 404 }).kind).toBe("rejected");
    expect(classifyFailure(new Error("x"), { status: 503 }).kind).toBe("upstream");
  });

  /**
   * 알림의 isRetriable(1401)과 같은 규칙이다 — 두 곳에서 다른 결론이
   * 나오면 "왜 이건 재시도했고 저건 안 했지"에 답할 수 없다.
   */
  it("4xx는 다시 시도하지 않고 5xx·429는 시도한다", () => {
    expect(classifyFailure(null, { status: 400 }).retriable).toBe(false);
    expect(classifyFailure(null, { status: 401 }).retriable).toBe(false);
    expect(classifyFailure(null, { status: 429 }).retriable).toBe(true);
    expect(classifyFailure(null, { status: 500 }).retriable).toBe(true);
  });

  it("Node 오류 코드를 읽는다", () => {
    expect(classifyFailure(Object.assign(new Error("x"), { code: "ECONNREFUSED" })).kind).toBe(
      "network",
    );
    expect(classifyFailure(Object.assign(new Error("x"), { code: "ETIMEDOUT" })).kind).toBe(
      "timeout",
    );
  });

  /**
   * undici는 진짜 원인을 cause에 넣는다 — 겉만 보면 전부 "fetch failed"다.
   */
  it("cause에 있는 원인까지 본다", () => {
    const error = Object.assign(new Error("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    });
    const verdict = classifyFailure(error);
    expect(verdict.kind).toBe("network");
    expect(verdict.operatorDetail).toContain("connect ECONNREFUSED");
  });

  it("Prisma 코드를 데이터베이스로 본다", () => {
    expect(classifyFailure(Object.assign(new Error("x"), { code: "P2002" })).kind).toBe(
      "database",
    );
  });

  it("AbortError는 시간 초과다", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(classifyFailure(error).kind).toBe("timeout");
  });

  /**
   * 막은 것은 실패가 아니라 정책이다 — 기다린다고 열리지 않는다.
   */
  it("우리가 막은 것은 재시도 대상이 아니다", () => {
    const verdict = classifyFailure(new Error("일간 AI 비용 예산을 초과해 차단했습니다"));
    expect(verdict.kind).toBe("blocked");
    expect(verdict.retriable).toBe(false);
    expect(verdict.userMessage).not.toContain("다시 시도");
  });

  /**
   * 라이브에서 잡은 결함: 예산 초과는 HTTP 429로 나가는데(그 선택 자체는
   * 옳다), 상태 코드만 보면 throttled가 되어 "잠시 후 다시 시도해 주세요"
   * 라고 말하게 된다. 예산은 기다린다고 열리지 않고, 재시도하면 **돈이
   * 나가는 호출을 반복한다.**
   */
  it("우리가 막은 것을 상태 코드보다 먼저 본다", () => {
    const budget = Object.assign(
      new Error(
        "일간 AI 비용 예산을 초과해 OCR 호출을 차단했습니다 — 예산 상향 또는 기간 경과 후 다시 시도해 주세요.",
      ),
      { status: 429 },
    );
    const verdict = classifyFailure(budget);
    expect(verdict.kind).toBe("blocked");
    expect(verdict.retriable).toBe(false);
  });

  /**
   * 그렇다고 상대의 진짜 429까지 정책으로 읽으면 안 된다 — 그건 기다리면
   * 풀린다.
   */
  it("상대가 준 429는 그대로 호출 제한으로 본다", () => {
    const verdict = classifyFailure(
      Object.assign(new Error("Rate limit exceeded, please slow down"), { status: 429 }),
    );
    expect(verdict.kind).toBe("throttled");
    expect(verdict.retriable).toBe(true);
  });

  /**
   * 검증 실행 잠금(4101-⑥)도 우리가 막은 것이다.
   */
  it("검증 잠금 문구도 정책으로 본다", () => {
    const verdict = classifyFailure(
      Object.assign(
        new Error("검증을 시작할 수 없습니다 (3건). 강제로 여는 방법은 없습니다"),
        { status: 403 },
      ),
    );
    expect(verdict.kind).toBe("blocked");
    expect(verdict.retriable).toBe(false);
  });

  /**
   * 모르는 실패를 재시도하면 어떤 실패인지 영영 모른 채로 돈만 쓴다.
   */
  it("모르면 unknown이고 재시도하지 않는다", () => {
    const verdict = classifyFailure(new Error("무언가 이상함"));
    expect(verdict.kind).toBe("unknown");
    expect(verdict.retriable).toBe(false);
  });

  /**
   * 로그·오류 원문에 무엇이 들어 있는지 우리는 미리 알 수 없다.
   */
  it("사용자 문장에 원문을 넣지 않는다", () => {
    const verdict = classifyFailure(
      new Error("OPENAI_API_KEY sk-abc123 로 호출하다 실패 at /srv/app/dist/main.js:42"),
      { status: 500 },
    );
    expect(verdict.userMessage).not.toContain("sk-abc123");
    expect(verdict.userMessage).not.toContain("/srv/app");
    // 운영자에게는 감추지 않는다
    expect(verdict.operatorDetail).toContain("sk-abc123");
  });


  /**
   * 라이브에서 잡은 결함 (TASK-4701): Vision이 503을 내는데도 묶음이
   * **"성공"으로 끝났다.** 어댑터는 상태 코드마다 사람이 할 일을 적어
   * 남기는데(좋은 설계다), 그 문장이 기록에 남는 순간 구조가 사라진다.
   * 나중에 읽는 쪽에는 `Error(문장)` 하나만 오고, 분류하지 못한 실패는
   * "이 한 장의 문제"로 취급되어 전부 건너뛴 뒤 작업은 성공으로 남았다.
   * **상대가 통째로 죽은 날 우리 화면이 초록이었다.**
   */
  it("우리 문장에 담긴 상태 코드를 되찾는다", () => {
    const outage = classifyFailure(
      new Error("Google Cloud Vision 장애 (503) — 우리 설정 문제가 아닙니다: Backend unavailable"),
    );
    expect(outage.kind).toBe("upstream");
    expect(outage.retriable).toBe(true);

    expect(
      classifyFailure(new Error("Google Cloud Vision 할당량 초과 (429) — 잠시 후")).kind,
    ).toBe("throttled");
    expect(
      classifyFailure(new Error("Google Cloud Vision 인증 실패 (403) — 키가 유효하지 않습니다")).kind,
    ).toBe("unauthorized");
    expect(
      classifyFailure(new Error("Google Cloud Vision이 요청을 거절했습니다 (400) — 형식 확인")).kind,
    ).toBe("rejected");
  });

  /**
   * 넓게 잡으면 본문에 우연히 들어간 숫자를 상태 코드로 읽게 되고, 그건
   * 지금 문제보다 나쁘다.
   */
  it("아무 괄호 숫자나 상태 코드로 읽지 않는다", () => {
    expect(classifyFailure(new Error("상품 코드 (503) 재고 없음")).kind).toBe("unknown");
    expect(classifyFailure(new Error("장애 (999) 알 수 없음")).kind).toBe("unknown");
  });

  /**
   * 없는 물건 하나와 없는 창고는 다르다. 뭉쳐 두면 파일 하나가 빠졌을 때
   * 묶음 전체가 멈추거나, 버킷이 통째로 없을 때 전부 건너뛰고 성공으로
   * 끝난다.
   */
  it("없는 파일 하나와 없는 버킷을 가른다", () => {
    const key = classifyFailure(
      new Error("이미지를 읽을 수 없습니다: The specified key does not exist."),
    );
    expect(key.kind).toBe("rejected");
    expect(key.retriable).toBe(false);

    const bucket = classifyFailure(
      new Error("이미지를 읽을 수 없습니다: 버킷을 찾을 수 없습니다: acos"),
    );
    expect(bucket.kind).toBe("storage");
    expect(bucket.retriable).toBe(true);
  });

  /** 붙어 온 상태 코드가 우선이다 — 문장에서 되찾는 것은 없을 때만이다 */
  it("붙어 온 상태 코드를 문장이 덮어쓰지 않는다", () => {
    expect(
      classifyFailure(new Error("호출 실패 (500)"), { status: 429 }).kind,
    ).toBe("throttled");
  });

  it("아무것도 아닌 값이 와도 터지지 않는다", () => {
    for (const value of [null, undefined, "", 0, {}, []]) {
      expect(() => classifyFailure(value)).not.toThrow();
    }
    expect(classifyFailure(undefined).operatorDetail).toContain("원문 없음");
  });

  it("화면에 실리는 문장에 마크다운 강조를 쓰지 않는다", () => {
    for (const status of [400, 401, 429, 500]) {
      expect(classifyFailure(new Error("x"), { status }).userMessage).not.toContain("**");
    }
  });
});
