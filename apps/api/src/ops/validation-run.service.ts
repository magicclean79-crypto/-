import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { judgeRunGate } from "@acos/core";
import type { Prisma } from "@prisma/client";
import type {
  ValidationExecutionDto,
  ValidationRunDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { DiagnosticsService } from "./diagnostics.service";
import { ProductionCutoverService } from "./production-cutover.service";
import { ProductionSmokeService } from "./production-smoke.service";
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
    private readonly prisma: PrismaService,
    private readonly smoke: ProductionSmokeService,
    private readonly cutover: ProductionCutoverService,
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

  /**
   * 실 Production Validation을 **실제로 수행한다**. (TASK-4501, CTO 정책 4501-④)
   *
   * 정책 ④는 "네 가지가 준비되는 즉시 수행한다"입니다. 그 "즉시"를 사람의
   * 손에 두면 준비가 끝난 날과 검증한 날 사이에 며칠이 생기고, 그 사이에
   * 무엇이 바뀌었는지는 아무도 모릅니다. 그래서 실행을 코드로 둡니다 —
   * **다만 잠금은 그대로입니다.** 준비되지 않았으면 여기서도 403입니다.
   *
   * 세 가지를 지킵니다:
   *
   * 1. **되돌릴 수 없는 것을 뒤에.** 잠금 확인(읽기) → 스모크(실 호출) →
   *    전환 확인(읽기) 순입니다. 실제로 돈이 나가는 것은 두 번째부터입니다.
   * 2. **스텁 응답은 성공이 아닙니다.** 실 호출이 하나도 없었으면
   *    `failed`입니다 — 스텁을 상대로 한 초록을 성공으로 남기면 그 기록이
   *    나중에 실연결의 증거로 읽힙니다.
   * 3. **실패도 기록합니다.** 실패한 검증을 지우면 "몇 번 만에 됐는가"에
   *    답할 수 없고, 그러면 마지막 한 번만 보고 판단하게 됩니다.
   */
  async execute(
    actorId?: string,
    now = Date.now(),
  ): Promise<ValidationExecutionDto> {
    const gate = await this.assertRunnable(now);

    const run = await this.prisma.validationRun.create({
      data: {
        status: "running",
        targetUrl: gate.target.url,
        targetHost: gate.target.host,
        tier: gate.tier,
        steps: [] as unknown as Prisma.InputJsonValue,
        detail: "검증을 시작했습니다.",
        startedBy: actorId ?? null,
      },
    });

    const steps: { id: string; title: string; ok: boolean; detail: string }[] = [
      {
        id: "gate",
        title: "실행 잠금 통과",
        ok: true,
        detail: gate.detail,
      },
    ];
    let realCalls = 0;
    let stubbedCalls = 0;
    let error: string | null = null;

    try {
      // 여기부터 외부에 요청이 나가고 과금됩니다.
      const smoke = await this.smoke.run(actorId);
      realCalls = smoke.results.filter((row) => row.status === "passed").length;
      stubbedCalls = smoke.results.filter((row) => row.status === "stubbed").length;
      steps.push({
        id: "smoke",
        title: "실 호출 스모크",
        ok: realCalls === smoke.results.length && stubbedCalls === 0,
        detail:
          `실 호출 ${realCalls}/${smoke.results.length} 통과 · ` +
          `스텁 응답 ${stubbedCalls}건.`,
      });

      const cutover = await this.cutover.report();
      const notProduction = cutover.dependencies.filter(
        (row) => row.status === "not-production",
      ).length;
      steps.push({
        id: "cutover",
        title: "실 Provider 전환 확인",
        ok:
          cutover.summary.total > 0 &&
          cutover.summary.verified === cutover.summary.total &&
          notProduction === 0,
        detail:
          `전환 검증 ${cutover.summary.verified}/${cutover.summary.total} · ` +
          `공식 주소가 아닌 대상 ${notProduction}건.`,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      steps.push({
        id: "error",
        title: "검증 중단",
        ok: false,
        detail: `검증 도중 실패했습니다: ${error}`,
      });
    }

    // 스텁 응답이 하나라도 있으면 성공이 아닙니다 — 우리가 확인한 것은
    // 우리 스텁이지 Provider가 아닙니다.
    const ok =
      error === null && steps.every((step) => step.ok) && stubbedCalls === 0 && realCalls > 0;
    const detail = ok
      ? `실 Production Validation 성공 — 실 호출 ${realCalls}건, 스텁 응답 0건.`
      : `실 Production Validation 실패 — ` +
        steps
          .filter((step) => !step.ok)
          .map((step) => step.title)
          .join(" · ") +
        (stubbedCalls > 0
          ? ` (스텁 응답 ${stubbedCalls}건 — 스텁을 상대로 한 초록은 성공이 아닙니다)`
          : "");

    const saved = await this.prisma.validationRun.update({
      where: { id: run.id },
      data: {
        status: ok ? "success" : "failed",
        steps: steps as unknown as Prisma.InputJsonValue,
        realCalls,
        stubbedCalls,
        detail,
        error,
        completedAt: new Date(),
      },
    });

    this.logger.log(`실 Production Validation: ${detail}`);
    return toExecutionDto(saved);
  }

  /**
   * 마지막 검증 실행 — 없으면 null.
   *
   * **행이 없는 것은 실패가 아니라 아직 안 한 것입니다.** 다만 Go-Live에는
   * 둘 다 통과가 아닙니다.
   */
  async latest(): Promise<ValidationExecutionDto | null> {
    const row = await this.prisma.validationRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    return row === null ? null : toExecutionDto(row);
  }
}

interface ValidationRunRecord {
  id: string;
  status: string;
  targetUrl: string | null;
  targetHost: string | null;
  tier: string;
  steps: unknown;
  realCalls: number;
  stubbedCalls: number;
  detail: string;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

function toExecutionDto(row: ValidationRunRecord): ValidationExecutionDto {
  return {
    id: row.id,
    status: row.status as ValidationExecutionDto["status"],
    targetUrl: row.targetUrl,
    targetHost: row.targetHost,
    tier: row.tier,
    steps: (Array.isArray(row.steps) ? row.steps : []) as ValidationExecutionDto["steps"],
    realCalls: row.realCalls,
    stubbedCalls: row.stubbedCalls,
    detail: row.detail,
    error: row.error,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}
