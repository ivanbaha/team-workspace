import { Body, Controller, Delete, Get, Headers, Param, Post, Put, Query } from '@nestjs/common';
import { wantsFreshData } from '@tw/cache';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

import type { Product } from '../data/products.store';

@Controller('v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  /**
   * `no-cache` from the caller is threaded to the owner lookups these reads may trigger, and the
   * forwarded header carries the demand to users-service. The header is read here, where it is
   * used — the same reasoning as any cache-aware endpoint: a request-scoped "current header"
   * would make one caller's demand a property of every lookup in the request.
   */
  @Get()
  findAll(@Query() query: ListProductsQuery, @Headers('cache-control') cacheControl?: string) {
    return this.productsService.findAll(query, wantsFreshData(cacheControl));
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @Query() query: ListProductsQuery,
    @Headers('cache-control') cacheControl?: string,
  ) {
    return this.productsService.findOne(id, query.expandOwner, wantsFreshData(cacheControl));
  }

  @Post()
  create(@Body() dto: CreateProductDto): Product {
    return this.productsService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() changes: UpdateProductDto): Product {
    return this.productsService.update(id, changes);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { deleted: true } {
    return this.productsService.remove(id);
  }
}