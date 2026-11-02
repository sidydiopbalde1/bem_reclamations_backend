import { Prisma, Role } from '@prisma/client';
import { AuthUser } from '../../common/types/auth-user';

/**
 * Restreint les réclamations visibles selon le rôle :
 * - ADMIN / MOYENS_GENERAUX : tout
 * - VIGILE : les salles de son bâtiment
 * - DELEGUE : uniquement ses propres signalements
 */
export function reclamationScope(user: AuthUser): Prisma.ReclamationWhereInput {
  switch (user.role) {
    case Role.ADMIN:
    case Role.MOYENS_GENERAUX:
      return {};
    case Role.VIGILE:
      return user.buildingId ? { room: { buildingId: user.buildingId } } : { reportedById: user.id };
    case Role.DELEGUE:
      return { reportedById: user.id };
  }
}
