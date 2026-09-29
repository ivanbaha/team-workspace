import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  // Exported so registration writes users through the owner's path — the one that invalidates.
  exports: [UsersService],
})
export class UsersModule {}
