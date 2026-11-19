import { Module } from '@nestjs/common';
import { ReclamationsController } from './reclamations.controller';
import { ReclamationsService } from './reclamations.service';
import { ReminderService } from './reminder.service';

@Module({
  controllers: [ReclamationsController],
  providers: [ReclamationsService, ReminderService],
})
export class ReclamationsModule {}
