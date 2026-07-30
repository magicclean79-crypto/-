import { Injectable, Logger } from "@nestjs/common";
import { ROLLOUT_EVIDENCE_WINDOW_DAYS, judgeProductionCutover } from "@acos/core";
import type { ProductionCutoverDto } from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { CiStatusService } from "./ci-status.service";

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
  ) {}

  async report(branch?: string): Promise<ProductionCutoverDto> {
    const since = new Date(
      Date.now() - ROLLOUT_EVIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const [llmGroups, ocrGroups, storage, workflow, runs] = await Promise.all([
      this.prisma.execution.groupBy({
        by: ["provider"],
        where: {
          status: "SUCCESS",
          provider: { not: "mock" },
          createdAt: { gte: since },
        },
        _count: { _all: true },
      }),
      this.prisma.ocrResult.groupBy({
        by: ["provider"],
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
    ]);

    const report = judgeProductionCutover({
      env: process.env as Record<string, string | undefined>,
      llmSuccesses: countByProvider(llmGroups),
      ocrSuccesses: countByProvider(ocrGroups),
      storage,
      // 워크플로 파일을 못 읽었으면 CI 판정 자체를 하지 않는다
      ci: workflow === null ? null : { workflow, runs },
    });

    return {
      dependencies: report.dependencies,
      summary: report.summary,
      ready: report.ready,
      detail: report.detail,
      evidenceWindowDays: ROLLOUT_EVIDENCE_WINDOW_DAYS,
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

/** groupBy 결과를 { provider: 성공 수 }로 — 없는 Provider는 키가 없다 */
function countByProvider(
  groups: { provider: string; _count: { _all: number } }[],
): Record<string, number> {
  return Object.fromEntries(groups.map((group) => [group.provider, group._count._all]));
}
