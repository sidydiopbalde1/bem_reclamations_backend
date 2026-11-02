import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../common/types/auth-user';
import { CreateReclamationDto } from './dto/create-reclamation.dto';
import { QueryReclamationsDto } from './dto/query-reclamations.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { ReclamationsService } from './reclamations.service';

@ApiTags('reclamations')
@ApiBearerAuth()
@Controller('reclamations')
export class ReclamationsController {
  constructor(private readonly reclamationsService: ReclamationsService) {}

  @Post()
  create(@Body() dto: CreateReclamationDto, @CurrentUser() user: AuthUser) {
    return this.reclamationsService.create(dto, user);
  }

  @Get()
  findAll(@Query() query: QueryReclamationsDto, @CurrentUser() user: AuthUser) {
    return this.reclamationsService.findAll(query, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.reclamationsService.findOne(id, user);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MOYENS_GENERAUX)
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reclamationsService.updateStatus(id, dto, user);
  }
}
