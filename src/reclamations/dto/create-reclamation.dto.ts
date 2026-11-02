import { Priority, ReclamationCategory } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateReclamationDto {
  @IsUUID()
  roomId: string;

  @IsUUID()
  programId: string;

  @IsEnum(ReclamationCategory)
  category: ReclamationCategory;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description: string;
}
