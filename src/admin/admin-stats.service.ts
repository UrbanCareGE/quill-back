import { HttpStatus, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { AppRegistry } from '@/auth/app-registry.service';
import { ApiException, ExcKey } from '@/common/exceptions/api.exception';
import { Room } from '@/room/room.schema';
import { ConnectionRegistry } from '@/ws/connection-registry.service';
import { AdminStatsRepository, MessageCounts } from './admin-stats.repository';
import {
  DayCountRes,
  OverviewRes,
  RoomDetailRes,
  RoomListRes,
  RoomStatsRes,
  StatsQuery,
} from './admin.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 14;
/** One response's worth of rooms. urbancare has one room per apartment. */
const ROOM_LIST_CAP = 2000;
const NO_MESSAGES: MessageCounts = { messages: 0, messagesSince: 0, lastMessageAt: null };

/** `RoomStatsRes` before serialization: dates still `Date`, ids already hex. */
type RoomStats = Omit<RoomStatsRes, 'createdAt' | 'lastMessageAt'> & {
  createdAt: Date;
  lastMessageAt: Date | null;
};

/**
 * The admin console's read side: per-app and per-room counts, the live socket
 * picture from `ConnectionRegistry`, and a messages-per-day series. Read-only;
 * every mutation stays in `AdminAppService`.
 */
@Injectable()
export class AdminStatsService {
  constructor(
    private readonly repo: AdminStatsRepository,
    private readonly registry: AppRegistry,
    private readonly connections: ConnectionRegistry,
  ) {}

  async overview(query: StatsQuery): Promise<OverviewRes> {
    const timeZone = resolveTimeZone(query.tz);
    const days = query.days ?? DEFAULT_DAYS;
    const now = new Date();
    const since24h = new Date(now.getTime() - DAY_MS);

    const [apps, rooms, members, messages, perDay] = await Promise.all([
      this.registry.list(),
      this.repo.roomCountsByApp(),
      this.repo.participantCountsByApp(),
      this.repo.messageCountsByApp(since24h),
      this.repo.messagesPerDay(seriesStart(now, days), timeZone),
    ]);
    const live = this.connections.liveByApp();

    const appStats = apps.map((app) => {
      const m = messages.get(app.appId) ?? NO_MESSAGES;
      const p = members.get(app.appId) ?? { participants: 0, users: 0 };
      const l = live.get(app.appId) ?? { users: 0, connections: 0 };
      return {
        appId: app.appId,
        label: app.label,
        revoked: app.revoked,
        rooms: rooms.get(app.appId) ?? 0,
        participants: p.participants,
        users: p.users,
        messages: m.messages,
        messages24h: m.messagesSince,
        lastMessageAt: m.lastMessageAt,
        liveUsers: l.users,
        liveConnections: l.connections,
      };
    });
    const sum = (pick: (a: (typeof appStats)[number]) => number) =>
      appStats.reduce((total, a) => total + pick(a), 0);

    return plainToInstance(OverviewRes, {
      generatedAt: now,
      timeZone,
      totals: {
        apps: appStats.length,
        activeApps: appStats.filter((a) => !a.revoked).length,
        rooms: sum((a) => a.rooms),
        participants: sum((a) => a.participants),
        users: sum((a) => a.users),
        messages: sum((a) => a.messages),
        messages24h: sum((a) => a.messages24h),
        liveUsers: sum((a) => a.liveUsers),
        liveConnections: sum((a) => a.liveConnections),
      },
      apps: appStats,
      messagesPerDay: daySeries(perDay, now, days, timeZone),
    });
  }

  async rooms(appId: string): Promise<RoomListRes> {
    await this.assertApp(appId);
    const since24h = new Date(Date.now() - DAY_MS);
    const [rooms, members, messages] = await Promise.all([
      this.repo.findRooms(appId, ROOM_LIST_CAP + 1),
      this.repo.memberIdsByRoom(appId),
      this.repo.messageCountsByRoom(appId, since24h),
    ]);
    const items = rooms.slice(0, ROOM_LIST_CAP).map((room) => {
      const roomId = room.roomId.toHexString();
      return this.roomStats(appId, room, members.get(roomId) ?? [], messages.get(roomId));
    });
    return plainToInstance(RoomListRes, { items, truncated: rooms.length > ROOM_LIST_CAP });
  }

  async room(appId: string, roomId: string, query: StatsQuery): Promise<RoomDetailRes> {
    await this.assertApp(appId);
    const room = await this.repo.findRoom(appId, roomId);
    if (!room) {
      throw new ApiException(ExcKey.ROOM_NOT_FOUND, 'Room not found', HttpStatus.NOT_FOUND);
    }
    const timeZone = resolveTimeZone(query.tz);
    const days = query.days ?? DEFAULT_DAYS;
    const now = new Date();
    const [participants, messages, perDay] = await Promise.all([
      this.repo.findParticipants(appId, roomId),
      this.repo.messageCountsForRoom(appId, roomId, new Date(now.getTime() - DAY_MS)),
      this.repo.messagesPerDay(seriesStart(now, days), timeZone, { appId, roomId }),
    ]);
    const userIds = participants.map((p) => p.userId.toHexString());

    return plainToInstance(RoomDetailRes, {
      room: this.roomStats(appId, room, userIds, messages),
      participants: participants.map((p) => ({
        userId: p.userId,
        joinedAt: p.joinedAt,
        lastReadAt: p.lastReadAt,
        online: this.connections.hasActive(appId, p.userId.toHexString()),
      })),
      timeZone,
      messagesPerDay: daySeries(perDay, now, days, timeZone),
    });
  }

  private roomStats(
    appId: string,
    room: Pick<Room, 'roomId' | 'name' | 'deleted' | 'createdAt'>,
    userIds: string[],
    messages: MessageCounts = NO_MESSAGES,
  ): RoomStats {
    return {
      roomId: room.roomId.toHexString(),
      name: room.name ?? null,
      deleted: room.deleted,
      createdAt: room.createdAt,
      participants: userIds.length,
      liveUsers: userIds.filter((u) => this.connections.hasActive(appId, u)).length,
      messages: messages.messages,
      messages24h: messages.messagesSince,
      lastMessageAt: messages.lastMessageAt,
    };
  }

  private async assertApp(appId: string): Promise<void> {
    if (!(await this.repo.appExists(appId))) {
      throw new ApiException(ExcKey.UNKNOWN_APP, 'App not found', HttpStatus.NOT_FOUND);
    }
  }
}

/** `UTC` when absent; a 400 for anything Intl (and so Mongo) does not know. */
function resolveTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new ApiException(
      ExcKey.INVALID_TIME_ZONE,
      `Unknown time zone: ${tz}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}

/**
 * Where the per-day query starts: a day earlier than the series needs, so the
 * oldest day is complete in any zone. Rows outside the series are dropped.
 */
function seriesStart(now: Date, days: number): Date {
  return new Date(now.getTime() - (days + 1) * DAY_MS);
}

/** The last `days` calendar days in `timeZone`, oldest first, zero-filled. */
function daySeries(
  counts: Map<string, number>,
  now: Date,
  days: number,
  timeZone: string,
): DayCountRes[] {
  // en-CA formats as YYYY-MM-DD, the same shape as Mongo's `%Y-%m-%d`.
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dates = new Set<string>();
  for (let i = days - 1; i >= 0; i--)
    dates.add(format.format(new Date(now.getTime() - i * DAY_MS)));
  return [...dates].map((date) => ({ date, messages: counts.get(date) ?? 0 }));
}
