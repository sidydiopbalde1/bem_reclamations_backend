import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';

/**
 * Restreint les réclamations visibles selon le rôle :
 * - ADMIN            : tout
 * - MOYENS_GENERAUX  : uniquement celles soumises par des DELEGUEs
 * - REGULATEUR       : uniquement celles qui lui sont assignées
 * - VIGILE           : uniquement les salles de son bâtiment
 * - DELEGUE          : uniquement ses propres signalements
 */
export function reclamationScope(user: AuthUser): Prisma.ReclamationWhereInput {
  switch (user.role) {
    case Role.ADMIN:
      return {};
    case Role.MOYENS_GENERAUX:
      return { reportedBy: { role: { in: [Role.DELEGUE, Role.REGULATEUR, Role.VIGILE] } } };
    case Role.REGULATEUR:
      return { assignedToId: user.id };
    case Role.VIGILE:
      return user.buildingId ? { room: { buildingId: user.buildingId } } : { reportedById: user.id };
    case Role.DELEGUE:
      return { reportedById: user.id };
  }
}
