import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { judgeRunGate } from "@acos/core";
import type { ValidationRunDto } from "@acos/shared";
import { DiagnosticsService } from "./diagnostics.service";
import { ValidationPlanService } from "./validation-plan.service";

/**
 * 검증 실행 준비와 잠금. (TASK-4101, Sprint 41 — CTO 정책 4101-⑤⑥)
 *
 * 정책 ⑥은 "준비된 이후에만 수행한다"입니다. 이것을 문서로만 적어 두면
 * 규칙이 되고, **사람의 기억에 기대는 규칙은 반드시 다시 어긋납니다.**
 * 실제로 일어나는 모습은 이렇습니다: 검증 날짜가 잡히고, 자격 증명은 아직
 * 안 왔는데, 누군가 "일단 돌려 보자"고 버튼을 누릅니다. 그러면 스텁을
 * 상대로 한 성공 기록이 남고, 그 기록은 나중에 **실연결의 증거로 읽힙니다.**
 *
 * 그래서 코드가 막습니다. 판정은 `@acos/core`가 합니다.
 */
@Injectable()
export class ValidationRunService {
  private readonly logger = new Logger(ValidationRunService.name);

  constructor(
    private readonly plan: ValidationPlanService,
    private readonly diagnostics: DiagnosticsService,
  ) {}

  /** 지금 검증을 실행해도 되는가 — 아무것도 바꾸지 않는다 */
  async gate(now = Date.now()): Promise<ValidationRunDto> {
    const plan = await this.plan.report(now);
    const target = this.diagnostics.validationTarget();
    const tier = this.diagnostics.tier();

    const result = judgeRunGate({
      readiness: plan.readiness as never,
      waitingOnPeople: plan.steps
        .filter((step) => step.owner === "operator" && step.status !== "done" && step.status !== "blocked")
        .map((step) => step.title),
      waitingOnUs: plan.steps
        .filter((step) => step.owner === "system" && step.status !== "done" && step.status !== "blocked")
        .map((step) => step.title),
      blockedSteps: plan.steps
        .filter((step) => step.status === "blocked")
        .map((step) => step.title),
      target: target.verdict,
      tier,
    });

    return {
      verdict: result.verdict,
      blockers: result.blockers,
      steps: result.steps,
      tier,
      target: {
        verdict: target.verdict,
        url: target.url,
        host: target.host,
        usable: target.usable,
        detail: target.detail,
        next: target.next,
      },
      detail: result.detail,
      checkedAt: new Date(now).toISOString(),
    };
  }

  /**
   * 실 호출을 돌리기 직전에 부르는 잠금 (CTO 정책 4101-⑥).
   *
   * **강제로 여는 인자를 받지 않습니다.** 그런 것을 두면 그것이 기본
   * 사용법이 됩니다 — 막는 조건 자체를 없애는 것이 유일한 길입니다.
   */
  async assertRunnable(now = Date.now()): Promise<ValidationRunDto> {
    const gate = await this.gate(now);
    if (gate.verdict !== "allowed") {
      this.logger.warn(`검증 실행을 막았습니다: ${gate.detail}`);
      throw new ForbiddenException(gate.detail);
    }
    return gate;
  }
}
