import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { ReadinessService } from "./health/readiness.service";
import { AllExceptionsFilter } from "./reliability/all-exceptions.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.WEB_URL ?? "http://localhost:3000",
    // httpOnly 세션 쿠키(TASK-0803)를 교차 출처 요청에도 실어 보낼 수 있게 허용
    credentials: true,
  });

  // 전역 예외 필터 (TASK-4603) — **HttpException은 그대로 통과합니다.**
  // 지금까지 만든 400·403·404 응답의 본문과 상태 코드가 한 글자도
  // 달라지지 않습니다. 달라지는 것은 분류되지 않은 오류 하나뿐이며,
  // 그때 원문 대신 사람이 할 수 있는 일과 요청 id를 돌려줍니다.
  app.useGlobalFilters(app.get(AllExceptionsFilter));

  // Startup Validation (TASK-1202) — 환경을 먼저 검증한다.
  // 운영에서 오류가 있으면 **기동하지 않는다**: 잘못된 설정으로 뜬 서버는
  // 조용히 오작동하다가 더 큰 사고를 만든다. 개발에서는 경고만 남기고 뜬다.
  const startup = app.get(ReadinessService).validateOnStartup();
  if (!startup.ok && startup.fatal) {
    Logger.error(
      "환경 검증에 실패해 기동을 중단합니다 — 위 오류를 해결한 뒤 다시 시작하세요.",
      "Bootstrap",
    );
    await app.close();
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API server is running on http://localhost:${port}`, "Bootstrap");
}

bootstrap();
