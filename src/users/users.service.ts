import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as XLSX from 'xlsx';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../common/types/auth-user';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

type UserWithBuilding = Prisma.UserGetPayload<{ include: { building: true; program: true } }>;

const DEFAULT_USER_PASSWORD = 'Bem2025!';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly mail: MailService,
  ) {}

  async findAll() {
    const users = await this.prisma.user.findMany({
      include: { building: true, program: true },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((user) => this.toPublicUser(user));
  }

  async create(dto: CreateUserDto, actorId?: string) {
    const fullName = dto.fullName.trim();
    const email = dto.email.trim().toLowerCase();

    if (!fullName) {
      throw new BadRequestException('Le nom complet est requis.');
    }

    if (dto.role === Role.VIGILE && !dto.buildingId) {
      throw new BadRequestException('Un vigile doit être rattaché à un bâtiment.');
    }

    if (dto.role === Role.DELEGUE && !dto.programId) {
      throw new BadRequestException('Un délégué doit être rattaché à un programme.');
    }

    if (dto.programId && !(await this.prisma.program.findUnique({ where: { id: dto.programId } }))) {
      throw new BadRequestException('Le programme sélectionné est introuvable.');
    }

    await this.ensureEmailAvailable(email);

    const defaultPassword = (dto.password ?? '').trim() || DEFAULT_USER_PASSWORD;
    const user = await this.prisma.user.create({
      data: {
        fullName,
        email,
        role: dto.role,
        buildingId: dto.buildingId ?? null,
        programId: dto.role === Role.DELEGUE ? (dto.programId ?? null) : null,
        passwordHash: await bcrypt.hash(defaultPassword, 10),
        mustChangePassword: true,
      },
      include: { building: true, program: true },
    });

    void this.mail.sendUserAccountCreated({
      recipientName: user.fullName,
      email: user.email,
      role: user.role,
      program: user.program?.name,
      defaultPassword,
    });

    void this.auditLogs.log({
      userId: actorId ?? null,
      action: 'CREATE_USER',
      entity: 'User',
      entityId: user.id,
      details: { fullName: user.fullName, email: user.email, role: user.role },
    });

    return this.toPublicUser(user);
  }

  async update(id: string, dto: UpdateUserDto, actorId?: string) {
    const existingUser = await this.prisma.user.findUnique({ where: { id }, include: { building: true } });
    if (!existingUser) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    const role = dto.role ?? existingUser.role;
    const buildingId = dto.buildingId ?? existingUser.buildingId;
    const programId = dto.programId ?? existingUser.programId;

    if (role === Role.VIGILE && !buildingId) {
      throw new BadRequestException('Un vigile doit être rattaché à un bâtiment.');
    }

    if (role === Role.DELEGUE && !programId) {
      throw new BadRequestException('Un délégué doit être rattaché à un programme.');
    }

    if (programId && !(await this.prisma.program.findUnique({ where: { id: programId } }))) {
      throw new BadRequestException('Le programme sélectionné est introuvable.');
    }

    const email = dto.email?.trim().toLowerCase();
    if (email && email !== existingUser.email) {
      await this.ensureEmailAvailable(email, id);
    }

    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 10) : undefined;

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...(dto.fullName ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.email ? { email } : {}),
        ...(dto.role ? { role } : {}),
        ...(dto.buildingId !== undefined ? { buildingId: dto.buildingId ?? null } : {}),
        ...(dto.programId !== undefined ? { programId: dto.programId ?? (role === Role.DELEGUE ? null : null) } : {}),
        ...(dto.role === Role.DELEGUE ? { programId: programId ?? null } : {}),
        ...(dto.role !== Role.DELEGUE && dto.programId !== undefined ? { programId: null } : {}),
        ...(passwordHash ? { passwordHash, mustChangePassword: false } : {}),
      },
      include: { building: true, program: true },
    });

    void this.auditLogs.log({
      userId: actorId ?? null,
      action: 'UPDATE_USER',
      entity: 'User',
      entityId: id,
      details: { changes: Object.keys(dto).filter(k => k !== 'password') },
    });

    return this.toPublicUser(updatedUser);
  }

  async remove(id: string, currentUser: AuthUser) {
    if (id === currentUser.id) {
      throw new BadRequestException('Impossible de supprimer votre propre compte.');
    }

    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Utilisateur introuvable.');
    }

    await this.prisma.user.delete({ where: { id } });

    void this.auditLogs.log({
      userId: currentUser.id,
      action: 'DELETE_USER',
      entity: 'User',
      entityId: id,
      details: { deletedUserFullName: user.fullName, deletedUserEmail: user.email },
    });

    return { id, deleted: true };
  }

  async importUsers(file: { originalname: string; buffer: Buffer }, actorId?: string) {
    if (!file) {
      throw new BadRequestException('Aucun fichier Excel fourni.');
    }

    const fileExt = file.originalname.toLowerCase();
    if (!fileExt.endsWith('.xlsx') && !fileExt.endsWith('.xls') && !fileExt.endsWith('.csv')) {
      throw new BadRequestException('Le fichier doit être un fichier Excel (.xlsx, .xls) ou CSV.');
    }

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) {
      throw new BadRequestException('Le fichier Excel est vide ou invalide.');
    }

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    if (!rows.length) {
      throw new BadRequestException('Aucune ligne exploitable n’a été trouvée dans le fichier.');
    }

    const createdUsers: Array<{ id: string; fullName: string; email: string; role: Role }> = [];

    for (const row of rows) {
      const normalizedRow = this.normalizeImportRow(row);
      if (!normalizedRow.fullName || !normalizedRow.email || !normalizedRow.role) {
        continue;
      }

      const buildingName = normalizedRow.buildingName?.trim();
      const building = buildingName
        ? await this.prisma.building.findFirst({ where: { name: { equals: buildingName, mode: 'insensitive' } } })
        : null;

      const programName = normalizedRow.programName?.trim();
      const program = programName
        ? await this.prisma.program.findFirst({ where: { name: { equals: programName, mode: 'insensitive' } } })
        : null;

      const payload: CreateUserDto = {
        fullName: normalizedRow.fullName,
        email: normalizedRow.email,
        role: normalizedRow.role,
        buildingId: normalizedRow.role === Role.VIGILE ? (building?.id ?? null) : (building ? building.id : null),
        programId: normalizedRow.role === Role.DELEGUE ? (program?.id ?? null) : null,
        password: normalizedRow.password || undefined,
      };

      if (payload.role === Role.VIGILE && !payload.buildingId) {
        throw new BadRequestException(
          `Le rôle VIGILE exige un bâtiment valide pour l’utilisateur ${payload.fullName}.`,
        );
      }

      if (payload.role === Role.DELEGUE && !payload.programId) {
        throw new BadRequestException(
          `Le rôle DELEGUE exige un programme valide pour l’utilisateur ${payload.fullName}.`,
        );
      }

      const createdUser = await this.create(payload, actorId);
      createdUsers.push({
        id: createdUser.id,
        fullName: createdUser.fullName,
        email: createdUser.email,
        role: createdUser.role,
      });
    }

    if (!createdUsers.length) {
      throw new BadRequestException('Aucune ligne valide n’a pu être importée.');
    }

    void this.auditLogs.log({
      userId: actorId ?? null,
      action: 'IMPORT_USERS',
      entity: 'User',
      details: { imported: createdUsers.length },
    });

    return {
      imported: createdUsers.length,
      users: createdUsers,
    };
  }

  private normalizeImportRow(row: Record<string, unknown>) {
    const normalized: Record<string, string> = {};

    for (const [key, value] of Object.entries(row)) {
      const normalizedKey = this.normalizeImportKey(key);
      normalized[normalizedKey] = String(value ?? '').trim();
    }

    const roleValue = normalized.role || normalized.rol || normalized.roleName || normalized.role_name || '';
    const mappedRole = this.mapRole(roleValue);

    return {
      fullName: normalized.fullname || normalized.name || normalized.nom || normalized.full_name || '',
      email: normalized.email || normalized.mail || normalized.emailAddress || '',
      role: mappedRole,
      password: normalized.password || normalized.motdepasse || normalized.pass || '',
      buildingName: normalized.building || normalized.buildingname || normalized.batiment || normalized.batimentname || '',
      programName: normalized.program || normalized.programme || normalized.programname || normalized.nomprogramme || '',
    };
  }

  private normalizeImportKey(key: string) {
    return key
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private mapRole(roleValue: string): Role | null {
    const cleaned = roleValue.trim().toUpperCase();
    if (!cleaned) return null;
    const map: Record<string, Role> = {
      ADMIN: Role.ADMIN,
      ADMINISTRATEUR: Role.ADMIN,
      MOYENSGENERAUX: Role.MOYENS_GENERAUX,
      MOYENS_GENERAUX: Role.MOYENS_GENERAUX,
      REGULATEUR: Role.REGULATEUR,
      REGULATEURS: Role.REGULATEUR,
      VIGILE: Role.VIGILE,
      DELEGUE: Role.DELEGUE,
      DELEGUEDECLASSE: Role.DELEGUE,
    };
    return map[cleaned] ?? null;
  }

  private async ensureEmailAvailable(email: string, ignoreId?: string) {
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.id !== ignoreId) {
      throw new ConflictException('Un utilisateur avec cet e-mail existe déjà.');
    }
  }

  private toPublicUser(user: UserWithBuilding) {
    const { passwordHash: _, ...publicUser } = user;
    return {
      ...publicUser,
      building: user.building ? { id: user.building.id, name: user.building.name } : null,
      program: user.program ? { id: user.program.id, name: user.program.name } : null,
    };
  }
}
