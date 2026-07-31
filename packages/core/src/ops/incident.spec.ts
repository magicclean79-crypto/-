import {
  incidentDuration,
  needsFollowUp,
  summarizeIncidents,
  validateAnalysis,
  validateIncident,
  validateResolution,
} from "./incident";
import type { IncidentRecord } from "./incident";

/**
 * 운영 장애 이력 검증. (TASK-3701 — CTO 정책 3701-④)
 *
 * 여기서 지키는 것: **진행 중인 장애를 평균에 넣지 않는다**, **복구된 것이
 * 없으면 MTTR은 0이 아니라 null이다**, **복구 방법 없이 닫지 않는다**.
 */
describe("운영 장애 이력 (TASK-3701)", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  const incident = (overrides: Partial<IncidentRecord>): IncidentRecord => ({
    id: "inc-1",
    component: "llm",
    severity: "MAJOR",
    summary: "OpenAI 호출 전량 실패",
    startedAt: new Date("2026-07-30T09:00:00Z"),
    detectedAt: null,
    resolvedAt: null,
    cause: null,
    recovery: null,
    fixKind: null,
    rootCause: null,
    temporaryFix: null,
    permanentFix: null,
    prevention: null,
    ...overrides,
  });

  describe("지속 시간", () => {
    it("복구된 장애는 시작 → 복구다", () => {
      const duration = incidentDuration(
        incident({ resolvedAt: new Date("2026-07-30T10:30:00Z") }),
        now,
      );
      expect(duration.ms).toBe(90 * 60 * 1000);
      expect(duration.ongoing).toBe(false);
      expect(duration.label).toBe("1시간 30분");
    });

    it("진행 중인 장애의 시간은 최종값이 아니라 '지금까지'다", () => {
      const duration = incidentDuration(incident({}), now);
      expect(duration.ongoing).toBe(true);
      expect(duration.label).toContain("째 진행 중");
    });

    it("감지 시간과 복구 시간을 나눠 센다 — 늦게 안 것과 늦게 고친 것은 다르다", () => {
      const duration = incidentDuration(
        incident({
          detectedAt: new Date("2026-07-30T09:50:00Z"),
          resolvedAt: new Date("2026-07-30T10:00:00Z"),
        }),
        now,
      );
      expect(duration.detectionMs).toBe(50 * 60 * 1000);
      expect(duration.recoveryMs).toBe(10 * 60 * 1000);
    });

    it("알아챈 시각을 모르면 감지 시간은 null이다 — 0분이 아니다", () => {
      expect(incidentDuration(incident({}), now).detectionMs).toBeNull();
    });
  });

  describe("기록 성립", () => {
    it("모르는 구성 요소·등급은 받지 않는다", () => {
      expect(
        validateIncident({
          component: "저기 어딘가",
          severity: "MAJOR",
          summary: "무언가 안 됨",
          startedAt: now,
          now,
        }),
      ).toEqual({ ok: false, reason: expect.stringContaining("모르는 구성 요소") });
      expect(
        validateIncident({
          component: "llm",
          severity: "조금 심각",
          summary: "무언가 안 됨",
          startedAt: now,
          now,
        }),
      ).toEqual({ ok: false, reason: expect.stringContaining("모르는 등급") });
    });

    it("한 줄 설명이 없으면 이력이 아니다", () => {
      const result = validateIncident({
        component: "llm",
        severity: "MAJOR",
        summary: "장애",
        startedAt: now,
        now,
      });
      expect(result.ok).toBe(false);
    });

    it("미래의 장애는 기록하지 않는다", () => {
      const result = validateIncident({
        component: "llm",
        severity: "MAJOR",
        summary: "아직 안 일어난 일",
        startedAt: new Date("2026-08-01T00:00:00Z"),
        now,
      });
      expect(result).toEqual({ ok: false, reason: expect.stringContaining("미래") });
    });

    it("일어나기 전에 알아챌 수는 없다", () => {
      const result = validateIncident({
        component: "llm",
        severity: "MAJOR",
        summary: "OpenAI 호출 전량 실패",
        startedAt: new Date("2026-07-30T09:00:00Z"),
        detectedAt: new Date("2026-07-30T08:00:00Z"),
        now,
      });
      expect(result.ok).toBe(false);
    });

    it("성립하는 기록은 통과한다", () => {
      expect(
        validateIncident({
          component: "storage",
          severity: "CRITICAL",
          summary: "S3 업로드 전량 실패",
          startedAt: new Date("2026-07-30T09:00:00Z"),
          detectedAt: new Date("2026-07-30T09:05:00Z"),
          now,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("복구 기록", () => {
    it("복구 방법 없이 닫지 않는다", () => {
      const result = validateResolution({
        incident: incident({}),
        resolvedAt: new Date("2026-07-30T10:00:00Z"),
        recovery: "",
        fixKind: "permanent",
        now,
      });
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("무엇으로 살렸는지"),
      });
    });

    it("이미 닫힌 장애를 다시 닫지 않는다", () => {
      const result = validateResolution({
        incident: incident({ resolvedAt: new Date("2026-07-30T10:00:00Z") }),
        resolvedAt: new Date("2026-07-30T11:00:00Z"),
        recovery: "API 키 교체",
        fixKind: "permanent",
        now,
      });
      expect(result.ok).toBe(false);
    });

    it("복구가 시작보다 앞설 수는 없다", () => {
      const result = validateResolution({
        incident: incident({}),
        resolvedAt: new Date("2026-07-30T08:00:00Z"),
        recovery: "API 키 교체",
        fixKind: "permanent",
        now,
      });
      expect(result.ok).toBe(false);
    });

    it("임시인지 영구인지 고르지 않으면 닫히지 않는다 — 기본값을 두면 목록이 거짓말한다", () => {
      const result = validateResolution({
        incident: incident({}),
        resolvedAt: new Date("2026-07-30T10:00:00Z"),
        recovery: "API 서버 재시작",
        fixKind: "",
        now,
      });
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("임시 조치인지 영구 조치인지"),
      });
    });

    it("복구 방법이 적혀 있으면 닫을 수 있다", () => {
      expect(
        validateResolution({
          incident: incident({}),
          resolvedAt: new Date("2026-07-30T10:00:00Z"),
          recovery: "만료된 OPENAI_API_KEY를 새 키로 교체",
          fixKind: "permanent",
          now,
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("사후 분석 (정책 3801-②)", () => {
    it("근본 원인 없이 재발 방지를 적을 수 없다", () => {
      const result = validateAnalysis({
        incident: incident({ resolvedAt: new Date("2026-07-30T10:00:00Z") }),
        prevention: "배포 전 키 만료일을 확인하는 단계를 추가",
      });
      expect(result).toEqual({
        ok: false,
        reason: expect.stringContaining("근본 원인 없이"),
      });
    });

    it("이미 원인이 적힌 장애에는 재발 방지만 더할 수 있다", () => {
      expect(
        validateAnalysis({
          incident: incident({ rootCause: "키 만료일을 아무도 보지 않았다" }),
          prevention: "배포 전 키 만료일을 확인하는 단계를 추가",
        }),
      ).toEqual({ ok: true });
    });

    it("아무것도 적지 않으면 받지 않는다", () => {
      expect(validateAnalysis({ incident: incident({}) }).ok).toBe(false);
    });

    it("원인과 재발 방지를 함께 적으면 통과한다", () => {
      expect(
        validateAnalysis({
          incident: incident({}),
          rootCause: "키 만료일을 아무도 보지 않았다",
          permanentFix: "만료 30일 전 경보를 추가",
          prevention: "배포 체크리스트에 키 만료 확인을 넣음",
        }),
      ).toEqual({ ok: true });
    });
  });

  describe("영구 조치 대기 (정책 3801-②)", () => {
    it("임시 조치로 닫힌 장애는 끝난 것이 아니다", () => {
      expect(
        needsFollowUp(
          incident({
            resolvedAt: new Date("2026-07-30T10:00:00Z"),
            fixKind: "temporary",
            temporaryFix: "API 서버 재시작",
          }),
        ),
      ).toBe(true);
    });

    it("영구 조치가 적히면 해제된다", () => {
      expect(
        needsFollowUp(
          incident({
            resolvedAt: new Date("2026-07-30T10:00:00Z"),
            fixKind: "temporary",
            permanentFix: "연결 풀 설정을 고침",
          }),
        ),
      ).toBe(false);
    });

    it("진행 중인 장애는 '후속'이 아니라 '지금'이다", () => {
      expect(needsFollowUp(incident({ fixKind: "temporary" }))).toBe(false);
    });

    it("옛 기록(fixKind 없음)을 후속 대기로 세지 않는다 — 모르는 것을 문제로 만들지 않는다", () => {
      expect(
        needsFollowUp(incident({ resolvedAt: new Date("2026-07-30T10:00:00Z") })),
      ).toBe(false);
    });
  });

  describe("요약", () => {
    it("기록이 없으면 '장애가 없었다'로 단정하지 않는다", () => {
      const summary = summarizeIncidents([], now);
      expect(summary.mttrMs).toBeNull();
      expect(summary.detail).toContain("아무도 적지");
    });

    it("복구된 것이 없으면 MTTR은 0이 아니라 null이다", () => {
      const summary = summarizeIncidents([incident({})], now);
      expect(summary.mttrMs).toBeNull();
      expect(summary.detail).toContain("평균을 낼 수 없습니다");
    });

    it("진행 중인 장애는 평균에 넣지 않고 먼저 보여 준다", () => {
      const summary = summarizeIncidents(
        [
          incident({
            id: "a",
            resolvedAt: new Date("2026-07-30T09:30:00Z"),
            recovery: "재시작",
          }),
          incident({ id: "b", startedAt: new Date("2026-07-28T12:00:00Z") }),
        ],
        now,
      );
      expect(summary.open).toHaveLength(1);
      expect(summary.open[0].incident.id).toBe("b");
      // 진행 중 48시간이 평균에 섞였다면 30분이 나올 수 없다
      expect(summary.mttrMs).toBe(30 * 60 * 1000);
      expect(summary.detail).toContain("진행 중인 장애 1건");
      expect(summary.detail).toContain("평균에도 넣지 않습니다");
    });

    it("가장 오래 걸린 장애를 집어 준다", () => {
      const summary = summarizeIncidents(
        [
          incident({
            id: "a",
            resolvedAt: new Date("2026-07-30T09:30:00Z"),
            recovery: "재시작",
          }),
          incident({
            id: "b",
            startedAt: new Date("2026-07-29T09:00:00Z"),
            resolvedAt: new Date("2026-07-29T15:00:00Z"),
            recovery: "롤백",
          }),
        ],
        now,
      );
      expect(summary.longest?.incident.id).toBe("b");
      expect(summary.totalDowntimeMs).toBe((30 + 360) * 60 * 1000);
    });

    it("임시 조치로 닫힌 장애를 따로 세어 말한다 — 목록에서는 '복구됨'으로 보인다", () => {
      const summary = summarizeIncidents(
        [
          incident({
            id: "a",
            resolvedAt: new Date("2026-07-30T10:00:00Z"),
            recovery: "재시작",
            fixKind: "temporary",
            temporaryFix: "재시작",
          }),
          incident({
            id: "b",
            resolvedAt: new Date("2026-07-30T10:00:00Z"),
            recovery: "연결 풀 수정",
            fixKind: "permanent",
            permanentFix: "연결 풀 수정",
            rootCause: "풀 크기가 1이었다",
            prevention: "기본값을 바꾸고 테스트를 추가",
          }),
        ],
        now,
      );
      expect(summary.awaitingPermanentFix.map((row) => row.id)).toEqual(["a"]);
      expect(summary.withPrevention).toBe(1);
      expect(summary.withoutRootCause).toBe(1);
      expect(summary.detail).toContain("영구 조치를 기다립니다");
    });

    it("원인이 안 적힌 채 닫힌 장애를 세어 말한다", () => {
      const summary = summarizeIncidents(
        [
          incident({
            resolvedAt: new Date("2026-07-30T10:00:00Z"),
            recovery: "재시작",
            cause: null,
          }),
        ],
        now,
      );
      expect(summary.withoutCause).toBe(1);
      expect(summary.detail).toContain("처음부터 다시 조사");
    });
  });
});
