import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import type {
  CreateProductRequest,
  ProductDetailDto,
  ProductListItemDto,
  UpdateProductRequest,
} from "@acos/shared";
import { ProductsService } from "./products.service";

@Controller("products")
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  async create(
    @Body() body: CreateProductRequest,
  ): Promise<ProductDetailDto> {
    return this.productsService.create(body ?? { imageIds: [] });
  }

  @Get()
  async list(
    @Query("take") take?: string,
  ): Promise<{ products: ProductListItemDto[] }> {
    return { products: await this.productsService.list(Number(take ?? "20")) };
  }

  @Get(":id")
  async getById(@Param("id") id: string): Promise<ProductDetailDto> {
    return this.productsService.getById(id);
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() body: UpdateProductRequest,
  ): Promise<ProductDetailDto> {
    return this.productsService.update(id, body ?? {});
  }

  @Delete(":id")
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    return this.productsService.remove(id);
  }
}
