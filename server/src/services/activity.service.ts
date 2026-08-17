import Database from 'better-sqlite3';
import crypto from 'crypto';
import {
  ActivityRow,
  ActivityRSVPRow,
  ActivityPublicSummary,
  ActivityPublicParticipant,
} from '../db/schema.js';

export interface SaveRsvpItem {
  activityId: string;
  participantCount: number;
  notes?: string;
}

export class ActivityService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Get all defined reunion activities
   */
  getActivities(): ActivityRow[] {
    return this.db
      .prepare('SELECT * FROM activities ORDER BY display_order ASC, title ASC')
      .all() as ActivityRow[];
  }

  /**
   * Check if RSVP registration is currently locked by Admin
   */
  isRsvpLocked(): boolean {
    const row = this.db
      .prepare("SELECT value FROM system_state WHERE key = 'is_rsvp_locked'")
      .get() as { value: string } | undefined;
    return row ? row.value === 'true' : false;
  }

  /**
   * Lock or unlock RSVP registration (Admin only)
   */
  setRsvpLock(locked: boolean, actor: string): { isLocked: boolean } {
    this.db
      .prepare(
        `INSERT INTO system_state (key, value)
         VALUES ('is_rsvp_locked', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(locked ? 'true' : 'false');

    // Audit log
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, actor, action, target_type, target_id, details)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        actor,
        locked ? 'LOCK_ACTIVITY_RSVP' : 'UNLOCK_ACTIVITY_RSVP',
        'SYSTEM_STATE',
        'is_rsvp_locked',
        JSON.stringify({ isLocked: locked, timestamp: new Date().toISOString() })
      );

    return { isLocked: locked };
  }

  /**
   * Public participation summary for all activities.
   * Public list displays: activity name, total registered count, participating class members, and each member's count.
   * Email and username are strictly omitted.
   */
  getPublicActivitySummaries(): {
    isLocked: boolean;
    activities: ActivityPublicSummary[];
  } {
    const isLocked = this.isRsvpLocked();
    const activities = this.getActivities();

    const rsvpRows = this.db
      .prepare(
        `SELECT
           r.activity_id,
           r.member_id,
           r.participant_count,
           r.updated_at,
           m.full_name,
           m.disambiguator
         FROM activity_rsvps r
         JOIN members m ON r.member_id = m.id
         ORDER BY m.full_name ASC`
      )
      .all() as Array<{
        activity_id: string;
        member_id: string;
        participant_count: number;
        updated_at: string;
        full_name: string;
        disambiguator: string | null;
      }>;

    const rsvpsByActivity = new Map<string, ActivityPublicParticipant[]>();
    for (const r of rsvpRows) {
      if (!rsvpsByActivity.has(r.activity_id)) {
        rsvpsByActivity.set(r.activity_id, []);
      }
      rsvpsByActivity.get(r.activity_id)!.push({
        member_id: r.member_id,
        full_name: r.full_name,
        disambiguator: r.disambiguator,
        participant_count: r.participant_count,
        updated_at: r.updated_at,
      });
    }

    const summaries: ActivityPublicSummary[] = activities.map((act) => {
      const participants = rsvpsByActivity.get(act.id) || [];
      const totalParticipants = participants.reduce((sum, p) => sum + p.participant_count, 0);

      return {
        id: act.id,
        title: act.title,
        description: act.description,
        display_order: act.display_order,
        total_participants: totalParticipants,
        participants,
      };
    });

    return {
      isLocked,
      activities: summaries,
    };
  }

  /**
   * Get current member's registered RSVPs
   */
  getMemberRsvps(memberId: string): ActivityRSVPRow[] {
    return this.db
      .prepare('SELECT * FROM activity_rsvps WHERE member_id = ? ORDER BY created_at ASC')
      .all(memberId) as ActivityRSVPRow[];
  }

  /**
   * Save or update member's activity RSVPs.
   * Enforces positive integer participant_count and registration lock.
   */
  saveMemberRsvps(
    memberId: string,
    userId: string,
    rsvps: SaveRsvpItem[],
    actor: string
  ): { success: boolean; rsvps: ActivityRSVPRow[] } {
    if (this.isRsvpLocked()) {
      throw new Error('Đăng ký tham gia hoạt động đã bị khóa bởi Ban Quản trị.');
    }

    // Validate activities exist
    const validActivities = new Set(this.getActivities().map((a) => a.id));
    for (const item of rsvps) {
      if (!validActivities.has(item.activityId)) {
        throw new Error(`Hoạt động không hợp lệ: ${item.activityId}`);
      }
      const count = Number(item.participantCount);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error('Số người tham gia phải là số nguyên dương (tối thiểu 1 người).');
      }
    }

    const tx = this.db.transaction(() => {
      // Clear current RSVPs for this member
      this.db.prepare('DELETE FROM activity_rsvps WHERE member_id = ?').run(memberId);

      const now = new Date().toISOString();
      const insertStmt = this.db.prepare(
        `INSERT INTO activity_rsvps (id, activity_id, member_id, user_id, participant_count, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const item of rsvps) {
        const id = crypto.randomUUID();
        insertStmt.run(
          id,
          item.activityId,
          memberId,
          userId,
          Math.floor(item.participantCount),
          item.notes?.trim() || null,
          now,
          now
        );
      }

      // Audit log
      this.db
        .prepare(
          `INSERT INTO audit_logs (id, actor, action, target_type, target_id, details)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          crypto.randomUUID(),
          actor,
          'SAVE_ACTIVITY_RSVP',
          'MEMBER',
          memberId,
          JSON.stringify({ rsvpsCount: rsvps.length, timestamp: now })
        );
    });

    tx();

    return {
      success: true,
      rsvps: this.getMemberRsvps(memberId),
    };
  }

  /**
   * Admin full summary of registrations
   */
  getAdminRsvpOverview(): {
    isLocked: boolean;
    totalDistinctMembers: number;
    activitySummaries: Array<{
      id: string;
      title: string;
      description?: string | null;
      display_order: number;
      memberCount: number;
      totalPeopleCount: number;
      participants: Array<{
        memberId: string;
        fullName: string;
        disambiguator?: string | null;
        participantCount: number;
        notes?: string | null;
        updatedAt: string;
      }>;
    }>;
  } {
    const isLocked = this.isRsvpLocked();
    const activities = this.getActivities();

    const distinctMembersCountRow = this.db
      .prepare('SELECT COUNT(DISTINCT member_id) as count FROM activity_rsvps')
      .get() as { count: number };

    const rsvpRows = this.db
      .prepare(
        `SELECT
           r.activity_id,
           r.member_id,
           r.participant_count,
           r.notes,
           r.updated_at,
           m.full_name,
           m.disambiguator
         FROM activity_rsvps r
         JOIN members m ON r.member_id = m.id
         ORDER BY m.full_name ASC`
      )
      .all() as Array<{
        activity_id: string;
        member_id: string;
        participant_count: number;
        notes: string | null;
        updated_at: string;
        full_name: string;
        disambiguator: string | null;
      }>;

    const rsvpsByActivity = new Map<string, any[]>();
    for (const r of rsvpRows) {
      if (!rsvpsByActivity.has(r.activity_id)) {
        rsvpsByActivity.set(r.activity_id, []);
      }
      rsvpsByActivity.get(r.activity_id)!.push({
        memberId: r.member_id,
        fullName: r.full_name,
        disambiguator: r.disambiguator,
        participantCount: r.participant_count,
        notes: r.notes,
        updatedAt: r.updated_at,
      });
    }

    const activitySummaries = activities.map((act) => {
      const participants = rsvpsByActivity.get(act.id) || [];
      const totalPeopleCount = participants.reduce((sum, p) => sum + p.participantCount, 0);

      return {
        id: act.id,
        title: act.title,
        description: act.description,
        display_order: act.display_order,
        memberCount: participants.length,
        totalPeopleCount,
        participants,
      };
    });

    return {
      isLocked,
      totalDistinctMembers: distinctMembersCountRow.count,
      activitySummaries,
    };
  }
}
