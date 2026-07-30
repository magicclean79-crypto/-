import { Injectable, NotFoundException } from "@nestjs/common";
import {
  describeGovernanceArchive,
  evaluateContentGovernance,
  planGovernanceArchive,
  resolveGovernanceArchiveAfterDays,
} from "@acos/core";
import type { ContentGovernanceVerdict } from "@acos/core";
import type {
  ContentGovernanceDto,
  ContentGovernanceRecordDto,
  GovernanceCheckDto,
} from "@acos/shared";
import { PrismaService } from "../prisma/prisma.service";
import { GovernanceRulesService } from "./governance-rules.service";

interface ContentWithSource {
  id: string;
  projectId: string;
  status: string;
  title: string;
  body: string;
  productObject: {
    version: number;
    status: string;
    category: string | null;
  } | null;
}

/**
 * Content Governance. (TASK-2501, Sprint 25)
 *
 * **발행 판정의 단일 원천이다.**
 *
 * 미리보기(`GET …/governance`)와 실제 발행 게이트가 **같은 함수를 부른다** —
 * 화면이 "발행할 수 있다"고 했는데 누르면 막히는 상태를 구조적으로 없앤다
 * (CTO 결정 2301-①과 같은 이유).
 *
 * 판정 결과는 **기록한다.** 규칙은 나중에 바뀌므로, "왜 이게 발행됐지"에
 * 답하려면 그때의 기준이 남아 있어야 한다. 막힌 기록도 남는다 — 무엇이
 * 막았고 언제 풀렸는지가 없으면 "왜 이렇게 늦게 발행됐지"에 답할 수 없다.
 */
@Injectable()
export class ContentGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: GovernanceRulesService,
  ) {}

  /** 판정만 — 전이도, 기록도 하지 않는다 (발행 전 확인용) */
  async evaluate(
    projectId: string,
    contentId: string,
  ): Promise<ContentGovernanceDto> {
    const content = await this.loadContent(projectId, contentId);
    const verdict = await this.judge(content);
    return {
      projectId,
      contentId: content.id,
      contentStatus: content.status as ContentGovernanceDto["contentStatus"],
      status: verdict.status,
      checks: verdict.checks,
      blockers: verdict.blockers,
      publishable: verdict.publishable,
      appliedRules: verdict.appliedRules,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * 이미 읽어 둔 콘텐츠로 판정한다 — 발행 게이트가 쓰는 입구.
   *
   * 발행 트랜잭션은 콘텐츠를 이미 읽었으므로 다시 읽지 않는다. 다시 읽으면
   * **판정한 내용과 발행되는 내용이 다를 수 있다.**
   */
  async judge(content: ContentWithSource): Promise<ContentGovernanceVerdict> {
    const [bannedWords, disclosures, relatedRules] = await Promise.all([
      this.rules.bannedWords(),
      this.rules.disclosures(),
      this.rules.relatedRules(content.projectId, content.title),
    ]);

    return evaluateContentGovernance({
      content: {
        status: content.status as ContentGovernanceDto["contentStatus"],
        title: content.title,
        body: content.body,
        productObject: content.productObject,
      },
      bannedWords: bannedWords.value,
      disclosures: disclosures.value,
      // 미설정과 형식 오류를 구분해 전달한다 — 해야 할 일이 다르다
      ruleSources: {
        bannedWords: bannedWords.source,
        disclosures: disclosures.source,
      },
      relatedRules,
    });
  }

  /**
   * 판정 기록 저장 (TASK-2501).
   *
   * `published`는 **이 판정으로 실제 발행이 이뤄졌는지**다. 판정이 통과여도
   * 다른 이유로 전이가 실패할 수 있으므로, 판정 결과와 결과적 발행 여부를
   * 따로 남긴다 — 둘을 하나로 쓰면 기록이 사실과 어긋난다.
   */
  async record(
    contentId: string,
    verdict: ContentGovernanceVerdict,
    options: { published: boolean; actor: string | null },
  ): Promise<void> {
    await this.prisma.contentGovernanceCheck.create({
      data: {
        contentId,
        status: verdict.status,
        published: options.published,
        blockedBy: verdict.blockers.map((check) => check.key),
        checks: verdict.checks as unknown as object,
        appliedRules: verdict.appliedRules as unknown as object,
        actor: options.actor,
      },
    });
  }

  /**
   * 판정 기록 이력 — 최신순.
   *
   * **보관된 것은 기본으로 담지 않는다** (CTO 결정 2501-⑤) — 보관은 현황에서
   * 비켜 두는 것이다. 다만 `includeArchived`로 볼 수 있다: 삭제한 것이
   * 아니므로 볼 길이 없으면 보관이 사실상 삭제가 된다.
   */
  async history(
    projectId: string,
    contentId: string,
    options: { limit?: number; includeArchived?: boolean } = {},
  ): Promise<ContentGovernanceRecordDto[]> {
    await this.loadContent(projectId, contentId);
    const rows = await this.prisma.contentGovernanceCheck.findMany({
      where: {
        contentId,
        ...(options.includeArchived ? {} : { archivedAt: null }),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 20,
    });
    return rows.map((row) => ({
      id: row.id,
      contentId: row.contentId,
      status: row.status as ContentGovernanceRecordDto["status"],
      published: row.published,
      blockedBy: row.blockedBy,
      checks: (row.checks ?? []) as unknown as GovernanceCheckDto[],
      appliedRules: (row.appliedRules ?? {
        bannedWordCount: null,
        disclosureIds: null,
      }) as unknown as ContentGovernanceRecordDto["appliedRules"],
      actor: row.actor,
      createdAt: row.createdAt.toISOString(),
      archivedAt: row.archivedAt?.toISOString() ?? null,
    }));
  }

  /** 보관 유예(일) — 기본 90일 (CTO 결정 2501-⑤) */
  get archiveAfterDays(): number {
    return resolveGovernanceArchiveAfterDays(
      process.env as Record<string, string | undefined>,
    );
  }

  /**
   * 판정 기록 보관 (CTO 결정 2501-⑤).
   *
   * **삭제하지 않는다.** `archivedAt`을 찍어 현황 조회에서 비켜 둘 뿐이다.
   * 기준은 **작성 시각**이다 — 판정 기록에는 해소라는 개념이 없다.
   *
   * 이미 보관된 것은 다시 건드리지 않는다(`archivedAt: null` 조건) — 다시
   * 찍으면 언제 보관했는지가 바뀌어 버린다.
   */
  async archive(): Promise<{
    archived: number;
    afterDays: number;
    detail: string;
  }> {
    const afterDays = this.archiveAfterDays;
    const { cutoff } = planGovernanceArchive({
      afterDays,
      now: Date.now(),
    });

    const { count } = await this.prisma.contentGovernanceCheck.updateMany({
      where: { archivedAt: null, createdAt: { lte: new Date(cutoff) } },
      data: { archivedAt: new Date() },
    });

    return {
      archived: count,
      afterDays,
      detail: describeGovernanceArchive(count, afterDays),
    };
  }

  private async loadContent(
    projectId: string,
    contentId: string,
  ): Promise<ContentWithSource> {
    const record = await this.prisma.content.findFirst({
      where: { id: contentId, projectId },
      include: {
        productObject: {
          select: { version: true, status: true, category: true },
        },
      },
    });
    if (!record) {
      throw new NotFoundException(`콘텐츠를 찾을 수 없습니다: ${contentId}`);
    }
    return {
      id: record.id,
      projectId: record.projectId,
      status: record.status,
      title: record.title,
      body: record.body,
      productObject: record.productObject
        ? {
            version: record.productObject.version,
            status: record.productObject.status,
            category: record.productObject.category,
          }
        : null,
    };
  }
}
