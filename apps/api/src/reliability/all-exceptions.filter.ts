import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import { classifyFailure } from "@acos/core";

import { RequestContextService } from "../common/request-context.service";
import { JobContextService } from "./job-context.service";

/**
 * 전역 예외 필터. (TASK-4603, Sprint 46 — 프로덕션 품질)
 *
 * 지금까지 이 저장소에는 전역 필터가 없었습니다. 그래서 우리가 던진
 * `HttpException`은 잘 나갔지만, **던지지 않은 오류**(라이브러리·드라이버·
 * 예기치 못한 것)는 NestJS 기본 처리로 갔습니다:
 *
 * ```
 * {"statusCode":500,"message":"Internal server error"}
 * ```
 *
 * 이 응답에는 두 문제가 있습니다. 사용자는 **무엇을 해야 하는지** 모르고,
 * 운영자는 **어느 요청이었는지** 모릅니다.
 *
 * ## 기존 동작을 바꾸지 않습니다
 *
 * **`HttpException`은 손대지 않고 그대로 내보냅니다.** 지금까지 만든 모든
 * 400·403·404 응답의 본문·상태 코드가 한 글자도 달라지지 않습니다 — 그것을
 * 바꾸면 화면과 테스트가 함께 깨지고, 이번 스프린트는 기존 기능을 바꾸지
 * 않기로 했습니다.
 *
 * 달라지는 것은 **분류되지 않은 오류 하나뿐**입니다: 원문 대신 사람이 할 수
 * 있는 일을 적고, 요청 id를 함께 실어 로그와 맞춰 볼 수 있게 합니다.
 *
 * ## 원문을 사용자에게 보내지 않습니다
 *
 * 오류 원문에 무엇이 들어 있는지 우리는 미리 알 수 없습니다 — 파일 경로,
 * 쿼리, 때로는 자격 증명. 그래서 원문은 **로그로만** 갑니다.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("Unhandled");

  constructor(
    private readonly requests: RequestContextService,
    private readonly jobs: JobContextService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();

    // **우리가 의도해서 던진 것은 그대로 통과합니다.**
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(body);
      return;
    }

    const trace = this.requests.current();
    const job = this.jobs.current();
    const verdict = classifyFailure(exception);

    // 운영자에게는 감추지 않습니다.
    this.logger.error(
      `[${trace?.requestId ?? "-"}] ${request.method} ${request.url} — ${verdict.operatorDetail}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    // 우리 쪽 문제(500)로 봅니다 — 분류하지 못한 오류를 4xx로 내보내면
    // "네 요청이 잘못됐다"고 말하는 셈이고, 그건 사실이 아닐 수 있습니다.
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      // 사용자가 다음에 할 일이 적힌 문장
      message: verdict.userMessage,
      error: "Internal Server Error",
      // 사람이 로그와 맞춰 볼 수 있는 값 — 이것이 없으면 "저 오류요"라고만
      // 말할 수 있고, 그걸로는 아무도 못 찾습니다.
      requestId: trace?.requestId ?? null,
      ...(job === null ? {} : { jobId: job.jobId }),
    });
  }
}
