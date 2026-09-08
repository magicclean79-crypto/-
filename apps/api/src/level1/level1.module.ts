import { Module } from "@nestjs/common";
import { Level1Controller } from "./level1.controller";
import { Level1Service } from "./level1.service";

/**
 * Product Detail Engine LEVEL 1 (T1-188).
 * PrismaModule·StorageModule은 `@Global()`이라 별도 import 없이 주입된다.
 */
@Module({
  controllers: [Level1Controller],
  providers: [Level1Service],
})
export class Level1Module {}
