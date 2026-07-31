import { Injectable, Logger } from "@nestjs/common";
import { buildLogRecord, formatLogLine, resolveLogLevel, shouldLog } from "@acos/core";
import type { LogLevel } from "@acos/core";

import { PrismaService } from "../prisma/prisma.service";
import { RequestContextService } from "../common/request-context.service";
import { JobContextService } from "./job-context.service";

/**
 * 작업 로그. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 두 곳에 남깁니다:
 *
 * 1. **터미널**(NestJS `Logger`) — 사람이 지금 보는 곳
 * 2. **`job_events`** — 나중에 묶어 보는 곳
 *
 * 둘 중 하나가 실패해도 다른 하나는 남습니다. 그리고 **로그 실패가 작업을
 * 실패시키지 않습니다** — 로그를 남기다 서비스가 죽으면 그건 로그가 아니라
 * 사고입니다.
 *
 * 비밀 가리기는 `@acos/core`의 `redact`가 합니다 — 무엇을 가릴지는
 * 판정이고, 판정은 순수 함수에 둡니다.
 */
@Injectable()
export class JobLoggerService {
  private readonly logger = new Logger("Job");
  /** 등급 선언을 매번 다시 읽지 않는다 — 다만 알 수 없는 값은 한 번 말한다 */
  private minimum: LogLevel | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobContextService,
    private readonly requests: RequestContextService,
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    void this.write("debug", message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    void this.write("info", message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    void this.write("warn", message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    void this.write("error", message, data);
  }

  /** 지금 최소 등급 — 화면에 보여 주기 위해 */
  level(): { level: LogLevel; rejected: string | null } {
    return resolveLogLevel(process.env as Record<string, string | undefined>);
  }

  private async write(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): Promise<void> {
    const minimum = this.minimumLevel();
    if (!shouldLog(level, minimum)) {
      return;
    }

    const trace = this.jobs.current();
    const request = this.requests.current();
    const record = buildLogRecord({
      level,
      // 작업 밖에서 불렸으면 요청 id로라도 묶습니다. 둘 다 없으면 "-"이며,
      // **없는 id를 지어내지 않습니다** — 지어낸 id로 묶으면 서로 다른
      // 작업이 한 줄로 보입니다.
      jobId: trace?.jobId ?? request?.requestId ?? "-",
      stage: trace?.stage ?? "-",
      message,
      data: { ...(data ?? {}), ...(request === null ? {} : { requestId: request.requestId }) },
      now: Date.now(),
    });

    const line = formatLogLine(record);
    if (level === "error") this.logger.error(line);
    else if (level === "warn") this.logger.warn(line);
    else if (level === "info") this.logger.log(line);
    else this.logger.debug(line);

    // 작업에 속하지 않은 로그는 표에 남기지 않습니다 — `job_events`는
    // 작업의 이력이고, 여기에 요청 로그를 섞으면 "이 작업이 무엇을 했나"를
    // 읽을 수 없게 됩니다.
    if (trace === null) {
      return;
    }

    try {
      await this.prisma.jobEvent.create({
        data: {
          jobId: trace.jobId,
          level: record.level,
          stage: record.stage,
          message: record.message,
          data: record.data as never,
        },
      });
    } catch (error) {
      // 로그 실패가 작업을 실패시키지 않습니다.
      this.logger.warn(`작업 로그를 남기지 못했습니다: ${String(error)}`);
    }
  }

  private minimumLevel(): LogLevel {
    if (this.minimum === null) {
      const resolved = this.level();
      if (resolved.rejected !== null) {
        this.logger.warn(
          `LOG_LEVEL에 알 수 없는 값("${resolved.rejected}")이 있어 ` +
            "info로 둡니다 — 바꿨다고 믿는 상태로 두지 않으려고 그대로 적습니다.",
        );
      }
      this.minimum = resolved.level;
    }
    return this.minimum;
  }
}
