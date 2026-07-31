import { judgeAuditAction, summarizeAuditBody } from "./audit";

/**
 * 운영 감사 기록 검증. (TASK-3801 — CTO 정책 3801-④)
 *
 * 지키는 것: **조회는 남기지 않는다**, **모르는 경로도 남긴다**,
 * **비밀은 값까지 남기지 않는다**.
 */
describe("운영 감사 기록 (TASK-3801)", () => {
  describe("행동 판정", () => {
    it("조회는 감사 대상이 아니다 — 화면 한 번에 대여섯 개가 불린다", () => {
      expect(judgeAuditAction("GET", "/ops/kpi")).toBeNull();
      expect(judgeAuditAction("HEAD", "/ops/incidents")).toBeNull();
    });

    it("스모크 실행에 이름을 붙인다", () => {
      const action = judgeAuditAction("POST", "/ops/smoke");
      expect(action?.action).toBe("smoke.run");
      expect(action?.title).toContain("과금");
    });

    it("경로의 id는 대상으로 떼어 낸다 — 행동 이름이 id마다 달라지면 셀 수 없다", () => {
      const action = judgeAuditAction(
        "POST",
        "/ops/incidents/cms86qrep00077ddf5jjc03uf/resolve",
      );
      expect(action?.action).toBe("incident.resolve");
      expect(action?.target).toBe("cms86qrep00077ddf5jjc03uf");
    });

    it("장애 생성에 알맞은 이름을 붙인다 — `incident.run`은 '장애를 실행했다'로 읽힌다", () => {
      const action = judgeAuditAction("POST", "/ops/incidents");
      expect(action?.action).toBe("incident.open");
      expect(action?.title).toBe("장애 기록 생성");
    });

    it("이름을 못 붙인 경로도 남긴다 — 빠진 감사 기록은 실패하지 않는다", () => {
      const action = judgeAuditAction("POST", "/ops/something-new");
      expect(action).not.toBeNull();
      expect(action?.title).toContain("/ops/something-new");
    });

    it("조회를 POST로 받는 경로는 빼 둔다 — 소음이 진짜 변경을 묻는다", () => {
      expect(judgeAuditAction("POST", "/company-brain/query")).toBeNull();
    });

    it("질의 문자열은 이름에 섞이지 않는다", () => {
      expect(judgeAuditAction("POST", "/ops/checks/run?job=backup")?.action).toBe(
        "checks.run",
      );
    });
  });

  describe("본문 요약", () => {
    it("비밀로 보이는 항목은 값을 남기지 않는다", () => {
      const summary = summarizeAuditBody({
        apiKey: "sk-proj-abcdef",
        s3SecretKey: "xyz",
        password: "hunter2",
      });
      expect(summary).toContain("apiKey=***");
      expect(summary).not.toContain("sk-proj");
      expect(summary).not.toContain("hunter2");
    });

    it("판단의 근거가 되는 짧은 열거값은 남긴다 — 누가 CRITICAL을 열었는지 알아야 한다", () => {
      const summary = summarizeAuditBody({
        severity: "CRITICAL",
        component: "llm",
        fixKind: "temporary",
      });
      expect(summary).toContain("severity=CRITICAL");
      expect(summary).toContain("fixKind=temporary");
    });

    it("긴 자유 서술은 이름만 남긴다 — 감사 기록이 본문 보관소가 되면 안 된다", () => {
      const summary = summarizeAuditBody({
        summary: "아주 긴 장애 설명이 여기에 계속 이어집니다 그리고 더 이어집니다",
      });
      expect(summary).toBe("summary");
    });

    it("본문이 없으면 null이다", () => {
      expect(summarizeAuditBody(undefined)).toBeNull();
      expect(summarizeAuditBody({})).toBeNull();
      expect(summarizeAuditBody([1, 2])).toBeNull();
    });
  });
});
