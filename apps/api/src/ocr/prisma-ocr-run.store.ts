import { Injectable, Optional } from "@nestjs/common";
import { estimateOcrCost, resolveCallTarget } from "@acos/core";
import type { OcrRecognition, OcrRun, OcrRunStore } from "@acos/core";
import { Prisma, type OcrResult } from "@prisma/client";
import { PricingService } from "../pricing/pricing.service";
import { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";

export function toOcrRun(record: OcrResult): OcrRun {
  return {
    id: record.id,
    imageId: record.imageId,
    provider: record.provider,
    status: record.status,
    extractedText: record.extractedText,
    confidence: record.confidence,
    rawJson: record.rawJson,
    error: record.error,
    attempts: record.attempts,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
  };
}

/**
 * OcrRunStore(Port)의 Prisma 어댑터.
 * 실행마다 새 레코드를 만들어 Image당 실행 이력(1:N)을 보존한다.
 */
@Injectable()
export class PrismaOcrRunStore implements OcrRunStore {
  constructor(
    private readonly prisma: PrismaService,
    // 단가는 승인·적용된 가격표에서 온다 (TASK-3101, CTO 정책 3101-①)
    @Optional() private readonly pricing?: PricingService,
    // 요청 추적 (TASK-3601, CTO 정책 3601-②) — 미주입이면 기록에 남지 않는다
    @Optional() private readonly requestContext?: RequestContextService,
  ) {}

  async start(imageId: string, provider: string): Promise<OcrRun> {
    const record = await this.prisma.ocrResult.create({
      data: {
        imageId,
        provider,
        status: "RUNNING",
        startedAt: new Date(),
        // 어느 프로젝트의 비용인가 (TASK-4301, CTO 정책 4301-②).
        // **짐작이 아니라 조인입니다** — 이미지는 상품에, 상품은 프로젝트에
        // 붙어 있고 그 연결은 기록에 이미 있던 사실입니다. 연결이 없으면
        // (상품에 안 붙은 이미지) null이며, null은 "공용"이 아니라
        // "모른다"입니다.
        projectId: await this.projectOf(imageId),
      },
    });
    return toOcrRun(record);
  }

  /**
   * 이미지 → 상품 → 프로젝트.
   *
   * 읽지 못하면 `null`입니다 — 조회가 실패했다고 OCR을 실패시키지 않습니다
   * (비용 귀속은 부수적인 일이고, 그것 때문에 본 기능이 멈추면 안 됩니다).
   */
  private async projectOf(imageId: string): Promise<string | null> {
    try {
      const image = await this.prisma.image.findUnique({
        where: { id: imageId },
        select: { product: { select: { projectId: true } } },
      });
      return image?.product?.projectId ?? null;
    } catch {
      return null;
    }
  }

  /**
   * 성공 기록 — **비용도 함께 남긴다** (TASK-3001, CTO 결정 2901-④).
   *
   * 비용은 성공한 호출에만 붙입니다. 실패한 호출도 Provider에 따라 과금될 수
   * 있지만 우리는 그것을 알 수 없고, **모르는 것을 숫자로 적으면 예산이
   * 거짓이 됩니다.** 대신 실패 호출 수는 관측에 그대로 남습니다.
   *
   * 가격표에 없는 엔진은 `null`(미산정)입니다 — 0으로 채우면 예산 상한이
   * 조용히 무력해집니다.
   *
   * 단가는 **적용된 가격표**를 씁니다 (TASK-3101, CTO 정책 3101-①) — 코드
   * 기본값은 아무도 승인하지 않은 값이고, 그 값으로 계산한 비용은 "왜 이
   * 금액인가"에 답할 수 없습니다.
   */
  async markSuccess(
    id: string,
    result: OcrRecognition,
    attempts: number,
  ): Promise<OcrRun> {
    // provider는 start()가 남긴 값이 진실이다 — 다시 추측하지 않는다
    const current = await this.prisma.ocrResult.findUniqueOrThrow({
      where: { id },
      select: { provider: true, units: true },
    });
    const table = this.pricing ? (await this.pricing.effective()).ocr : undefined;
    const cost = estimateOcrCost(current.provider, current.units, table);

    // 이 성공이 **누구를 상대로** 만들어졌는지 남긴다 (TASK-3501, 정책 3501-④).
    // 나중에 환경변수를 다시 읽어 추정하면 그 사이에 설정이 바뀐 경우 과거를
    // 잘못 설명하게 되고, 그 설명이 전환 판정의 근거가 된다.
    const target = resolveCallTarget(
      current.provider,
      process.env as Record<string, string | undefined>,
    );
    const trace = this.requestContext?.current() ?? null;

    const record = await this.prisma.ocrResult.update({
      where: { id },
      data: {
        status: "SUCCESS",
        extractedText: result.text,
        confidence: result.confidence,
        rawJson: result.raw as Prisma.InputJsonValue,
        error: null,
        attempts,
        cost,
        completedAt: new Date(),
        endpoint: target.endpoint,
        baseUrl: target.baseUrl,
        calledAt: new Date(),
        // 한 요청이 부른 호출들을 묶는 끈 (TASK-3601, CTO 정책 3601-②)
        requestId: trace?.requestId ?? null,
        traceId: trace?.traceId ?? null,
      },
    });
    return toOcrRun(record);
  }

  async markFailed(
    id: string,
    error: string,
    attempts: number,
  ): Promise<OcrRun> {
    const record = await this.prisma.ocrResult.update({
      where: { id },
      data: {
        status: "FAILED",
        error,
        attempts,
        completedAt: new Date(),
      },
    });
    return toOcrRun(record);
  }
}
