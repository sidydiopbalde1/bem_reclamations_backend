import { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  role: Role;
  buildingId: string | null;
  programId: string | null;
  mustChangePassword: boolean;
}
