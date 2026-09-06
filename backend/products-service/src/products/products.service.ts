import { Injectable, NotFoundException } from '@nestjs/common';
import { RequestScopedLoggerService } from '@tw/logger';
import { UsersConnector } from '../connectors/users.connector';
import { products } from '../data/products.store';

import type { PublicUser } from '../connectors/users.connector';
import type { Product } from '../data/products.store';
import type { CreateProductDto } from './dto/create-product.dto';
import type { ListProductsQuery } from './dto/list-products.query';
import type { UpdateProductDto } from './dto/update-product.dto';

type ProductWithOwner = Product & { owner: PublicUser | null };

const CONTEXT = 'ProductsService';

@Injectable()
export class ProductsService {
  constructor(
    private readonly logger: RequestScopedLoggerService,
    private readonly usersConnector: UsersConnector,
  ) {}

  async findAll({ search, category, expandOwner }: ListProductsQuery): Promise<(Product | ProductWithOwner)[]> {
    let result = products;
    if (search) {
      const needle = search.toLowerCase();
      result = result.filter((product) => product.name.toLowerCase().includes(needle));
    }
    if (category) result = result.filter((product) => product.category === category);

    this.logger.info(`Returning ${result.length} product(s)`, `${CONTEXT}.findAll`);
    if (!expandOwner) return result;

    // One outbound call per distinct owner, all inheriting the same trace id — so the trace shows
    // this fan-out as several products-service → users-service edges under one request.
    return Promise.all(result.map((product) => this.withOwner(product)));
  }

  async findOne(id: string, expandOwner = false): Promise<Product | ProductWithOwner> {
    const product = products.find((candidate) => candidate.id === id);

    if (!product) {
      this.logger.warn(`Product ${id} not found`, `${CONTEXT}.findOne`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return expandOwner ? this.withOwner(product) : product;
  }

  create(dto: CreateProductDto): Product {
    const product: Product = { id: String(products.length + 1), ...dto };
    products.push(product);
    this.logger.info(`Created product ${product.id}`, `${CONTEXT}.create`);

    return product;
  }

  update(id: string, changes: UpdateProductDto): Product {
    const index = products.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot update product ${id}: not found`, `${CONTEXT}.update`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    products[index] = { ...products[index], ...changes };
    this.logger.info(`Updated product ${id}`, `${CONTEXT}.update`);

    return products[index];
  }

  remove(id: string): { deleted: true } {
    const index = products.findIndex((candidate) => candidate.id === id);

    if (index === -1) {
      this.logger.warn(`Cannot delete product ${id}: not found`, `${CONTEXT}.remove`);
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    products.splice(index, 1);
    this.logger.info(`Deleted product ${id}`, `${CONTEXT}.remove`);

    return { deleted: true };
  }

  private async withOwner(product: Product): Promise<ProductWithOwner> {
    return { ...product, owner: await this.usersConnector.findOwner(product.ownerId) };
  }
}
