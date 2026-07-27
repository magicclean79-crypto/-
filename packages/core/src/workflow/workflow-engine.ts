import type { SopRunStatus, SopStepStatus } from "@acos/shared";
import type { SopDefinition } from "../sop/sop-definition";

/** 단계 실행자에게 전달되는 컨텍스트 */
export interface WorkflowStepContext {
  projectId: string;
  /** 앞서 완료된 단계들의 출력 (단계 key → output) — 단계 간 데이터 전달 통로 */
  outputs: Record<string, unknown>;
}

/**
 * 단계 실행자 — SOP 단계 하나를 실제로 수행한다.
 * 반환값은 해당 단계의 output으로 기록되고 이후 단계에 전달된다.
 * 예외를 던지면 단계가 FAILED 처리되고 이후 단계는 SKIPPED 된다.
 */
export type WorkflowStepExecutor = (
  context: WorkflowStepContext,
) => Promise<unknown>;

export interface WorkflowStepResult {
  key: string;
  name: string;
  status: SopStepStatus;
  output: unknown;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface WorkflowRunResult {
  sopKey: string;
  /** 전 단계 DONE이면 DONE, 하나라도 FAILED면 FAILED */
  status: Exclude<SopRunStatus, "RUNNING">;
  steps: WorkflowStepResult[];
  startedAt: Date;
  completedAt: Date;
}

/**
 * Workflow Engine — SOP 실행 계층. (TASK-0305, CTO 리뷰 반영)
 *
 * SOP(Company Brain의 표준 업무 절차 정의)는 도메인이고,
 * 이 엔진은 그 정의를 받아 실행하는 Execution Layer다.
 *
 * 선언된 단계를 순서대로 실행한다:
 * - 각 단계: PENDING → RUNNING → DONE | FAILED
 * - 한 단계가 FAILED면 이후 단계는 실행하지 않고 SKIPPED 처리
 * - 단계 출력은 outputs[key]로 누적되어 이후 단계에 전달된다
 */
export class WorkflowEngine {
  constructor(
    private readonly definition: SopDefinition,
    private readonly executors: Record<string, WorkflowStepExecutor>,
  ) {
    if (definition.steps.length === 0) {
      throw new Error(`SOP "${definition.key}"에 단계가 없습니다.`);
    }
    const seen = new Set<string>();
    for (const step of definition.steps) {
      if (seen.has(step.key)) {
        throw new Error(
          `SOP "${definition.key}"에 중복된 단계 key가 있습니다: ${step.key}`,
        );
      }
      seen.add(step.key);
      if (typeof executors[step.key] !== "function") {
        throw new Error(
          `SOP "${definition.key}"의 단계 "${step.key}"에 실행자(executor)가 없습니다.`,
        );
      }
    }
  }

  async run(projectId: string): Promise<WorkflowRunResult> {
    const startedAt = new Date();
    const outputs: Record<string, unknown> = {};
    const steps: WorkflowStepResult[] = this.definition.steps.map((step) => ({
      key: step.key,
      name: step.name,
      status: "PENDING",
      output: null,
      error: null,
      startedAt: null,
      completedAt: null,
    }));

    let failed = false;
    for (const step of steps) {
      if (failed) {
        step.status = "SKIPPED";
        continue;
      }
      step.status = "RUNNING";
      step.startedAt = new Date();
      try {
        step.output = (await this.executors[step.key]({
          projectId,
          outputs,
        })) ?? null;
        outputs[step.key] = step.output;
        step.status = "DONE";
      } catch (error) {
        step.status = "FAILED";
        step.error = error instanceof Error ? error.message : String(error);
        failed = true;
      }
      step.completedAt = new Date();
    }

    return {
      sopKey: this.definition.key,
      status: failed ? "FAILED" : "DONE",
      steps,
      startedAt,
      completedAt: new Date(),
    };
  }
}
