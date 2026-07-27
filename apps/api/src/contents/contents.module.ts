import { Logger, Module } from "@nestjs/common";
import { MockContentGenerator, type ContentGenerator } from "@acos/core";
import { CONTENT_GENERATOR } from "./contents.constants";
import { ContentsController } from "./contents.controller";
import { ContentsService } from "./contents.service";

/**
 * CONTENT_GENERATOR 환경 변수로 Generator를 선택한다. (기본: mock)
 * 새 모델은 @acos/core의 ContentGenerator를 구현한 뒤 case를 추가한다.
 */
function createContentGenerator(): ContentGenerator {
  const name = (process.env.CONTENT_GENERATOR ?? "mock").toLowerCase();
  switch (name) {
    case "mock":
      return new MockContentGenerator();
    default:
      new Logger("ContentsModule").warn(
        `알 수 없는 CONTENT_GENERATOR "${name}" — mock으로 대체합니다.`,
      );
      return new MockContentGenerator();
  }
}

@Module({
  controllers: [ContentsController],
  providers: [
    ContentsService,
    {
      provide: CONTENT_GENERATOR,
      useFactory: createContentGenerator,
    },
  ],
})
export class ContentsModule {}
