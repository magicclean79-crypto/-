import { PRODUCT_CONTENT_SOP } from "../sop";
import type { SopDefinition } from "../sop";
import { WorkflowEngine } from "./workflow-engine";
import type { WorkflowStepExecutor } from "./workflow-engine";

const TWO_STEP_SOP: SopDefinition = {
  key: "test-sop",
  name: "테스트 SOP",
  description: "테스트용 2단계 절차",
  steps: [
    { key: "first", name: "1단계" },
    { key: "second", name: "2단계" },
  ],
};

describe("WorkflowEngine", () => {
  it("모든 단계를 순서대로 실행하고 DONE으로 완료한다", async () => {
    const order: string[] = [];
    const engine = new WorkflowEngine(TWO_STEP_SOP, {
      first: async () => {
        order.push("first");
        return { value: 1 };
      },
      second: async () => {
        order.push("second");
        return { value: 2 };
      },
    });

    const result = await engine.run("p1");

    expect(order).toEqual(["first", "second"]);
    expect(result.sopKey).toBe("test-sop");
    expect(result.status).toBe("DONE");
    expect(result.steps.map((step) => step.status)).toEqual(["DONE", "DONE"]);
    expect(result.steps[0].output).toEqual({ value: 1 });
    expect(result.steps.every((step) => step.startedAt && step.completedAt)).toBe(
      true,
    );
  });

  it("앞 단계의 출력을 다음 단계 컨텍스트로 전달한다", async () => {
    let received: unknown;
    const engine = new WorkflowEngine(TWO_STEP_SOP, {
      first: async ({ projectId }) => ({ projectId, version: 3 }),
      second: async ({ outputs }) => {
        received = outputs.first;
        return null;
      },
    });

    await engine.run("p1");

    expect(received).toEqual({ projectId: "p1", version: 3 });
  });

  it("단계 실패 시 해당 단계 FAILED, 이후 단계 SKIPPED, 실행은 FAILED가 된다", async () => {
    const second = jest.fn();
    const engine = new WorkflowEngine(TWO_STEP_SOP, {
      first: async () => {
        throw new Error("boom");
      },
      second,
    });

    const result = await engine.run("p1");

    expect(result.status).toBe("FAILED");
    expect(result.steps[0].status).toBe("FAILED");
    expect(result.steps[0].error).toBe("boom");
    expect(result.steps[1].status).toBe("SKIPPED");
    expect(result.steps[1].startedAt).toBeNull();
    expect(second).not.toHaveBeenCalled();
  });

  it("실행자가 누락된 단계가 있으면 생성 시점에 오류를 던진다", () => {
    expect(
      () => new WorkflowEngine(TWO_STEP_SOP, { first: async () => null }),
    ).toThrow(/second/);
  });

  it("단계 key가 중복되면 생성 시점에 오류를 던진다", () => {
    const dup: SopDefinition = {
      ...TWO_STEP_SOP,
      steps: [
        { key: "first", name: "a" },
        { key: "first", name: "b" },
      ],
    };
    const noop: WorkflowStepExecutor = async () => null;
    expect(() => new WorkflowEngine(dup, { first: noop })).toThrow(/중복/);
  });

  it("기본 SOP(product-content)는 4단계(ocr→assemble→ready→content)를 선언한다", () => {
    expect(PRODUCT_CONTENT_SOP.key).toBe("product-content");
    expect(PRODUCT_CONTENT_SOP.steps.map((step) => step.key)).toEqual([
      "ocr",
      "assemble",
      "ready",
      "content",
    ]);
  });
});
