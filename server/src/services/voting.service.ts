import Database from 'better-sqlite3';
import crypto from 'crypto';
import { MemberRow } from '../db/schema.js';
import { sortVietnameseMembers } from './member.service.js';

export interface VotingCategoryRow {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  manual_winner_member_id: string | null;
  created_at: string;
}

export interface PublicCandidateVoteCount {
  member_id: string;
  full_name: string;
  disambiguator: string | null;
  vote_count: number;
}

export interface PublicCategoryVoteCount {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  total_votes: number;
  candidates: PublicCandidateVoteCount[];
}

export interface VoteRow {
  id: string;
  category_id: string;
  voter_user_id: string;
  voter_member_id: string;
  candidate_member_id: string;
  created_at: string;
  updated_at: string;
}

export interface CandidateResult {
  member_id: string;
  full_name: string;
  disambiguator: string | null;
  vote_count: number;
  total_contributed: number;
  is_eligible_winner: boolean;
  rank: number;
}

export interface CategoryResult {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  total_votes: number;
  candidates: CandidateResult[];
  winner: {
    member_id: string;
    full_name: string;
    disambiguator: string | null;
    vote_count: number;
    total_contributed: number;
    is_manual_selection: boolean;
  } | null;
  needs_admin_tie_break: boolean;
  tied_candidates: Array<{
    member_id: string;
    full_name: string;
    disambiguator: string | null;
    vote_count: number;
    total_contributed: number;
  }>;
}

export interface AwardPresentationItem {
  categoryId: string;
  title: string;
  description: string | null;
  displayOrder: number;
  winner: {
    memberId: string;
    fullName: string;
    disambiguator: string | null;
  } | null;
}

export class VotingService {
  constructor(private db: Database.Database) {}

  getCategories(): VotingCategoryRow[] {
    return this.db
      .prepare('SELECT * FROM voting_categories ORDER BY display_order ASC')
      .all() as VotingCategoryRow[];
  }

  isVotingLocked(): boolean {
    const row = this.db
      .prepare("SELECT value FROM system_state WHERE key = 'is_voting_locked'")
      .get() as { value: string } | undefined;
    return row?.value === 'true';
  }

  setVotingLock(locked: boolean, actor: string): { isLocked: boolean } {
    this.db
      .prepare(
        `INSERT INTO system_state (key, value)
         VALUES ('is_voting_locked', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(locked ? 'true' : 'false');

    this.db
      .prepare(
        `INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .run(
        crypto.randomUUID(),
        actor,
        locked ? 'LOCK_VOTING' : 'UNLOCK_VOTING',
        'SYSTEM_STATE',
        'is_voting_locked',
        JSON.stringify({ isLocked: !locked }),
        JSON.stringify({ isLocked: locked, timestamp: new Date().toISOString() })
      );

    return { isLocked: locked };
  }

  getUserVotes(userId: string): Record<string, string> {
    const rows = this.db
      .prepare('SELECT category_id, candidate_member_id FROM votes WHERE voter_user_id = ?')
      .all(userId) as Array<{ category_id: string; candidate_member_id: string }>;

    const map: Record<string, string> = {};
    for (const r of rows) {
      map[r.category_id] = r.candidate_member_id;
    }
    return map;
  }

  castVotes(
    userId: string,
    voterMemberId: string,
    votes: Array<{ categoryId: string; candidateMemberId: string }>,
    actor: string
  ): { success: boolean; votes: Record<string, string> } {
    if (this.isVotingLocked()) {
      throw new Error('Bình chọn đã bị khóa bởi Ban Quản trị. Không thể thay đổi phiếu bầu.');
    }

    if (!votes || votes.length === 0) {
      throw new Error('Danh sách bình chọn không hợp lệ.');
    }

    // Validate candidates against canonical members
    const allMembers = this.db.prepare('SELECT id FROM members').all() as Array<{ id: string }>;
    const memberIdSet = new Set(allMembers.map((m) => m.id));

    // Validate categories
    const categories = this.getCategories();
    const categoryIdSet = new Set(categories.map((c) => c.id));

    const upsertStmt = this.db.prepare(`
      INSERT INTO votes (id, category_id, voter_user_id, voter_member_id, candidate_member_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(voter_user_id, category_id) DO UPDATE SET
        candidate_member_id = excluded.candidate_member_id,
        updated_at = CURRENT_TIMESTAMP
    `);

    const tx = this.db.transaction(() => {
      for (const item of votes) {
        if (!categoryIdSet.has(item.categoryId)) {
          throw new Error(`Hạng mục bình chọn không hợp lệ: ${item.categoryId}`);
        }
        if (!memberIdSet.has(item.candidateMemberId)) {
          throw new Error(`Thành viên được chọn không hợp lệ: ${item.candidateMemberId}`);
        }

        upsertStmt.run(
          crypto.randomUUID(),
          item.categoryId,
          userId,
          voterMemberId,
          item.candidateMemberId
        );
      }

      // Audit log
      this.db
        .prepare(`
          INSERT INTO audit_logs (
            id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .run(
          crypto.randomUUID(),
          actor,
          'CAST_VOTE',
          'USER',
          userId,
          null,
          JSON.stringify({ voterMemberId, voteCount: votes.length, timestamp: new Date().toISOString() })
        );
    });

    tx();

    return {
      success: true,
      votes: this.getUserVotes(userId),
    };
  }

  setManualWinner(categoryId: string, candidateMemberId: string, actor: string): { success: boolean } {
    const category = this.db.prepare('SELECT * FROM voting_categories WHERE id = ?').get(categoryId);
    if (!category) {
      throw new Error('Hạng mục bình chọn không tồn tại.');
    }

    const member = this.db.prepare('SELECT * FROM members WHERE id = ?').get(candidateMemberId) as MemberRow | undefined;
    if (!member) {
      throw new Error('Thành viên không tồn tại trong danh sách lớp.');
    }

    this.db
      .prepare('UPDATE voting_categories SET manual_winner_member_id = ? WHERE id = ?')
      .run(candidateMemberId, categoryId);

    this.db
      .prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `)
      .run(
        crypto.randomUUID(),
        actor,
        'SET_AWARD_WINNER',
        'VOTING_CATEGORY',
        categoryId,
        null,
        JSON.stringify({
          categoryId,
          winnerMemberId: candidateMemberId,
          winnerName: member.full_name,
          timestamp: new Date().toISOString(),
        })
      );

    return { success: true };
  }

  /**
   * Authoritative results breakdown (ADMIN-only).
   * Ranks candidates by:
   * 1. vote count (DESC)
   * 2. confirmed contribution total (DESC)
   * 3. if still tied, requires Admin manual selection.
   * Only candidates with confirmed contribution > 0 are eligible to win.
   */
  getAdminResults(): { isLocked: boolean; categories: CategoryResult[] } {
    const categories = this.getCategories();
    const isLocked = this.isVotingLocked();

    // Map contribution totals by member
    const contribRows = this.db
      .prepare(`
        SELECT member_id, COALESCE(SUM(amount), 0) as total_contributed
        FROM contributions
        WHERE contributor_type = 'MEMBER' AND member_id IS NOT NULL
        GROUP BY member_id
      `)
      .all() as Array<{ member_id: string; total_contributed: number }>;

    const contribMap = new Map<string, number>();
    for (const c of contribRows) {
      contribMap.set(c.member_id, Math.max(0, Math.floor(c.total_contributed)));
    }

    // Map member info
    const members = this.db.prepare('SELECT id, full_name, disambiguator FROM members').all() as MemberRow[];
    const memberMap = new Map<string, MemberRow>();
    for (const m of members) {
      memberMap.set(m.id, m);
    }

    const categoryResults: CategoryResult[] = [];

    for (const cat of categories) {
      // Get all votes for this category
      const voteCounts = this.db
        .prepare(`
          SELECT candidate_member_id, COUNT(*) as vote_count
          FROM votes
          WHERE category_id = ?
          GROUP BY candidate_member_id
        `)
        .all(cat.id) as Array<{ candidate_member_id: string; vote_count: number }>;

      const totalVotes = voteCounts.reduce((sum, v) => sum + v.vote_count, 0);

      // Build candidate list
      const candidateList: CandidateResult[] = voteCounts.map((vc) => {
        const m = memberMap.get(vc.candidate_member_id);
        const contributed = contribMap.get(vc.candidate_member_id) || 0;
        return {
          member_id: vc.candidate_member_id,
          full_name: m?.full_name || 'Thành viên',
          disambiguator: m?.disambiguator || null,
          vote_count: vc.vote_count,
          total_contributed: contributed,
          is_eligible_winner: contributed > 0, // Must have confirmed contribution > 0
          rank: 1,
        };
      });

      // Sort candidate list:
      // 1. vote_count DESC
      // 2. total_contributed DESC
      candidateList.sort((a, b) => {
        if (b.vote_count !== a.vote_count) {
          return b.vote_count - a.vote_count;
        }
        return b.total_contributed - a.total_contributed;
      });

      // Assign ranks
      candidateList.forEach((c, index) => {
        c.rank = index + 1;
      });

      // Filter eligible candidates for winner selection
      const eligibleCandidates = candidateList.filter((c) => c.is_eligible_winner);

      let winner: CategoryResult['winner'] = null;
      let needsAdminTieBreak = false;
      let tiedCandidates: CategoryResult['tied_candidates'] = [];

      if (eligibleCandidates.length > 0) {
        const top = eligibleCandidates[0];
        // Check if there are other eligible candidates tied with top in BOTH votes AND contributions
        const exactTies = eligibleCandidates.filter(
          (c) => c.vote_count === top.vote_count && c.total_contributed === top.total_contributed
        );

        if (exactTies.length > 1) {
          needsAdminTieBreak = true;
          tiedCandidates = exactTies.map((c) => ({
            member_id: c.member_id,
            full_name: c.full_name,
            disambiguator: c.disambiguator,
            vote_count: c.vote_count,
            total_contributed: c.total_contributed,
          }));

          // If Admin already manually picked one of the tied candidates
          if (cat.manual_winner_member_id) {
            const manualWinner = exactTies.find((c) => c.member_id === cat.manual_winner_member_id);
            if (manualWinner) {
              winner = {
                member_id: manualWinner.member_id,
                full_name: manualWinner.full_name,
                disambiguator: manualWinner.disambiguator,
                vote_count: manualWinner.vote_count,
                total_contributed: manualWinner.total_contributed,
                is_manual_selection: true,
              };
            }
          }
        } else {
          // Unambiguous winner
          winner = {
            member_id: top.member_id,
            full_name: top.full_name,
            disambiguator: top.disambiguator,
            vote_count: top.vote_count,
            total_contributed: top.total_contributed,
            is_manual_selection: false,
          };
        }
      }

      categoryResults.push({
        id: cat.id,
        title: cat.title,
        description: cat.description,
        display_order: cat.display_order,
        total_votes: totalVotes,
        candidates: candidateList,
        winner,
        needs_admin_tie_break: needsAdminTieBreak && !winner,
        tied_candidates: tiedCandidates,
      });
    }

    return {
      isLocked,
      categories: categoryResults,
    };
  }

  /**
   * Data for Admin presentation mode (omits raw vote counts to maintain ceremony suspense).
   */
  getPresentationData(): { awards: AwardPresentationItem[] } {
    const adminResults = this.getAdminResults();
    const awards: AwardPresentationItem[] = adminResults.categories.map((c) => ({
      categoryId: c.id,
      title: c.title,
      description: c.description,
      displayOrder: c.display_order,
      winner: c.winner
        ? {
            memberId: c.winner.member_id,
            fullName: c.winner.full_name,
            disambiguator: c.winner.disambiguator,
          }
        : null,
    }));

    return { awards };
  }

  /**
   * Publicly accessible vote counts per candidate (sanitized, zero voter identities).
   */
  getPublicVoteCounts(): PublicCategoryVoteCount[] {
    const categories = this.getCategories();
    const members = this.db.prepare('SELECT id, full_name, disambiguator FROM members').all() as MemberRow[];

    return categories.map((cat) => {
      const voteCounts = this.db
        .prepare(`
          SELECT candidate_member_id, COUNT(*) as vote_count
          FROM votes
          WHERE category_id = ?
          GROUP BY candidate_member_id
        `)
        .all(cat.id) as Array<{ candidate_member_id: string; vote_count: number }>;

      const countMap = new Map<string, number>();
      let totalVotes = 0;
      for (const vc of voteCounts) {
        countMap.set(vc.candidate_member_id, vc.vote_count);
        totalVotes += vc.vote_count;
      }

      const candidateList: PublicCandidateVoteCount[] = members.map((m) => ({
        member_id: m.id,
        full_name: m.full_name,
        disambiguator: m.disambiguator ?? null,
        vote_count: countMap.get(m.id) || 0,
      }));

      const sortedCandidates = sortVietnameseMembers(candidateList);

      return {
        id: cat.id,
        title: cat.title,
        description: cat.description,
        display_order: cat.display_order,
        total_votes: totalVotes,
        candidates: sortedCandidates,
      };
    });
  }
}
