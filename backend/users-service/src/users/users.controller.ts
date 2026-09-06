import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersService } from './users.service';

import type { PublicUser } from '../data/users.store';

@Controller('v1/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  findOne(@Param('id') id: string): PublicUser {
    return this.users.findOne(id);
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
