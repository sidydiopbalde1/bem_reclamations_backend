import { BadRequestException } from '@nestjs/common';
import { ReclamationStatus } from '@prisma/client';

const { OUVERTE, EN_COURS, RESOLUE, REJETEE } = ReclamationStatus;

const ALLOWED_TRANSITIONS: Record<ReclamationStatus, ReclamationStatus[]> = {
  [OUVERTE]: [EN_COURS, REJETEE],
  [EN_COURS]: [RESOLUE, REJETEE],
  [RESOLUE]: [EN_COURS],
  [REJETEE]: [],
};

export function assertTransitionAllowed(from: ReclamationStatus, to: ReclamationStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new BadRequestException(`Transition ${from} → ${to} non autorisée`);
  }
}
