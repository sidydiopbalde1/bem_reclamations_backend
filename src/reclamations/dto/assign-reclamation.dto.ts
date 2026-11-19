import { IsOptional, IsUUID } from 'class-validator';

export class AssignReclamationDto {
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
}
