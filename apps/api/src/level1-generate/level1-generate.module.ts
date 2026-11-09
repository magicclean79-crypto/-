import { Module } from "@nestjs/common";
import { Level1GenerateController } from "./level1-generate.controller";
import { Level1GenerateService } from "./level1-generate.service";

/**
 * LEVEL 1 원샷 상세페이지 생성 모듈 (T1-189).
 * PrismaModule·StorageModule은 `@Global()`이라 별도 import 없이 주입된다.
 * `Level1Module`(T1-188)은 import하지 않는다 — Prisma로 같은 테이블을
 * 직접 읽어 재사용하고, 그 모듈 파일은 건드리지 않는다.
 */
@Module({
  controllers: [Level1GenerateController],
  providers: [Level1GenerateService],
})
export class Level1GenerateModule {}
