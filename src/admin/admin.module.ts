import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminAppService } from './admin-app.service';
import { AdminStatsController } from './admin-stats.controller';
import { AdminStatsRepository } from './admin-stats.repository';
import { AdminStatsService } from './admin-stats.service';
import { App, AppSchema } from '@/auth/app.schema';
import { Room, RoomSchema } from '@/room/room.schema';
import { Participant, ParticipantSchema } from '@/participant/participant.schema';
import { Message, MessageSchema } from '@/message/message.schema';
import { WsModule } from '@/ws/ws.module';

@Module({
  imports: [
    WsModule,
    // The same schema objects the owning modules register, so Mongoose hands
    // back the already-compiled models; the stats repository only reads them.
    MongooseModule.forFeature([
      { name: App.name, schema: AppSchema },
      { name: Room.name, schema: RoomSchema },
      { name: Participant.name, schema: ParticipantSchema },
      { name: Message.name, schema: MessageSchema },
    ]),
  ],
  controllers: [AdminController, AdminStatsController],
  providers: [AdminAppService, AdminStatsService, AdminStatsRepository],
})
export class AdminModule {}
