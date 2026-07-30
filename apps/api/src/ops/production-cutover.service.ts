import { Injectable, Logger } from "@nestjs/common";
import {
  ROLLOUT_EVIDENCE_WINDOW_DAYS,
  isOfficialCall,
  judgeProductionCutover,
} from "@acos/core";
import { judgeActivation } from "@acos/core";
import type { SuccessCount } from "@acos/core";
import type { ProductionActivationDto, ProductionCutoverDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CiStatusService } from "./ci-status.service";
import { EgressService } from "./egress.service";

/**
 * 운영 전환 검증. (TASK-3401, Sprint 34 — CTO 지시 4·5·6)
 *
 * `provider-rollout`(TASK-2901)은 "성공한 실행 기록이 있으면 연결됨"으로
 * 판정합니다. 그 기록이 **계약 스텁을 상대로** 만들어졌다면 화면은 붙지 않은
 * 시스템을 붙었다고 보고합니다 — 우리가 가장 경계해 온 조용한 실패입니다.
 *
 * 그래서 이 서비스는 **상대가 누구였는지**를 함께 모읍니다: 엔드포인트가
 * 공식 주소인지, 저장소가 실제 S3인지, CI가 초록으로 끝났는지.
 *
 * 모아 온 사실로 판정하는 것은 `@acos/core`이고, 여기서는 **가져오기만**
 * 합니다. 가져오지 못한 것은 `null`로 넘깁니다 — 못 본 것을 통과로 바꾸지
 * 않습니다.
 */
@Injectable()
export class ProductionCutoverService {
  private readonly logger = new Logger(ProductionCutoverService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ci: CiStatusService,
    // 자격 증명 이전의 조건 (TASK-3501, CTO 지시 2·3)
    private readonly egress: EgressService,
  ) {}

  async report(branch?: string): Promise<ProductionCutoverDto> {
    const since = new Date(
      Date.now() - ROLLOUT_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [llmGroups, ocrGroups, storage, workflow, runs, egress] = await Promise.all([
      // **호출 대상까지 함께 센다** (TASK-3501, CTO 정책 3501-⑤) — "성공했다"만
      // 으로는 누구를 상대로 성공했는지 알 수 없다. baseUrl이 null인 옛 기록은
      // 공식으로 세지 않는다: null은 "공식이었다"가 아니라 "모른다"다.
      this.prisma.execution.groupBy({
        by: ["provider", "baseUrl"],
        where: {
          status: "SUCCESS",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.ocrResult.groupBy({
        by: ["provider", "baseUrl"],
        where: {
          status: "SUCCESS",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.probeStorage(),
      Promise.resolve(this.ci.workflow()),
      this.ci.runs(branch),
      this.egress.probe(),
    ]);

    const report = judgeProductionCutover({
      env: process.env as Record<string, string | undefined>,
      llmSuccesses: countByTarget(llmGroups),
      ocrSuccesses: countByTarget(ocrGroups),
      // 이 환경이 전환 대상인가 (CTO 정책 3501-①)
      environment: process.env.NODE_ENV,
      storage,
      // 워크플로 파일을 못 읽었으면 CI 판정 자체를 하지 않는다
      ci: workflow === null ? null : { workflow, runs },
      egress,
    });

    return {
      dependencies: report.dependencies,
      summary: report.summary,
      ready: report.ready,
      detail: report.detail,
      evidenceWindowDays: ROLLOUT_EVIDENCE_WINDOW_DAYS,
      applicable: report.applicable,
      environment: report.environment,
      egress,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * 운영 활성화 판정 (TASK-3601, CTO 정책 3601-①).
   *
   * 자격 증명 · 네트워크 · 전환 판정 **세 조건이 모두** 충족될 때만 완료로
   * 인정합니다. 하나로 뭉친 초록불은 "무엇이 남았는지"를 말하지 못합니다.
   */
  async activation(branch?: string): Promise<ProductionActivationDto> {
    const cutover = await this.report(branch);
    const judged = judgeActivation({
      env: process.env as Record<string, string | undefined>,
      egress: cutover.egress as never,
      cutover: {
        ready: cutover.ready,
        applicable: cutover.applicable,
        environment: cutover.environment,
        detail: cutover.detail,
      },
    });
    return {
      conditions: judged.conditions,
      activated: judged.activated,
      applicable: judged.applicable,
      environment: judged.environment,
      detail: judged.detail,
      checkedAt: new Date().toISOString(),
    };
  }

  /** 저장소에 실제로 닿아 본다 — 못 닿으면 그 사실을 그대로 넘긴다 */
  private async probeStorage(): Promise<{
    reachable: boolean;
    bucketExists: boolean;
    detail: string;
  } | null> {
    try {
      const exists = await this.storage.bucketExists();
      return {
        reachable: true,
        bucketExists: exists,
        detail: exists
          ? `버킷 ${this.storage.bucket} 확인`
          : `버킷 ${this.storage.bucket}이 없습니다`,
      };
    } catch (error) {
      this.logger.warn(`저장소 점검 실패: ${String(error)}`);
      return { reachable: false, bucketExists: false, detail: String(error) };
    }
  }
}

/**
 * groupBy 결과를 `{ provider: {official, total} }`로 (TASK-3501, 정책 3501-⑤).
 *
 * `official`은 **기록에 남은 호출 대상이 공식 주소인 것만** 셉니다.
 * `baseUrl`이 없는 옛 기록은 `total`에만 들어갑니다 — 모르는 것을 공식으로
 * 세면 판정이 다시 거짓이 됩니다.
 */
function countByTarget(
  groups: { provider: string; baseUrl: string | null; _count: { _all: number } }[],
): Record<string, SuccessCount> {
  const counts: Record<string, SuccessCount> = {};
  for (const group of groups) {
    const row = counts[group.provider] ?? { official: 0, total: 0 };
    row.total += group._count._all;
    if (isOfficialCall(group.provider, group.baseUrl)) {
      row.official += group._count._all;
    }
    counts[group.provider] = row;
  }
  return counts;
}
