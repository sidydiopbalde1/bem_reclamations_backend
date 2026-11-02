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
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;

  constructor(
    private readonly mailer: MailerService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.from = this.config.get<string>('MAIL_FROM', '"Registre Réclamations" <no-reply@bem.sn>');
  }

  async sendReclamationCreated(payload: ReclamationCreatedPayload): Promise<void> {
    const context = { ...payload, isReporter: true, recipientName: payload.reporterName };

    // Notify the reporter
    await this.send(
      payload.reporterEmail,
      `[Réclamation #${payload.number}] Votre réclamation a été enregistrée`,
      'reclamation-created',
      context,
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
          { ...payload, isReporter: false, recipientName: m.fullName },
        ),
      ),
    );
  }

  async sendStatusUpdated(payload: StatusUpdatedPayload): Promise<void> {
    await this.send(
      payload.reporterEmail,
      `[Réclamation #${payload.number}] Statut mis à jour : ${payload.toStatus}`,
      'status-updated',
      { ...payload, recipientName: payload.reporterName },
    );
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
      // Log but never throw — a mail failure must not break the API response
      this.logger.error(`Échec envoi mail à ${to}: ${(err as Error).message}`);
    }
  }
}
