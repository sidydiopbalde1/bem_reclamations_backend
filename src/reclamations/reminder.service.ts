import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReclamationStatus } from '@prisma/client';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Runs every day at 08:00 (Africa/Dakar = UTC+0, so 08:00 UTC) */
  @Cron('0 8 * * *', { name: 'daily-reminder', timeZone: 'Africa/Dakar' })
  async sendDailyReminder() {
    this.logger.log('Démarrage du rappel quotidien…');
    const result = await this.buildAndSend();
    this.logger.log(`Rappel envoyé à ${result.sent} destinataire(s) pour ${result.total} réclamation(s).`);
  }

  /** Manual trigger — callable from the controller */
  async triggerManual(): Promise<{ sent: number; total: number }> {
    return this.buildAndSend();
  }

  private async buildAndSend(): Promise<{ sent: number; total: number }> {
    const pending = await this.prisma.reclamation.findMany({
      where: {
        status: { in: [ReclamationStatus.OUVERTE, ReclamationStatus.EN_COURS] },
      },
      include: {
        room: { include: { building: true } },
        program: true,
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    if (!pending.length) {
      this.logger.log('Aucune réclamation en attente — rappel annulé.');
      return { sent: 0, total: 0 };
    }

    const now = Date.now();
    const items = pending.map((r) => {
      const daysOld = Math.floor((now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24));
      return {
        number: r.number,
        category: r.category,
        priority: r.priority,
        status: r.status,
        building: r.room.building.name,
        room: r.room.number,
        program: r.program.name,
        description: r.description.length > 120 ? r.description.slice(0, 117) + '…' : r.description,
        daysOld,
      };
    });

    const { sent } = await this.mail.sendReminderDigest(items);
    return { sent, total: items.length };
  }
}
