import { parseExperiment } from "./experiment";
import {
  applyLifecycleAction,
  assignSticky,
  experimentSignature,
  ExperimentLifecycleError,
  hashToUnitInterval,
  resolveLifecycle,
} from "./experiment-lifecycle";

const EXPERIMENT = parseExperiment(
  "product-analysis",
  "canary|openai=80,anthropic=20",
)!;
const AVAILABLE = ["openai", "anthropic"];

describe("Sticky Assignment & Experiment Lifecycle (TASK-1101)", () => {
  describe("결정적 해시", () => {
    it("같은 입력은 항상 같은 값, 범위는 [0,1)", () => {
      const first = hashToUnitInterval("sig|proj-1");
      expect(hashToUnitInterval("sig|proj-1")).toBe(first);
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(1);
    });

    it("연속적인 키(proj-0, proj-1, …)도 뭉치지 않는다", () => {
      // FNV만 쓰면 순번 ID가 비슷한 값으로 몰려 배정이 한쪽으로 쏠린다.
      // 최종 혼합(fmix32)이 이를 막는지 소표본으로 확인한다.
      const values = Array.from({ length: 12 }, (_, i) =>
        hashToUnitInterval(`openai=50,anthropic=50|proj-${i}`),
      );
      const low = values.filter((value) => value < 0.5).length;
      expect(low).toBeGreaterThan(0);
      expect(low).toBeLessThan(12);
    });

    it("입력이 다르면 값이 흩어진다 (분포 확인)", () => {
      const values = Array.from({ length: 200 }, (_, i) =>
        hashToUnitInterval(`sig|proj-${i}`),
      );
      expect(new Set(values).size).toBeGreaterThan(190); // 충돌이 드물다
      const low = values.filter((value) => value < 0.5).length;
      expect(low).toBeGreaterThan(60); // 한쪽으로 쏠리지 않는다
      expect(low).toBeLessThan(140);
    });
  });

  describe("experimentSignature", () => {
    it("변형·가중치가 바뀌면 서명이 바뀐다", () => {
      const base = experimentSignature(EXPERIMENT);
      expect(base).toBe("openai=80,anthropic=20");
      const changed = parseExperiment(
        "product-analysis",
        "canary|openai=70,anthropic=30",
      )!;
      expect(experimentSignature(changed)).not.toBe(base);
    });

    it("이름·종류만 달라지면 서명은 같다 (표시용 메타데이터 — 결정 1003-③)", () => {
      const renamed = parseExperiment(
        "product-analysis",
        "새이름|ab|openai=80,anthropic=20",
      )!;
      expect(experimentSignature(renamed)).toBe(experimentSignature(EXPERIMENT));
    });
  });

  describe("assignSticky", () => {
    it("같은 프로젝트는 항상 같은 변형을 받는다 (저장 없이도)", () => {
      const first = assignSticky({
        experiment: EXPERIMENT,
        projectId: "proj-1",
        availableProviders: AVAILABLE,
      });
      for (let i = 0; i < 20; i += 1) {
        expect(
          assignSticky({
            experiment: EXPERIMENT,
            projectId: "proj-1",
            availableProviders: AVAILABLE,
          })?.key,
        ).toBe(first?.key);
      }
      expect(first?.reused).toBe(false);
    });

    it("프로젝트가 다르면 가중치대로 나뉜다", () => {
      const counts: Record<string, number> = { openai: 0, anthropic: 0 };
      for (let i = 0; i < 300; i += 1) {
        const assigned = assignSticky({
          experiment: EXPERIMENT,
          projectId: `proj-${i}`,
          availableProviders: AVAILABLE,
        });
        counts[assigned!.variant.provider] += 1;
      }
      // 80/20 설정 — 해시 분포이므로 정확히 240/60은 아니지만 방향은 분명하다
      expect(counts.openai).toBeGreaterThan(counts.anthropic * 2);
      expect(counts.anthropic).toBeGreaterThan(0);
    });

    it("저장된 배정이 있고 서명이 같으면 그대로 재사용한다", () => {
      const assigned = assignSticky({
        experiment: EXPERIMENT,
        projectId: "proj-1",
        availableProviders: AVAILABLE,
        existing: {
          variantKey: "anthropic",
          signature: experimentSignature(EXPERIMENT),
        },
      });
      expect(assigned).toMatchObject({ key: "anthropic", reused: true });
    });

    it("정의가 바뀌면(서명 불일치) 저장된 배정을 버리고 다시 배정한다", () => {
      const assigned = assignSticky({
        experiment: EXPERIMENT,
        projectId: "proj-1",
        availableProviders: AVAILABLE,
        existing: { variantKey: "anthropic", signature: "낡은서명" },
      });
      expect(assigned?.reused).toBe(false);
      expect(assigned?.signature).toBe(experimentSignature(EXPERIMENT));
    });

    it("저장된 변형을 쓸 수 없으면 사용 가능한 변형으로 다시 배정한다", () => {
      const assigned = assignSticky({
        experiment: EXPERIMENT,
        projectId: "proj-1",
        availableProviders: ["openai"],
        existing: {
          variantKey: "anthropic",
          signature: experimentSignature(EXPERIMENT),
        },
      });
      expect(assigned).toMatchObject({ key: "openai", reused: false });
    });

    it("사용 가능한 변형이 없으면 null", () => {
      expect(
        assignSticky({
          experiment: EXPERIMENT,
          projectId: "proj-1",
          availableProviders: ["mock"],
        }),
      ).toBeNull();
    });
  });

  describe("applyLifecycleAction", () => {
    const running = { status: "RUNNING" as const, promotedVariant: null };

    it("START — RUNNING으로 되돌리고 승자 지정을 해제한다", () => {
      const next = applyLifecycleAction({
        current: { status: "PROMOTED", promotedVariant: "openai" },
        action: "START",
      });
      expect(next).toMatchObject({ status: "RUNNING", promotedVariant: null });
    });

    it("STOP — 중단하되 승자 기록은 남긴다", () => {
      const next = applyLifecycleAction({
        current: { status: "PROMOTED", promotedVariant: "openai" },
        action: "STOP",
      });
      expect(next).toMatchObject({
        status: "STOPPED",
        promotedVariant: "openai",
      });
    });

    it("PROMOTE — 승자를 지정하고 PROMOTED로", () => {
      const next = applyLifecycleAction({
        current: running,
        action: "PROMOTE",
        variantKey: "anthropic",
        availableVariants: ["openai", "anthropic"],
      });
      expect(next).toMatchObject({
        status: "PROMOTED",
        promotedVariant: "anthropic",
      });
      expect(next.from).toEqual(running);
    });

    it("PROMOTE — 변형 미지정·정의에 없는 변형은 거부한다", () => {
      expect(() =>
        applyLifecycleAction({ current: running, action: "PROMOTE" }),
      ).toThrow(ExperimentLifecycleError);
      expect(() =>
        applyLifecycleAction({
          current: running,
          action: "PROMOTE",
          variantKey: "gemini",
          availableVariants: ["openai", "anthropic"],
        }),
      ).toThrow(/현재 실험 정의에 없습니다/);
    });

    it("ROLLBACK — 직전 상태로 복원하고, 이력이 없으면 RUNNING", () => {
      expect(
        applyLifecycleAction({
          current: { status: "PROMOTED", promotedVariant: "openai" },
          action: "ROLLBACK",
          previous: { status: "RUNNING", promotedVariant: null },
        }),
      ).toMatchObject({ status: "RUNNING", promotedVariant: null });

      expect(
        applyLifecycleAction({
          current: { status: "STOPPED", promotedVariant: null },
          action: "ROLLBACK",
        }),
      ).toMatchObject({ status: "RUNNING" });
    });
  });

  describe("resolveLifecycle", () => {
    it("RUNNING이면 배정한다", () => {
      expect(
        resolveLifecycle(
          { status: "RUNNING", promotedVariant: null },
          EXPERIMENT,
          AVAILABLE,
        ),
      ).toEqual({ mode: "assign" });
    });

    it("STOPPED이면 적용하지 않는다", () => {
      const resolved = resolveLifecycle(
        { status: "STOPPED", promotedVariant: null },
        EXPERIMENT,
        AVAILABLE,
      );
      expect(resolved.mode).toBe("skip");
    });

    it("PROMOTED이면 승자 변형으로 전 트래픽을 보낸다", () => {
      const resolved = resolveLifecycle(
        { status: "PROMOTED", promotedVariant: "anthropic" },
        EXPERIMENT,
        AVAILABLE,
      );
      expect(resolved).toMatchObject({
        mode: "promoted",
        variant: { provider: "anthropic" },
      });
    });

    it("승자가 정의에 없거나 Provider를 쓸 수 없으면 라우팅으로 내려간다", () => {
      expect(
        resolveLifecycle(
          { status: "PROMOTED", promotedVariant: "gemini" },
          EXPERIMENT,
          AVAILABLE,
        ),
      ).toMatchObject({ mode: "skip" });
      expect(
        resolveLifecycle(
          { status: "PROMOTED", promotedVariant: "anthropic" },
          EXPERIMENT,
          ["openai"],
        ),
      ).toMatchObject({ mode: "skip" });
    });
  });
});
