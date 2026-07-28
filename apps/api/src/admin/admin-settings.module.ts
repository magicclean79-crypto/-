import { Global, Module } from "@nestjs/common";
import { AdminSettingsService } from "./admin-settings.service";

/**
 * 설정 오버라이드 전역 모듈. (TASK-1201)
 *
 * LLM 계층(라우팅·예산·실험)이 호출마다 참조하므로 전역으로 둔다.
 * 콘솔 컨트롤러(AdminModule)와 분리한 이유는 **순환 의존을 만들지 않기
 * 위해서**다 — AdminModule은 LlmModule을 쓰고, LlmModule은 이 설정을 쓴다.
 */
@Global()
@Module({
  providers: [AdminSettingsService],
  exports: [AdminSettingsService],
})
export class AdminSettingsModule {}
