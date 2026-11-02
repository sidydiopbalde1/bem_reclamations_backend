import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferentialsService {
  constructor(private readonly prisma: PrismaService) {}

  findBuildings() {
    return this.prisma.building.findMany({
      orderBy: { name: 'asc' },
      include: { rooms: { orderBy: { number: 'asc' } } },
    });
  }

  findPrograms() {
    return this.prisma.program.findMany({ orderBy: { name: 'asc' } });
  }
}
