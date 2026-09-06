import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQuery } from './dto/list-products.query';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

import type { Product } from '../data/products.store';

@Controller('v1/products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@Query() query: ListProductsQuery) {
    return this.productsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Query() query: ListProductsQuery) {
    return this.productsService.findOne(id, query.expandOwner);
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
