import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReferentialsService } from './referentials.service';

@ApiTags('referentials')
@ApiBearerAuth()
@Controller()
export class ReferentialsController {
  constructor(private readonly referentialsService: ReferentialsService) {}

  @Get('buildings')
  findBuildings() {
    return this.referentialsService.findBuildings();
  }

  @Get('programs')
  findPrograms() {
    return this.referentialsService.findPrograms();
  }
}
