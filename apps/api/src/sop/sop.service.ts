import { Injectable, NotFoundException } from "@nestjs/common";
import { PRODUCT_CONTENT_SOP, SopEngine } from "@acos/core";
import type { SopStepResult } from "@acos/core";
import type { SopRunDto, SopStepResultDto } from "@acos/shared";
import type { Prisma, SopRun } from "@prisma/client";
import { ContentsService } from "../contents/contents.service";
import { OcrService } from "../ocr/ocr.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProductObjectService } from "../product-object/product-object.service";

function stepToDto(step: SopStepResult): SopStepResultDto {
  return {
    key: step.key,
    name: step.name,
    status: step.status,
    output: step.output,
    error: step.error,
    startedAt: step.startedAt?.toISOString() ?? null,
    completedAt: step.completedAt?.toISOString() ?? null,
  };
}

function toDto(record: SopRun): SopRunDto {
  return {
    id: record.id,
    projectId: record.projectId,
    sopKey: record.sopKey,
    status: record.status,
    steps: (record.steps as unknown as SopStepResultDto[]) ?? [],
    startedAt: record.startedAt.toISOString(),
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

/**
 * SOP 실행 서비스 (TASK-0305).
 *
 * @acos/core의 SopEngine에 기본 SOP(product-content)와
 * 기존 서비스(OCR/Product Object/Contents)를 단계 실행자로 연결한다 —
 * 새 파이프라인 로직 없이 기존 기능을 표준 절차로 묶기만 한다.
 * 실행 결과는 SopRun으로 이력 보존된다 (Project : SopRun = 1:N).
 */
@Injectable()
export class SopService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrService,
    private readonly productObject: ProductObjectService,
    private readonly contents: ContentsService,
  ) {}

  /** 기본 SOP(product-content)를 실행하고 이력을 남긴다. */
  async run(projectId: string): Promise<SopRunDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        products: {
          orderBy: { createdAt: "asc" },
          include: {
            images: { orderBy: { createdAt: "asc" }, select: { id: true } },
          },
        },
      },
    });
    if (!project) {
      throw new NotFoundException(`프로젝트를 찾을 수 없습니다: ${projectId}`);
    }
    const imageIds = project.products.flatMap((product) =>
      product.images.map((image) => image.id),
    );

    const engine = new SopEngine(PRODUCT_CONTENT_SOP, {
      // 1) 프로젝트 전체 이미지 OCR 실행 (이력 1:N 누적).
      //    개별 이미지의 OCR 실패는 FAILED 결과로 기록될 뿐 절차를 멈추지 않는다.
      ocr: async () => {
        const results = [];
        for (const imageId of imageIds) {
          const result = await this.ocr.runOcr(imageId);
          results.push({
            imageId,
            status: result.status,
            confidence: result.confidence,
          });
        }
        return {
          imageCount: imageIds.length,
          successCount: results.filter((r) => r.status === "SUCCESS").length,
          results,
        };
      },
      // 2) OCR+Vision 결과를 조립해 새 버전의 Product Object 생성
      assemble: async (context) => {
        const po = await this.productObject.buildAndCreate(context.projectId);
        return {
          productObjectId: po.id,
          version: po.version,
          status: po.status,
          title: po.title,
        };
      },
      // 3) READY 검수 — 필수 조건(제목 + OCR/Vision 요약) 검증 포함 전이
      ready: async (context) => {
        const { version } = context.outputs.assemble as { version: number };
        const po = await this.productObject.updateStatus(
          context.projectId,
          version,
          "READY",
        );
        return { version: po.version, status: po.status };
      },
      // 4) READY 버전에서 상세페이지 생성
      content: async (context) => {
        const { version } = context.outputs.assemble as { version: number };
        const content = await this.contents.generate(context.projectId, {
          productObjectVersion: version,
        });
        return {
          contentId: content.id,
          title: content.title,
          productObjectVersion: content.productObjectVersion,
        };
      },
    });

    const record = await this.prisma.sopRun.create({
      data: {
        projectId,
        sopKey: PRODUCT_CONTENT_SOP.key,
        steps: PRODUCT_CONTENT_SOP.steps.map((step) => ({
          key: step.key,
          name: step.name,
          status: "PENDING",
          output: null,
          error: null,
          startedAt: null,
          completedAt: null,
        })) as unknown as Prisma.InputJsonValue,
      },
    });

    const result = await engine.run(projectId);

    const updated = await this.prisma.sopRun.update({
      where: { id: record.id },
      data: {
        status: result.status,
        steps: result.steps.map(stepToDto) as unknown as Prisma.InputJsonValue,
        completedAt: result.completedAt,
      },
    });
    return toDto(updated);
  }

  /** 프로젝트의 SOP 실행 이력 (최신순) */
  async list(projectId: string): Promise<SopRunDto[]> {
    const records = await this.prisma.sopRun.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
    });
    return records.map(toDto);
  }

  async getById(projectId: string, runId: string): Promise<SopRunDto> {
    const record = await this.prisma.sopRun.findFirst({
      where: { id: runId, projectId },
    });
    if (!record) {
      throw new NotFoundException(`SOP 실행을 찾을 수 없습니다: ${runId}`);
    }
    return toDto(record);
  }
}
