import { MailerService } from '@nestjs-modules/mailer';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ReclamationCreatedPayload {
  number: number;
  category: string;
  priority: string;
  building: string;
  room: string;
  program: string;
  description: string;
  reporterName: string;
  reporterEmail: string;
  reclamationId: string;
}

export interface StatusUpdatedPayload {
  number: number;
  category: string;
  building: string;
  room: string;
  fromStatus: string;
  toStatus: string;
  comment?: string;
  authorName: string;
  reporterName: string;
  reporterEmail: string;
  assigneeName?: string;
  assigneeEmail?: string;
  reclamationId: string;
}

export interface ReclamationAssignedPayload {
  number: number;
  category: string;
  building: string;
  room: string;
  program: string;
  description: string;
  assigneeName: string;
  assigneeEmail: string;
  assignedByName: string;
  reclamationId: string;
}

export interface ReminderReclamationItem {
  number: number;
  category: string;
  priority: string;
  status: string;
  building: string;
  room: string;
  program: string;
  description: string;
  daysOld: number;
}

export interface UserAccountCreatedPayload {
  recipientName: string;
  email: string;
  role: Role;
  program?: string | null;
  defaultPassword: string;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;

  private readonly appUrl: string;

  constructor(
    private readonly mailer: MailerService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.from = this.config.get<string>('MAIL_FROM', '"Registre Réclamations" <no-reply@bem.sn>');
    this.appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
  }

  async sendReclamationCreated(payload: ReclamationCreatedPayload): Promise<void> {
    const base = { ...payload, appUrl: this.appUrl };

    // Notify the reporter
    await this.send(
      payload.reporterEmail,
      `[Réclamation #${payload.number}] Votre réclamation a été enregistrée`,
      'reclamation-created',
      { ...base, isReporter: true, recipientName: payload.reporterName },
    );

    // Notify all MOYENS_GENERAUX users
    const managers = await this.prisma.user.findMany({
      where: { role: Role.MOYENS_GENERAUX },
      select: { email: true, fullName: true },
    });

    await Promise.all(
      managers.map((m) =>
        this.send(
          m.email,
          `[Réclamation #${payload.number}] Nouvelle réclamation soumise`,
          'reclamation-created',
          { ...base, isReporter: false, recipientName: m.fullName },
        ),
      ),
    );
  }

  async sendStatusUpdated(payload: StatusUpdatedPayload): Promise<void> {
    const managerRecipients = await this.prisma.user.findMany({
      where: { role: Role.MOYENS_GENERAUX },
      select: { email: true, fullName: true },
    });

    const recipients = new Map<string, string>();
    recipients.set(payload.reporterEmail, payload.reporterName);
    if (payload.assigneeEmail) {
      recipients.set(payload.assigneeEmail, payload.assigneeName ?? 'Responsable');
    }
    for (const manager of managerRecipients) {
      recipients.set(manager.email, manager.fullName);
    }

    const base = { ...payload, appUrl: this.appUrl };

    await Promise.all(
      Array.from(recipients.entries()).map(([email, name]) =>
        this.send(
          email,
          `[Réclamation #${payload.number}] Statut mis à jour : ${payload.toStatus}`,
          'status-updated',
          { ...base, recipientName: name },
        ),
      ),
    );
  }

  async sendReclamationAssigned(payload: ReclamationAssignedPayload): Promise<void> {
    await this.send(
      payload.assigneeEmail,
      `[Réclamation #${payload.number}] Vous avez été assigné(e) à une réclamation`,
      'reclamation-assigned',
      { ...payload, recipientName: payload.assigneeName, appUrl: this.appUrl },
    );
  }

  async sendUserAccountCreated(payload: UserAccountCreatedPayload): Promise<void> {
    await this.send(
      payload.email,
      'Votre accès au registre des réclamations a été créé',
      'user-account-created',
      {
        recipientName: payload.recipientName,
        email: payload.email,
        role: payload.role,
        program: payload.program ?? 'Non attribué',
        defaultPassword: payload.defaultPassword,
        appUrl: this.appUrl,
        changePasswordUrl: `${this.appUrl}/login`,
      },
    );
  }

  async sendReminderDigest(items: ReminderReclamationItem[]): Promise<{ sent: number }> {
    const managers = await this.prisma.user.findMany({
      where: { role: { in: [Role.MOYENS_GENERAUX, Role.ADMIN] } },
      select: { email: true, fullName: true },
    });

    if (!managers.length || !items.length) return { sent: 0 };

    const urgentItems = items.filter((i) => i.priority === 'URGENTE');
    const highItems = items.filter((i) => i.priority === 'HAUTE');
    const otherItems = items.filter((i) => i.priority !== 'URGENTE' && i.priority !== 'HAUTE');
    const oldCount = items.filter((i) => i.daysOld >= 3).length;

    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:3001');
    const generatedAt = new Date().toLocaleString('fr-FR', {
      weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    await Promise.all(
      managers.map((m) =>
        this.send(
          m.email,
          `⚠️ Rappel : ${items.length} réclamation${items.length > 1 ? 's' : ''} en attente de traitement`,
          'reminder-digest',
          {
            recipientName: m.fullName,
            total: items.length,
            urgentCount: urgentItems.length,
            highCount: highItems.length,
            oldCount,
            urgentItems,
            highItems,
            otherItems,
            appUrl,
            generatedAt,
          },
        ),
      ),
    );

    return { sent: managers.length };
  }

  private async send(
    to: string,
    subject: string,
    template: string,
    context: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.mailer.sendMail({ from: this.from, to, subject, template, context });
      this.logger.log(`Mail "${subject}" envoyé à ${to}`);
    } catch (err) {
      // Log but never throw -a mail failure must not break the API response
      this.logger.error(`Échec envoi mail à ${to}: ${(err as Error).message}`);
    }
  }
}
