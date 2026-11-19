import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReclamationStatus, Role } from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
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
  assignedTo: { select: { id: true, fullName: true, email: true, role: true } },
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
    private readonly auditLogs: AuditLogsService,
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

    void this.auditLogs.log({
      userId: user.id,
      action: 'CREATE_RECLAMATION',
      entity: 'Reclamation',
      entityId: reclamation.id,
      details: { number: reclamation.number, category: reclamation.category, priority: reclamation.priority },
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
        reclamationId: reclamation.id,
      });
    }

    return reclamation;
  }

  async findAll({ page, limit, buildingId, assignedToId, ...filters }: QueryReclamationsDto, user: AuthUser) {
    const where: Prisma.ReclamationWhereInput = {
      AND: [
        reclamationScope(user),
        filters,
        buildingId ? { room: { buildingId } } : {},
        assignedToId ? { assignedToId } : {},
      ],
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

  async getDashboardStats(user: AuthUser) {
    const where = reclamationScope(user);
    const items = await this.prisma.reclamation.findMany({
      where,
      select: {
        createdAt: true,
        category: true,
        status: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const statusSummary = Object.values(ReclamationStatus).reduce<Record<string, number>>((acc, status) => {
      acc[status] = 0;
      return acc;
    }, {});

    for (const item of items) {
      statusSummary[item.status] = (statusSummary[item.status] ?? 0) + 1;
    }

    const categorySummary = new Map<string, number>();
    for (const item of items) {
      categorySummary.set(item.category, (categorySummary.get(item.category) ?? 0) + 1);
    }

    const monthMap = new Map<string, number>();
    const monthKeys: string[] = [];
    const end = new Date();
    end.setDate(1);
    end.setHours(0, 0, 0, 0);

    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(end);
      d.setMonth(end.getMonth() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(key);
      monthMap.set(key, 0);
    }

    for (const item of items) {
      const d = new Date(item.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (monthMap.has(key)) {
        monthMap.set(key, (monthMap.get(key) ?? 0) + 1);
      }
    }

    const monthly = monthKeys.map((key) => {
      const monthDate = new Date(`${key}-01T00:00:00`);
      return {
        month: monthDate.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' }),
        count: monthMap.get(key) ?? 0,
      };
    });

    const categories = Array.from(categorySummary.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const total = items.length;
    const open = statusSummary.OUVERTE ?? 0;
    const inProgress = statusSummary.EN_COURS ?? 0;
    const resolved = statusSummary.RESOLUE ?? 0;

    return {
      total,
      open,
      inProgress,
      resolved,
      statusSummary,
      categories,
      monthly,
      topCategory: categories[0] ?? null,
    };
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

    void this.auditLogs.log({
      userId: user.id,
      action: 'UPDATE_STATUS',
      entity: 'Reclamation',
      entityId: id,
      details: { number: current.number, fromStatus: current.status, toStatus: status, comment },
    });

    const reporter = await this.prisma.user.findUnique({ where: { id: current.reportedById } });
    const author = await this.prisma.user.findUnique({ where: { id: user.id } });
    const assignee = updated.assignedTo;
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
        assigneeName: assignee?.fullName,
        assigneeEmail: assignee?.email,
        reclamationId: id,
      });
    }

    return updated;
  }

  async assignReclamation(id: string, { assignedToId }: { assignedToId?: string | null }, user: AuthUser) {
    const current = await this.findOne(id, user);

    if (assignedToId) {
      const assignee = await this.prisma.user.findUnique({ where: { id: assignedToId } });
      if (!assignee) throw new NotFoundException(`Utilisateur ${assignedToId} introuvable`);
      if (assignee.role !== Role.REGULATEUR) {
        throw new BadRequestException('Le responsable assigné doit avoir le rôle RÉGULATEUR.');
      }

      const assignedBy = await this.prisma.user.findUnique({ where: { id: user.id } });
      const updated = await this.prisma.reclamation.update({
        where: { id },
        data: {
          assignedToId,
          events: {
            create: {
              fromStatus: current.status,
              toStatus: current.status,
              comment: `Assignée à ${assignee.fullName}`,
              authorId: user.id,
            },
          },
        },
        include: reclamationDetailInclude,
      });

      void this.mail.sendReclamationAssigned({
        number: updated.number,
        category: updated.category,
        building: updated.room.building.name,
        room: updated.room.number,
        program: updated.program.name,
        description: updated.description,
        assigneeName: assignee.fullName,
        assigneeEmail: assignee.email,
        assignedByName: assignedBy?.fullName ?? 'Moyens Généraux',
        reclamationId: id,
      });

      void this.auditLogs.log({
        userId: user.id,
        action: 'ASSIGN_RECLAMATION',
        entity: 'Reclamation',
        entityId: id,
        details: { number: updated.number, assignedToId, assigneeName: assignee.fullName },
      });

      return updated;
    }

    void this.auditLogs.log({
      userId: user.id,
      action: 'UNASSIGN_RECLAMATION',
      entity: 'Reclamation',
      entityId: id,
      details: { number: current.number },
    });

    const updated = await this.prisma.reclamation.update({
      where: { id },
      data: {
        assignedToId: null,
        events: {
          create: {
            fromStatus: current.status,
            toStatus: current.status,
            comment: 'Assignation retirée',
            authorId: user.id,
          },
        },
      },
      include: reclamationDetailInclude,
    });

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
