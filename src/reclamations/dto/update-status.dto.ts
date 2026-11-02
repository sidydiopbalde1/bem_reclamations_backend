import { ReclamationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStatusDto {
  @IsEnum(ReclamationStatus)
  status: ReclamationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
