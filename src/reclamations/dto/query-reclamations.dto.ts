import { ReclamationCategory, ReclamationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryReclamationsDto {
  @IsOptional()
  @IsEnum(ReclamationStatus)
  status?: ReclamationStatus;

  @IsOptional()
  @IsEnum(ReclamationCategory)
  category?: ReclamationCategory;

  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}
