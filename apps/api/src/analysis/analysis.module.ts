import { Logger, Module } from "@nestjs/common";
import { MockAnalysisProvider, type AnalysisProvider } from "@acos/core";
import { ANALYSIS_PROVIDER } from "./analysis.constants";
import { AnalysisController } from "./analysis.controller";
import { AnalysisService } from "./analysis.service";
import { PrismaAnalysisRunStore } from "./prisma-analysis-run.store";

/**
 * ANALYSIS_PROVIDER 환경 변수로 Provider를 선택한다. (기본: mock)
 *
 * 새 모델(Claude, OpenAI, Gemini 등)은 @acos/core의 AnalysisProvider를
 * 구현한 뒤 여기에 case 하나만 추가하면 된다.
 * 자세한 방법: docs/architecture/analysis.md
 */
function createAnalysisProvider(): AnalysisProvider {
  const name = (process.env.ANALYSIS_PROVIDER ?? "mock").toLowerCase();
  switch (name) {
    case "mock":
      return new MockAnalysisProvider();
    default:
      new Logger("AnalysisModule").warn(
        `알 수 없는 ANALYSIS_PROVIDER "${name}" — mock으로 대체합니다.`,
      );
      return new MockAnalysisProvider();
  }
}

@Module({
  controllers: [AnalysisController],
  providers: [
    AnalysisService,
    PrismaAnalysisRunStore,
    {
      provide: ANALYSIS_PROVIDER,
      useFactory: createAnalysisProvider,
    },
  ],
})
export class AnalysisModule {}
