import { Module } from '@nestjs/common';
import { UsersConnector } from '../connectors/users.connector';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, UsersConnector],
})
export class ProductsModule {}
