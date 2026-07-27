import { Module } from "@nestjs/common";
import { ProductObjectController } from "./product-object.controller";
import { ProductObjectService } from "./product-object.service";

@Module({
  controllers: [ProductObjectController],
  providers: [ProductObjectService],
})
export class ProductObjectModule {}
