import { Injectable, Logger } from "@nestjs/common";
import type { CallHandler, ExecutionContext, NestInterceptor } from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { judgeAuditAction, summarizeAuditBody } from "@acos/core";
import type { OpsAuditDto } from "@acos/shared";
import type { Request, Response } from "express";
import { RequestContextService } from "../common/request-context.service";
import { PrismaService } from "../prisma/prisma.service";

interface AuditedRequest extends Request {
  user?: { id: string; email: string };
}

/**
 * 운영 감사 가로채기. (TASK-3801, Sprint 38 — CTO 정책 3801-④)
 *
 * `/ops/*`의 **변경 요청 전부**를 남깁니다. 각 서비스가 감사 기록을 부르게
 * 하면 다음에 추가되는 엔드포인트에서 누군가 그 한 줄을 빠뜨리고,
 * **빠진 감사 기록은 실패하지 않습니다** — 아무 일도 안 일어나므로 아무도
 * 모르고, 사고가 난 뒤에야 "그 경로는 기록이 없네요"를 알게 됩니다.
 *
 * ## 실패한 시도도 남깁니다
 *
 * 장애 조사에서 가장 자주 필요한 문장은 **"그 시각에 누가 무엇을
 * 눌렀는가"** 입니다. 400·403·500으로 끝난 시도도 그 문장의 답에
 * 들어갑니다 — 특히 **거절된 시도**는 그 자체가 신호입니다.
 *
 * ## 감사 기록 실패가 작업을 막지는 않습니다
 *
 * 다만 조용하지도 않습니다. 기록을 못 남기면 경고를 남깁니다 — 감사가
 * 조용히 비어 가는 것이 이 장치의 유일한 실패 방식이기 때문입니다.
 */
@Injectable()
export class OpsAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(OpsAuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly context: RequestContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuditedRequest>();
    const action = judgeAuditAction(request.method, request.originalUrl ?? request.url);
    if (action === null) {
      return next.handle();
    }

    const startedAt = Date.now();
    const write = (outcome: "ok" | "failed", statusCode: number | null): void => {
      const trace = this.context.current();
      void this.prisma.opsAuditLog
        .create({
          data: {
            action: action.action,
            title: action.title,
            method: request.method.toUpperCase(),
            path: (request.originalUrl ?? request.url).split("?")[0],
            target: action.target,
            actorId: request.user?.id ?? null,
            actorEmail: request.user?.email ?? null,
            outcome,
            statusCode,
            durationMs: Date.now() - startedAt,
            detail: summarizeAuditBody(request.body),
            requestId: trace?.requestId ?? null,
            traceId: trace?.traceId ?? null,
          },
        })
        .catch((error: unknown) => {
          // 조용히 비어 가는 것이 이 장치의 유일한 실패 방식이다
          this.logger.warn(`운영 감사 기록 실패 (${action.action}): ${String(error)}`);
        });
    };

    return next.handle().pipe(
      tap({
        next: () => {
          write("ok", http.getResponse<Response>().statusCode ?? null);
        },
        error: (error: unknown) => {
          const status =
            typeof error === "object" && error !== null && "status" in error
              ? Number((error as { status: unknown }).status)
              : null;
          write("failed", Number.isFinite(status) ? status : null);
        },
      }),
    );
  }
}

/** 감사 기록 조회 — 판정이 없는 단순 조회라 서비스를 따로 두지 않는다 */
@Injectable()
export class OpsAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async recent(options: { limit?: number; action?: string } = {}): Promise<OpsAuditDto[]> {
    const rows = await this.prisma.opsAuditLog.findMany({
      where: options.action ? { action: options.action } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(options.limit ?? 50, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      title: row.title,
      method: row.method,
      path: row.path,
      target: row.target,
      actorEmail: row.actorEmail,
      outcome: row.outcome,
      statusCode: row.statusCode,
      durationMs: row.durationMs,
      detail: row.detail,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
