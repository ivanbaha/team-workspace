import { Body, Controller, Delete, Get, Headers, Param, Put } from '@nestjs/common';
import { wantsFreshData } from '@tw/cache';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

import type { PublicUser } from '../data/users.store';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * The caller's `Cache-Control` becomes a method parameter and nothing more — the header is
   * read exactly where it is used. A request-scoped "current cache-control" injected wherever
   * needed would make one caller's header a property of the whole request, and the endpoint that
   * forgot to ask would silently serve stale data while the one that asked looks honoured.
   *
   * The write endpoints below do not read it at all: a write always invalidates.
   */
  @Get(':id')
  findOne(@Param('id') id: string, @Headers('cache-control') cacheControl?: string): Promise<PublicUser> {
    return this.users.findOne(id, wantsFreshData(cacheControl));
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() changes: UpdateUserDto): PublicUser {
    return this.users.update(id, changes);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { deleted: true } {
    return this.users.remove(id);
  }
}