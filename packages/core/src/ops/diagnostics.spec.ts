import { checkUrgentChannels, detectDiagnosticAlerts, runDiagnostics } from "./diagnostics";
import type { DiagnosticInput } from "./diagnostics";

const NOW = Date.parse("2026-07-31T00:00:00Z");

function input(overrides: Partial<DiagnosticInput> = {}): DiagnosticInput {
  return {
    stage: "daily",
    production: true,
    // 기본 표본은 "긴급 경로까지 갖춰진 운영" — 그래야 각 시험이 자기가
    // 만든 문제만 보게 된다
    env: { ALERT_URGENT_WEBHOOK_URL: "http://127.0.0.1:9400/urgent" },
    envErrors: [],
    database: true,
    storage: true,
    pendingMigrations: 0,
    scheduledChecksEnabled: true,
    anyChannelConfigured: true,
    activation: null,
    uptimeMs: 3_600_000,
    now: NOW,
    ...overrides,
  };
}

describe("checkUrgentChannels", () => {
  it("개발에서는 긴급 경로를 요구하지 않는다 — 요구하면 그 경고가 배경이 된다", () => {
    const check = checkUrgentChannels({
      production: false,
      env: {},
      anyChannelConfigured: false,
    });
    expect(check.status).toBe("ok");
    expect(check.next).toBeNull();
  });

  it("운영에 채널이 하나도 없으면 실패다", () => {
    const check = checkUrgentChannels({
      production: true,
      env: {},
      anyChannelConfigured: false,
    });
    expect(check.status).toBe("fail");
    expect(check.detail).toContain("로그가 유일한 흔적");
  });

  it("운영에 일반 채널만 있으면 주의 — 폴백은 임시 조치다", () => {
    const check = checkUrgentChannels({
      production: true,
      env: {},
      anyChannelConfigured: true,
    });
    expect(check.status).toBe("warn");
    expect(check.detail).toContain("일반 채널로 나갑니다");
    expect(check.next).toContain("ALERT_URGENT_");
  });

  it("긴급 경로가 있으면 정상이다", () => {
    const check = checkUrgentChannels({
      production: true,
      env: { ALERT_URGENT_WEBHOOK_URL: "http://127.0.0.1:9400/urgent" },
      anyChannelConfigured: true,
    });
    expect(check.status).toBe("ok");
    expect(check.next).toBeNull();
  });
});

describe("runDiagnostics", () => {
  it("아무 문제가 없으면 정상이라고 말한다", () => {
    const report = runDiagnostics(input());
    expect(report.fail).toBe(0);
    expect(report.detail).toContain("모든 항목이 정상입니다");
  });

  it("진단은 절대 기동을 막지 않는다 — 경보와 차단은 다르다", () => {
    const report = runDiagnostics(
      input({
        envErrors: [{ name: "DATABASE_URL", message: "필수" }],
        database: false,
        storage: false,
        pendingMigrations: 3,
      }),
    );
    expect(report.fail).toBeGreaterThan(0);
    expect(report.blocked).toBe(false);
    expect(report.detail).toContain("서비스는 계속 뜹니다");
  });

  it("못 본 것을 통과로 세지 않는다", () => {
    const report = runDiagnostics(
      input({ database: null, storage: null, pendingMigrations: null }),
    );
    expect(report.unknown).toBe(3);
    expect(report.ok).toBe(3); // 환경변수·예약 점검·긴급 경로만 정상

    expect(report.detail).toContain("통과로 세지 않았습니다");
  });

  /**
   * 라이브 검증에서 드러난 결함: 긴급 경로 점검을 어댑터가 따로 붙이면
   * 목록에는 보이지만 **요약 문장은 그것을 세지 않는다**. 배지와 목록이
   * 어긋나면 사람은 둘 다 안 믿는다.
   */
  it("긴급 경로 점검이 목록과 요약에 같이 들어간다", () => {
    const report = runDiagnostics(
      input({ production: true, env: {}, anyChannelConfigured: true }),
    );
    const urgent = report.checks.find((check) => check.id === "urgent-channel");
    expect(urgent?.status).toBe("warn");
    // 예약 점검은 켜져 있으므로 주의는 긴급 경로 한 건뿐이고,
    // 요약의 숫자가 그것을 센다
    expect(report.warn).toBe(1);
    expect(report.detail).toContain("주의 1건");
  });

  it("긴급 경로 실패도 요약의 실패 수에 들어간다", () => {
    const report = runDiagnostics(
      input({ production: true, env: {}, anyChannelConfigured: false }),
    );
    expect(report.fail).toBe(1);
    expect(report.detail).toContain("긴급 알림 경로");
  });

  it("적용 상태를 못 읽은 것은 0건이 아니다", () => {
    const report = runDiagnostics(input({ pendingMigrations: null }));
    const migrations = report.checks.find((check) => check.id === "migrations");
    expect(migrations?.status).toBe("unknown");
    expect(migrations?.detail).toContain("0건이라는 뜻이 아닙니다");
  });

  it("환경변수 문제는 개발에서는 주의, 운영에서는 실패다", () => {
    const errors = [{ name: "S3_BUCKET", message: "필수" }];
    expect(
      runDiagnostics(input({ production: false, envErrors: errors })).checks.find(
        (check) => check.id === "env",
      )?.status,
    ).toBe("warn");
    expect(
      runDiagnostics(input({ production: true, envErrors: errors })).checks.find(
        (check) => check.id === "env",
      )?.status,
    ).toBe("fail");
  });

  it("기동 직후의 정상은 아직 아무것도 안 해 본 정상이다", () => {
    const report = runDiagnostics(input({ stage: "startup", uptimeMs: 1500 }));
    const fresh = report.checks.find((check) => check.id === "fresh");
    expect(fresh?.status).toBe("unknown");
    expect(fresh?.detail).toContain("아직 아무것도 안 해 봤다");
    expect(fresh?.detail).not.toContain("**");
  });

  it("일일 진단에는 관측 이력 항목이 없다 — 그때는 기록이 쌓여 있다", () => {
    const report = runDiagnostics(input({ stage: "daily" }));
    expect(report.checks.some((check) => check.id === "fresh")).toBe(false);
  });

  it("활성화가 해당되지 않으면 항목 자체를 만들지 않는다", () => {
    expect(
      runDiagnostics(
        input({ activation: { met: 0, total: 3, applicable: false } }),
      ).checks.some((check) => check.id === "activation"),
    ).toBe(false);
  });
});

describe("detectDiagnosticAlerts", () => {
  it("개발의 빨간불은 운영 알림이 되지 않는다", () => {
    const report = runDiagnostics(input({ production: false, database: false }));
    expect(detectDiagnosticAlerts(report, false)).toEqual([]);
  });

  it("문제가 없으면 경보도 없다", () => {
    expect(detectDiagnosticAlerts(runDiagnostics(input()), true)).toEqual([]);
  });

  it("실패가 있으면 critical, 주의만 있으면 warning", () => {
    const failing = runDiagnostics(input({ database: false }));
    expect(detectDiagnosticAlerts(failing, true)[0].level).toBe("critical");

    const warning = runDiagnostics(input({ scheduledChecksEnabled: false }));
    const alerts = detectDiagnosticAlerts(warning, true);
    expect(alerts[0].level).toBe("warning");
    expect(alerts[0].key).toBe("diagnostics:daily");
  });

  it("단계별로 경보 키를 나눈다 — 기동과 일일은 다른 사안이다", () => {
    const startup = runDiagnostics(input({ stage: "startup", database: false }));
    expect(detectDiagnosticAlerts(startup, true)[0].key).toBe("diagnostics:startup");
  });
});
