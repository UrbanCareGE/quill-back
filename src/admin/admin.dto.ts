import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IdField } from '@/common/transformers/id-field.transformer';
import { IsoDate } from '@/common/transformers/iso-date.transformer';

// ── Requests ───────────────────────────────────────────────────────────────

export class RegisterAppReq {
  /**
   * Human-readable identifier — used in logs and admin UIs. Lowercase ascii
   * letters / digits / dashes / underscores. Unique across all chat_apps
   * rows.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9_-]+$/, {
    message: 'label must be lowercase a-z, 0-9, hyphen or underscore',
  })
  label!: string;
}

/**
 * Body for `PATCH /admin/apps/:appId`. One patchable field today.
 *
 * `callbackUrl` is where Quill POSTs its notify callback after every sent
 * message in this tenant. **Both `null` and an omitted field clear it** — with
 * a single field there is no useful "leave unchanged" case to distinguish, and
 * cleared is the safe interpretation (it is also the default state: no URL
 * means no callback is ever fired).
 *
 * `@IsOptional()` is what lets an explicit `null` through — class-validator
 * skips the remaining validators for `null` *and* `undefined`.
 */
export class PatchAppReq {
  @IsOptional()
  // `require_tld: false` is deliberate and load-bearing: validator.js defaults
  // it to true, which rejects `http://localhost:8085/...` — the exact URL every
  // local dev setup points the callback at, and the one the runbook documents.
  // It also admits in-cluster service names (`http://core:8085/...`). The
  // protocol allowlist is what actually constrains the target; `PushService`
  // only ever POSTs, never follows redirects into anything else.
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(512)
  callbackUrl?: string | null;
}

/**
 * Query for the admin stats routes. `tz` is the IANA zone the per-day series
 * is bucketed in (the console sends the operator's own; default `UTC`), `days`
 * the length of that series.
 */
export class StatsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tz?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  days?: number;
}

// ── Responses ──────────────────────────────────────────────────────────────

export class AppRes {
  @IdField()
  appId!: string;
  label!: string;
  @IsoDate()
  createdAt!: string;
  @IsoDate()
  rotatedAt!: string | null;
  revoked!: boolean;
  /** Notify callback target; absent when the app has none configured. */
  callbackUrl?: string;
}

export class RegisterAppRes {
  @IdField()
  appId!: string;
  label!: string;
  /** Plaintext — shown ONCE. Capture and store immediately; cannot be retrieved later. */
  privateKey!: string;
}

export class RotateKeyRes {
  /** New plaintext key — replace the value in the consuming app's backend env. */
  privateKey!: string;
}

// ── Stats (read-only; counts and timestamps, never message content) ────────

/** One calendar day of the per-day series, in the requested time zone. */
export class DayCountRes {
  /** `YYYY-MM-DD`. */
  date!: string;
  messages!: number;
}

export class AppStatsRes {
  @IdField()
  appId!: string;
  label!: string;
  revoked!: boolean;
  /** Live (non-deleted) rooms. */
  rooms!: number;
  /** Membership rows: one per (room, user). */
  participants!: number;
  /** Distinct users across the app's rooms. */
  users!: number;
  /** Every message row ever sent, deleted ones included. */
  messages!: number;
  messages24h!: number;
  @IsoDate()
  lastMessageAt!: string | null;
  /** Users with at least one open socket right now. */
  liveUsers!: number;
  liveConnections!: number;
}

export class StatsTotalsRes {
  apps!: number;
  activeApps!: number;
  rooms!: number;
  participants!: number;
  users!: number;
  messages!: number;
  messages24h!: number;
  liveUsers!: number;
  liveConnections!: number;
}

export class OverviewRes {
  @IsoDate()
  generatedAt!: string;
  timeZone!: string;
  @Type(() => StatsTotalsRes)
  totals!: StatsTotalsRes;
  @Type(() => AppStatsRes)
  apps!: AppStatsRes[];
  /** Oldest day first, zero-filled, all apps together. */
  @Type(() => DayCountRes)
  messagesPerDay!: DayCountRes[];
}

export class RoomStatsRes {
  /** The caller-supplied room id (urbancare: the apartment id). */
  @IdField()
  roomId!: string;
  name!: string | null;
  deleted!: boolean;
  @IsoDate()
  createdAt!: string;
  participants!: number;
  /** Members with an open socket right now (anywhere in the app, not only this room). */
  liveUsers!: number;
  messages!: number;
  messages24h!: number;
  @IsoDate()
  lastMessageAt!: string | null;
}

export class RoomListRes {
  /** Newest room first. */
  @Type(() => RoomStatsRes)
  items!: RoomStatsRes[];
  /** True when the app has more rooms than one response carries. */
  truncated!: boolean;
}

export class ParticipantStatsRes {
  @IdField()
  userId!: string;
  @IsoDate()
  joinedAt!: string;
  @IsoDate()
  lastReadAt!: string | null;
  online!: boolean;
}

export class RoomDetailRes {
  @Type(() => RoomStatsRes)
  room!: RoomStatsRes;
  /** Earliest joiner first. */
  @Type(() => ParticipantStatsRes)
  participants!: ParticipantStatsRes[];
  timeZone!: string;
  @Type(() => DayCountRes)
  messagesPerDay!: DayCountRes[];
}
