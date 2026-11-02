import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReclamationStatus, Role } from '@prisma/client';
import { AuthUser } from '../common/types/auth-user';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReclamationDto } from './dto/create-reclamation.dto';
import { QueryReclamationsDto } from './dto/query-reclamations.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { reclamationScope } from './policies/reclamation-scope.policy';
import { assertTransitionAllowed } from './policies/reclamation-status.policy';

const reclamationInclude = {
  room: { include: { building: true } },
  program: true,
  reportedBy: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.ReclamationInclude;

const reclamationDetailInclude = {
  ...reclamationInclude,
  events: {
    orderBy: { createdAt: 'asc' },
    include: { author: { select: { id: true, fullName: true } } },
  },
} satisfies Prisma.ReclamationInclude;

@Injectable()
export class ReclamationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  async create(dto: CreateReclamationDto, user: AuthUser) {
    await this.assertRoomAccessible(dto.roomId, user);
    await this.assertProgramExists(dto.programId);

    const reclamation = await this.prisma.reclamation.create({
      data: {
        ...dto,
        reportedById: user.id,
        events: { create: { toStatus: ReclamationStatus.OUVERTE, authorId: user.id } },
      },
      include: reclamationInclude,
    });

    const reporter = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (reporter) {
      void this.mail.sendReclamationCreated({
        number: reclamation.number,
        category: reclamation.category,
        priority: reclamation.priority,
        building: reclamation.room.building.name,
        room: reclamation.room.number,
        program: reclamation.program.name,
        description: reclamation.description,
        reporterName: reporter.fullName,
        reporterEmail: reporter.email,
      });
    }

    return reclamation;
  }

  async findAll({ page, limit, buildingId, ...filters }: QueryReclamationsDto, user: AuthUser) {
    const where: Prisma.ReclamationWhereInput = {
      AND: [reclamationScope(user), filters, buildingId ? { room: { buildingId } } : {}],
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.reclamation.findMany({
        where,
        include: reclamationInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.reclamation.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async findOne(id: string, user: AuthUser) {
    const reclamation = await this.prisma.reclamation.findFirst({
      where: { AND: [{ id }, reclamationScope(user)] },
      include: reclamationDetailInclude,
    });

    if (!reclamation) throw new NotFoundException(`Réclamation ${id} introuvable`);
    return reclamation;
  }

  async updateStatus(id: string, { status, comment }: UpdateStatusDto, user: AuthUser) {
    const current = await this.findOne(id, user);
    assertTransitionAllowed(current.status, status);

    const updated = await this.prisma.reclamation.update({
      where: { id },
      data: {
        status,
        resolvedAt: status === ReclamationStatus.RESOLUE ? new Date() : null,
        events: { create: { fromStatus: current.status, toStatus: status, comment, authorId: user.id } },
      },
      include: reclamationDetailInclude,
    });

    const reporter = await this.prisma.user.findUnique({ where: { id: current.reportedById } });
    const author = await this.prisma.user.findUnique({ where: { id: user.id } });
    if (reporter && author) {
      void this.mail.sendStatusUpdated({
        number: updated.number,
        category: updated.category,
        building: updated.room.building.name,
        room: updated.room.number,
        fromStatus: current.status,
        toStatus: status,
        comment,
        authorName: author.fullName,
        reporterName: reporter.fullName,
        reporterEmail: reporter.email,
      });
    }

    return updated;
  }

  private async assertRoomAccessible(roomId: string, user: AuthUser) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException(`Salle ${roomId} introuvable`);

    const isOutsideVigileBuilding =
      user.role === Role.VIGILE && user.buildingId !== null && room.buildingId !== user.buildingId;
    if (isOutsideVigileBuilding) {
      throw new ForbiddenException('Cette salle ne relève pas de votre bâtiment');
    }
  }

  private async assertProgramExists(programId: string) {
    const program = await this.prisma.program.findUnique({ where: { id: programId } });
    if (!program) throw new NotFoundException(`Programme ${programId} introuvable`);
  }
}
