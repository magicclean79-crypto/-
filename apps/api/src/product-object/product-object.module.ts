import { Logger, Module } from "@nestjs/common";
import { MockVisionProvider, type VisionProvider } from "@acos/core";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";
import { VISION_PROVIDER } from "./vision.constants";

/**
 * VISION_PROVIDER 환경 변수로 Provider를 선택한다. (기본: mock)
 *
 * 새 모델(Claude Vision 등)은 @acos/core의 VisionProvider를 구현한 뒤
 * 여기에 case 하나만 추가하면 된다. 자세한 방법: docs/architecture/vision.md
 */
function createVisionProvider(): VisionProvider {
  const name = (process.env.VISION_PROVIDER ?? "mock").toLowerCase();
  switch (name) {
    case "mock":
      return new MockVisionProvider();
    default:
      new Logger("ProductObjectModule").warn(
        `알 수 없는 VISION_PROVIDER "${name}" — mock으로 대체합니다.`,
      );
      return new MockVisionProvider();
  }
}

@Module({
  controllers: [ProductObjectController],
  providers: [
    ProductObjectService,
    {
      provide: VISION_PROVIDER,
      useFactory: createVisionProvider,
    },
  ],
  exports: [ProductObjectService],
})
export class ProductObjectModule {}
