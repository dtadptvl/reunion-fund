import Database from 'better-sqlite3';
import { sortVietnameseMembers } from './member.service.js';

export interface MemberLotteryItem {
  id: string;
  full_name: string;
  disambiguator: string | null;
  total_contributed: number;
  contribution_count: number;
  lottery_probability: number;
  lottery_probability_display: string;
  is_lottery_eligible: boolean;
}

export interface MemberPersonalLotteryStats {
  memberId: string;
  totalContributed: number;
  lotteryProbability: number;
  lotteryProbabilityDisplay: string;
  isLotteryEligible: boolean;
  eligiblePool: number;
  baseFundExclusion: number;
}

export class LotteryService {
  constructor(private db: Database.Database) {}

  /**
   * Retrieves the configurable fixed class base fund that is excluded from lottery weight.
   * Defaults to 6,000,000 VND.
   */
  getBaseFundExclusion(): number {
    const row = this.db
      .prepare("SELECT value FROM system_state WHERE key = 'lottery_base_fund_exclusion'")
      .get() as { value: string } | undefined;

    if (!row || !row.value) {
      return 6000000;
    }
    const val = parseInt(row.value, 10);
    return isNaN(val) || val < 0 ? 6000000 : val;
  }

  /**
   * Sets the configurable fixed class base fund exclusion setting.
   */
  setBaseFundExclusion(amount: number): number {
    const validAmount = Math.max(0, Math.floor(amount));
    this.db
      .prepare(`
        INSERT INTO system_state (key, value)
        VALUES ('lottery_base_fund_exclusion', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `)
      .run(validAmount.toString());

    return validAmount;
  }

  /**
   * Calculates the total confirmed eligible member contributions (pool).
   * Note: The base fund (6,000,000 VND) and external contributions are strictly excluded.
   */
  getEligibleMemberPool(): number {
    const row = this.db
      .prepare(`
        SELECT COALESCE(SUM(amount), 0) as pool
        FROM contributions
        WHERE contributor_type = 'MEMBER' AND member_id IS NOT NULL
      `)
      .get() as { pool: number };

    return row?.pool || 0;
  }

  /**
   * Formats percentage with 2 decimal places in Vietnamese style.
   */
  private formatPercentage(pct: number): string {
    if (pct === 0) return '0%';
    const fixed = pct.toFixed(2);
    // Replace period with comma for Vietnamese display
    return fixed.replace('.', ',') + '%';
  }

  /**
   * Computes authoritative lottery probabilities for all canonical class members.
   * Sorted in Vietnamese class-list alphabetical order.
   */
  getMembersWithLotteryStats(): {
    members: MemberLotteryItem[];
    eligiblePool: number;
    baseFundExclusion: number;
    formulaDescription: string;
    baseFundNote: string;
  } {
    const baseFundExclusion = this.getBaseFundExclusion();
    const eligiblePool = this.getEligibleMemberPool();

    // Query all canonical members joined with their confirmed contributions
    const rawMembers = this.db
      .prepare(`
        SELECT
          m.id,
          m.full_name,
          m.disambiguator,
          COALESCE(SUM(c.amount), 0) as total_contributed,
          COUNT(c.id) as contribution_count
        FROM members m
        LEFT JOIN contributions c ON m.id = c.member_id AND c.contributor_type = 'MEMBER'
        GROUP BY m.id
      `)
      .all() as Array<{
        id: string;
        full_name: string;
        disambiguator: string | null;
        total_contributed: number;
        contribution_count: number;
      }>;

    const sortedMembers = sortVietnameseMembers(rawMembers);

    const members: MemberLotteryItem[] = sortedMembers.map((m) => {
      const contributed = Math.max(0, Math.floor(m.total_contributed));
      let probability = 0;

      if (eligiblePool > 0 && contributed > 0) {
        // Integer arithmetic scaled to avoid floating point drift
        const rawPct = (contributed / eligiblePool) * 100;
        probability = Math.round(rawPct * 100) / 100;
      }

      return {
        id: m.id,
        full_name: m.full_name,
        disambiguator: m.disambiguator,
        total_contributed: contributed,
        contribution_count: m.contribution_count,
        lottery_probability: probability,
        lottery_probability_display: this.formatPercentage(probability),
        is_lottery_eligible: contributed > 0,
      };
    });

    return {
      members,
      eligiblePool,
      baseFundExclusion,
      formulaDescription: 'Tỷ lệ quay thưởng = Tổng đóng góp của bạn / Tổng đóng góp hợp lệ của các thành viên',
      baseFundNote: '6.000.000 ₫ quỹ lớp nền không tham gia quay thưởng.',
    };
  }

  /**
   * Computes personalized lottery stats for a specific logged-in member by immutable memberId.
   */
  getMemberPersonalStats(memberId: string): MemberPersonalLotteryStats {
    const baseFundExclusion = this.getBaseFundExclusion();
    const eligiblePool = this.getEligibleMemberPool();

    const row = this.db
      .prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_contributed
        FROM contributions
        WHERE contributor_type = 'MEMBER' AND member_id = ?
      `)
      .get(memberId) as { total_contributed: number } | undefined;

    const totalContributed = row ? Math.max(0, Math.floor(row.total_contributed)) : 0;
    let lotteryProbability = 0;

    if (eligiblePool > 0 && totalContributed > 0) {
      const rawPct = (totalContributed / eligiblePool) * 100;
      lotteryProbability = Math.round(rawPct * 100) / 100;
    }

    return {
      memberId,
      totalContributed,
      lotteryProbability,
      lotteryProbabilityDisplay: this.formatPercentage(lotteryProbability),
      isLotteryEligible: totalContributed > 0,
      eligiblePool,
      baseFundExclusion,
    };
  }
}
