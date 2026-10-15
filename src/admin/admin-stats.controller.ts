import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminTokenGuard } from '@/auth/admin-token.guard';
import { ObjectIdPipe } from '@/common/pipes/object-id.pipe';
import { AdminStatsService } from './admin-stats.service';
import { OverviewRes, RoomDetailRes, RoomListRes, StatsQuery } from './admin.dto';

/**
 * Read-only numbers for the admin console (quill-admin): counts, live sockets
 * and a messages-per-day series. Same bearer as the app routes. Nothing here
 * returns message content; the console operates Quill, it does not read chats.
 */
@ApiTags('Admin — Stats')
@ApiBearerAuth('admin')
@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  /** Every app's counters, the totals and the per-day series (`?tz=&days=`). */
  @Get('overview')
  overview(@Query() query: StatsQuery): Promise<OverviewRes> {
    return this.stats.overview(query);
  }

  /** One app's rooms with their counters, deleted ones included. 404 for an unknown app. */
  @Get('apps/:appId/rooms')
  rooms(@Param('appId', ObjectIdPipe) appId: string): Promise<RoomListRes> {
    return this.stats.rooms(appId);
  }

  /** One room: counters, members with their read watermark and online state, per-day series. */
  @Get('apps/:appId/rooms/:roomId')
  room(
    @Param('appId', ObjectIdPipe) appId: string,
    @Param('roomId', ObjectIdPipe) roomId: string,
    @Query() query: StatsQuery,
  ): Promise<RoomDetailRes> {
    return this.stats.room(appId, roomId, query);
  }
}
