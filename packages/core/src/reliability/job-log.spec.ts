import {
  buildLogRecord,
  formatLogLine,
  isSecretName,
  LOG_LEVELS,
  REDACTED,
  redact,
  resolveLogLevel,
  shouldLog,
} from "./job-log";

const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);

describe("로그 등급 (TASK-4603)", () => {
  it("넷뿐이다 — 더 두면 아무도 기준을 못 지킨다", () => {
    expect(LOG_LEVELS).toEqual(["debug", "info", "warn", "error"]);
  });

  it("최소 등급 아래는 남기지 않는다", () => {
    expect(shouldLog("debug", "info")).toBe(false);
    expect(shouldLog("info", "info")).toBe(true);
    expect(shouldLog("error", "warn")).toBe(true);
  });

  /**
   * debug를 기본으로 두면 로그가 너무 커져서 정작 필요한 날 못 찾는다.
   */
  it("기본값은 info다", () => {
    expect(resolveLogLevel({}).level).toBe("info");
  });

  it("알 수 없는 값은 기본값으로 되돌리되 돌려준다", () => {
    const { level, rejected } = resolveLogLevel({ LOG_LEVEL: "verbose" });
    expect(level).toBe("info");
    expect(rejected).toBe("verbose");
  });
});

describe("redact (TASK-4603)", () => {
  /**
   * 로그는 가장 많이 복사되는 텍스트다 — 이슈에, 채팅에, 화면 캡처에.
   */
  it("이름으로 비밀을 가린다", () => {
    const out = redact({
      OPENAI_API_KEY: "sk-abc",
      webhookUrl: "https://hooks.example/xyz",
      password: "1234",
      projectId: "prj-1",
    }) as Record<string, unknown>;
    expect(out.OPENAI_API_KEY).toBe(REDACTED);
    expect(out.webhookUrl).toBe(REDACTED);
    expect(out.password).toBe(REDACTED);
    // 비밀이 아닌 것까지 가리면 로그가 쓸모없어진다
    expect(out.projectId).toBe("prj-1");
  });

  it("표기가 달라도 같은 이름으로 본다", () => {
    for (const name of ["apiKey", "API_KEY", "api-key", "AuthorizationHeader", "S3_SECRET"]) {
      expect(isSecretName(name)).toBe(true);
    }
    for (const name of ["id", "stage", "count", "durationMs"]) {
      expect(isSecretName(name)).toBe(false);
    }
  });

  it("중첩된 값도 따라 들어간다", () => {
    const out = redact({ provider: { config: { token: "t" } } }) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(out.provider.config.token).toBe(REDACTED);
  });

  /**
   * 로그를 남기다가 서비스가 죽으면 안 된다.
   */
  it("순환 참조가 있어도 죽지 않는다", () => {
    const loop: Record<string, unknown> = { name: "a" };
    loop.self = loop;
    expect(() => redact(loop)).not.toThrow();
  });

  it("너무 긴 문자열은 자른다", () => {
    const out = redact({ body: "x".repeat(5000) }) as { body: string };
    expect(out.body.length).toBeLessThan(2100);
    expect(out.body).toContain("[잘림]");
  });
});

describe("buildLogRecord (TASK-4603)", () => {
  it("작업 id·단계·시각을 담고 비밀은 가려 담는다", () => {
    const record = buildLogRecord({
      level: "error",
      jobId: "job-1",
      stage: "ocr",
      message: "실패",
      data: { imageId: "img-1", apiKey: "sk-1" },
      now: NOW,
    });
    expect(record).toMatchObject({ level: "error", jobId: "job-1", stage: "ocr" });
    expect(record.data.apiKey).toBe(REDACTED);
    expect(record.data.imageId).toBe("img-1");
    expect(record.at).toBe("2026-07-31T12:00:00.000Z");
  });

  /**
   * 뒤에 두면 줄이 길어졌을 때 잘려서, 정작 묶어 보려고 만든 값이 안 보인다.
   */
  it("한 줄 텍스트의 맨 앞이 작업 id다", () => {
    const line = formatLogLine(
      buildLogRecord({ level: "info", jobId: "job-9", stage: "start", message: "시작", now: NOW }),
    );
    expect(line.startsWith("[job-9]")).toBe(true);
  });
});
