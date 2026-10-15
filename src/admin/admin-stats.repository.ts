import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { App } from '@/auth/app.schema';
import { Room } from '@/room/room.schema';
import { Participant } from '@/participant/participant.schema';
import { Message } from '@/message/message.schema';

/** Message counters for one bucket (an app, or a room inside one). */
export interface MessageCounts {
  messages: number;
  messagesSince: number;
  lastMessageAt: Date | null;
}

/**
 * Read-only aggregations behind the admin console's numbers. Pure queries,
 * like the other repositories; `AdminStatsService` shapes them for the wire.
 *
 * Never reads message `content`, `attachments` or `metadata` — only counts and
 * timestamps. The console is for operating Quill, not for reading tenants'
 * conversations.
 *
 * Cost: the per-app and per-room message counts group over every message row
 * of the scope (the `(appId, roomId, createdAt)` index serves the room-scoped
 * ones; the all-apps overview is a collection scan). Fine at today's volume —
 * an admin page load, not a hot path. If `chat_messages` grows into the
 * millions, cache these or keep counters on the room.
 */
@Injectable()
export class AdminStatsRepository {
  constructor(
    @InjectModel(App.name) private readonly apps: Model<App>,
    @InjectModel(Room.name) private readonly rooms: Model<Room>,
    @InjectModel(Participant.name) private readonly participants: Model<Participant>,
    @InjectModel(Message.name) private readonly messages: Model<Message>,
  ) {}

  /** Any `chat_apps` row, revoked ones included (the console shows those too). */
  async appExists(appId: string): Promise<boolean> {
    return (await this.apps.exists({ _id: new Types.ObjectId(appId) })) !== null;
  }

  /** Live (non-deleted) room count per app. */
  async roomCountsByApp(): Promise<Map<string, number>> {
    const rows = await this.rooms.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { deleted: false } },
      { $group: { _id: '$appId', n: { $sum: 1 } } },
    ]);
    return new Map(rows.map((r) => [r._id.toHexString(), r.n]));
  }

  /** Membership rows and distinct members per app. */
  async participantCountsByApp(): Promise<Map<string, { participants: number; users: number }>> {
    const rows = await this.participants.aggregate<{
      _id: Types.ObjectId;
      participants: number;
      users: number;
    }>([
      { $group: { _id: { appId: '$appId', userId: '$userId' }, rows: { $sum: 1 } } },
      { $group: { _id: '$_id.appId', participants: { $sum: '$rows' }, users: { $sum: 1 } } },
    ]);
    return new Map(
      rows.map((r) => [r._id.toHexString(), { participants: r.participants, users: r.users }]),
    );
  }

  /** Every message row ever sent (tombstones included), grouped by app. */
  async messageCountsByApp(since: Date): Promise<Map<string, MessageCounts>> {
    return this.messageCounts([], '$appId', since);
  }

  /** Same counters per room, for one app. */
  async messageCountsByRoom(appId: string, since: Date): Promise<Map<string, MessageCounts>> {
    return this.messageCounts([{ $match: { appId: new Types.ObjectId(appId) } }], '$roomId', since);
  }

  /** One room's counters. */
  async messageCountsForRoom(appId: string, roomId: string, since: Date): Promise<MessageCounts> {
    const counts = await this.messageCounts(
      [{ $match: { appId: new Types.ObjectId(appId), roomId: new Types.ObjectId(roomId) } }],
      '$roomId',
      since,
    );
    return counts.get(roomId) ?? { messages: 0, messagesSince: 0, lastMessageAt: null };
  }

  /**
   * Messages per calendar day in `timeZone`, from `since` on. Optionally
   * narrowed to one app or one room. Days with no messages are absent; the
   * service zero-fills.
   */
  async messagesPerDay(
    since: Date,
    timeZone: string,
    scope: { appId?: string; roomId?: string } = {},
  ): Promise<Map<string, number>> {
    const match: Record<string, unknown> = { createdAt: { $gte: since } };
    if (scope.appId) match.appId = new Types.ObjectId(scope.appId);
    if (scope.roomId) match.roomId = new Types.ObjectId(scope.roomId);
    const rows = await this.messages.aggregate<{ _id: string; n: number }>([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: timeZone } },
          n: { $sum: 1 },
        },
      },
    ]);
    return new Map(rows.map((r) => [r._id, r.n]));
  }

  /** Every room of an app, deleted ones included, newest first. */
  findRooms(appId: string, limit: number) {
    return this.rooms
      .find({ appId: new Types.ObjectId(appId) })
      .sort({ _id: -1 })
      .limit(limit)
      .lean()
      .exec();
  }

  findRoom(appId: string, roomId: string) {
    return this.rooms
      .findOne({ appId: new Types.ObjectId(appId), roomId: new Types.ObjectId(roomId) })
      .lean()
      .exec();
  }

  /** Member ids per room, for one app — the service checks who is online. */
  async memberIdsByRoom(appId: string): Promise<Map<string, string[]>> {
    const rows = await this.participants.aggregate<{
      _id: Types.ObjectId;
      userIds: Types.ObjectId[];
    }>([
      { $match: { appId: new Types.ObjectId(appId) } },
      { $group: { _id: '$roomId', userIds: { $push: '$userId' } } },
    ]);
    return new Map(rows.map((r) => [r._id.toHexString(), r.userIds.map((u) => u.toHexString())]));
  }

  /** One room's membership rows, earliest joiner first. */
  findParticipants(appId: string, roomId: string) {
    return this.participants
      .find({ appId: new Types.ObjectId(appId), roomId: new Types.ObjectId(roomId) })
      .sort({ joinedAt: 1 })
      .lean()
      .exec();
  }

  private async messageCounts(
    match: PipelineStage[],
    groupBy: '$appId' | '$roomId',
    since: Date,
  ): Promise<Map<string, MessageCounts>> {
    const rows = await this.messages.aggregate<{
      _id: Types.ObjectId;
      messages: number;
      messagesSince: number;
      lastMessageAt: Date | null;
    }>([
      ...match,
      {
        $group: {
          _id: groupBy,
          messages: { $sum: 1 },
          messagesSince: { $sum: { $cond: [{ $gte: ['$createdAt', since] }, 1, 0] } },
          lastMessageAt: { $max: '$createdAt' },
        },
      },
    ]);
    return new Map(
      rows.map((r) => [
        r._id.toHexString(),
        { messages: r.messages, messagesSince: r.messagesSince, lastMessageAt: r.lastMessageAt },
      ]),
    );
  }
}
