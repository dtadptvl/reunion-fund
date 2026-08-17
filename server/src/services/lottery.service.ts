import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { sortVietnameseMembers } from './member.service.js';
import { config } from '../config/env.js';

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

export interface LuckyWheelPrizeDef {
  prizeId: string;
  prizeTitle: string;
  prizeOrder: number;
  durationSeconds: number;
}

export const LUCKY_WHEEL_PRIZES: readonly LuckyWheelPrizeDef[] = [
  { prizeId: 'giai-ba', prizeTitle: 'Giải Ba', prizeOrder: 1, durationSeconds: 15 },
  { prizeId: 'giai-nhi', prizeTitle: 'Giải Nhì', prizeOrder: 2, durationSeconds: 25 },
  { prizeId: 'giai-nhat', prizeTitle: 'Giải Nhất', prizeOrder: 3, durationSeconds: 35 },
] as const;

export interface LuckyWheelSegment {
  memberId: string;
  fullName: string;
  disambiguator: string | null;
  weight: number;
  probability: number;
  probabilityDisplay: string;
  startAngle: number;
  endAngle: number;
}

export interface LuckyWheelDrawRow {
  id: string;
  prize_id: string;
  prize_title: string;
  prize_order: number;
  duration_seconds: number;
  winner_member_id: string;
  winner_name: string;
  winner_disambiguator: string | null;
  winner_weight: number;
  total_eligible_weight: number;
  eligible_snapshot_json: string;
  random_ticket: number;
  actor_username: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

export interface BackgroundMusicMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  actor: string;
}

export interface LuckyWheelState {
  serverTime: string;
  status: 'IDLE' | 'SPINNING' | 'FINISHED';
  currentPrize: LuckyWheelPrizeDef | null;
  nextPrize: LuckyWheelPrizeDef | null;
  hasBackgroundMusic: boolean;
  backgroundMusicMetadata: BackgroundMusicMetadata | null;
  allowTestReset: boolean;
  activeDraw: {
    prizeId: string;
    prizeTitle: string;
    durationSeconds: number;
    startedAt: string;
    completedAt: string;
    isSpinning: boolean;
    isRevealed: boolean;
    targetSegmentIndex: number;
    targetAngle: number;
    winner: {
      memberId: string;
      fullName: string;
      disambiguator: string | null;
      weight: number;
    } | null;
  } | null;
  wheelSegments: LuckyWheelSegment[];
  totalEligibleWeight: number;
  completedPrizes: Array<{
    prizeId: string;
    prizeTitle: string;
    prizeOrder: number;
    durationSeconds: number;
    winnerMemberId: string;
    winnerName: string;
    winnerDisambiguator: string | null;
    winnerWeight: number;
    completedAt: string;
  }>;
}

/**
 * Validates audio file header signatures (MP3, M4A, OGG).
 */
export function validateAudioMagicBytes(
  buffer: Buffer,
  originalFilename?: string
): { isValid: boolean; mimeType: string | null; error?: string } {
  if (!buffer || buffer.length < 4) {
    return { isValid: false, mimeType: null, error: 'Tập tin âm thanh rỗng hoặc không hợp lệ.' };
  }

  // 1. MP3 with ID3 tag: 49 44 33 ("ID3")
  if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    return { isValid: true, mimeType: 'audio/mpeg' };
  }

  // 2. MP3 frame sync without ID3: FF FB, FF F3, FF F2, FF E3 (0xFF 0xE0 mask)
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { isValid: true, mimeType: 'audio/mpeg' };
  }

  // 3. OGG audio: 4F 67 67 53 ("OggS")
  if (buffer[0] === 0x4f && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
    return { isValid: true, mimeType: 'audio/ogg' };
  }

  // 4. M4A / MP4 audio: offset 4: "ftyp" (66 74 79 70)
  if (
    buffer.length >= 12 &&
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    return { isValid: true, mimeType: 'audio/mp4' };
  }

  // Fallback by safe extension
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase();
    if (ext === '.mp3') return { isValid: true, mimeType: 'audio/mpeg' };
    if (ext === '.m4a') return { isValid: true, mimeType: 'audio/mp4' };
    if (ext === '.ogg') return { isValid: true, mimeType: 'audio/ogg' };
  }

  return {
    isValid: false,
    mimeType: null,
    error: 'Định dạng tập tin không được hỗ trợ (chỉ chấp nhận MP3, M4A, OGG).',
  };
}

export class LotteryService {
  private storageDir: string;

  constructor(private db: Database.Database, storageDir: string = config.STORAGE_PATH) {
    this.storageDir = storageDir;
  }

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

  // ==========================================
  // LUCKY WHEEL METHODS
  // ==========================================

  /**
   * Retrieves all completed draws ordered by prize order.
   */
  getCompletedDraws(): LuckyWheelDrawRow[] {
    return this.db
      .prepare('SELECT * FROM lucky_wheel_draws ORDER BY prize_order ASC')
      .all() as LuckyWheelDrawRow[];
  }

  /**
   * Computes remaining eligible wheel segments for a target prize (excluding previous prize winners).
   * Renormalizes probabilities to sum to 100% and calculates startAngle/endAngle on 0..360 deg circle.
   */
  getWheelSegments(excludedWinnerIds: Set<string>): { segments: LuckyWheelSegment[]; totalWeight: number } {
    const rawMembers = this.db
      .prepare(`
        SELECT
          m.id,
          m.full_name,
          m.disambiguator,
          COALESCE(SUM(c.amount), 0) as total_contributed
        FROM members m
        JOIN contributions c ON m.id = c.member_id AND c.contributor_type = 'MEMBER'
        GROUP BY m.id
        HAVING total_contributed > 0
      `)
      .all() as Array<{
        id: string;
        full_name: string;
        disambiguator: string | null;
        total_contributed: number;
      }>;

    // Filter out previous winners and ensure total_contributed > 0
    const eligibleList = rawMembers.filter((m) => !excludedWinnerIds.has(m.id) && m.total_contributed > 0);
    const sortedEligible = sortVietnameseMembers(eligibleList);

    const totalWeight = sortedEligible.reduce((sum, m) => sum + Math.max(0, Math.floor(m.total_contributed)), 0);

    let currentAngle = 0;
    const segments: LuckyWheelSegment[] = sortedEligible.map((m) => {
      const weight = Math.max(0, Math.floor(m.total_contributed));
      const fraction = totalWeight > 0 ? weight / totalWeight : 0;
      const angleSpan = fraction * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angleSpan;
      currentAngle = endAngle;

      const rawPct = fraction * 100;
      const probability = Math.round(rawPct * 100) / 100;

      return {
        memberId: m.id,
        fullName: m.full_name,
        disambiguator: m.disambiguator ?? null,
        weight,
        probability,
        probabilityDisplay: this.formatPercentage(probability),
        startAngle,
        endAngle,
      };
    });

    return { segments, totalWeight };
  }

  /**
   * Authoritatively triggers a lucky draw on the server.
   * - Enforces prize draw order: Giải Ba -> Giải Nhì -> Giải Nhất.
   * - Idempotent: returns existing draw if prize has already been drawn (no redrawing).
   * - Cryptographically secure weighted selection using crypto.randomInt(0, totalWeight).
   * - Audited and persisted before animation completes.
   */
  triggerDraw(prizeId: string, actor: string): LuckyWheelDrawRow {
    const prizeDef = LUCKY_WHEEL_PRIZES.find((p) => p.prizeId === prizeId);
    if (!prizeDef) {
      throw new Error(`Hạng mục giải thưởng không hợp lệ: ${prizeId}`);
    }

    // Check if draw already exists (idempotency)
    const existing = this.db
      .prepare('SELECT * FROM lucky_wheel_draws WHERE prize_id = ?')
      .get(prizeId) as LuckyWheelDrawRow | undefined;

    if (existing) {
      return existing;
    }

    // Verify order
    const completed = this.getCompletedDraws();
    const completedPrizeIds = new Set(completed.map((d) => d.prize_id));

    if (prizeDef.prizeOrder === 2 && !completedPrizeIds.has('giai-ba')) {
      throw new Error('Chưa thể quay Giải Nhì. Vui lòng quay Giải Ba trước.');
    }
    if (prizeDef.prizeOrder === 3 && !completedPrizeIds.has('giai-nhi')) {
      throw new Error('Chưa thể quay Giải Nhất. Vui lòng quay Giải Nhì trước.');
    }

    // Get previous winners
    const previousWinnerIds = new Set(completed.map((d) => d.winner_member_id));

    // Get eligible segments
    const { segments, totalWeight } = this.getWheelSegments(previousWinnerIds);
    if (segments.length === 0 || totalWeight <= 0) {
      throw new Error('Không có thành viên hợp lệ để quay thưởng.');
    }

    // Cryptographically secure weighted selection:
    // Generate random integer T in [0, totalWeight - 1]
    const randomTicket = crypto.randomInt(0, totalWeight);

    let cumulative = 0;
    let selectedSegment = segments[0];
    for (const seg of segments) {
      cumulative += seg.weight;
      if (randomTicket < cumulative) {
        selectedSegment = seg;
        break;
      }
    }

    const now = new Date();
    const startedAt = now.toISOString();
    const completedAt = new Date(now.getTime() + prizeDef.durationSeconds * 1000).toISOString();

    const drawRow: LuckyWheelDrawRow = {
      id: prizeDef.prizeId,
      prize_id: prizeDef.prizeId,
      prize_title: prizeDef.prizeTitle,
      prize_order: prizeDef.prizeOrder,
      duration_seconds: prizeDef.durationSeconds,
      winner_member_id: selectedSegment.memberId,
      winner_name: selectedSegment.fullName,
      winner_disambiguator: selectedSegment.disambiguator,
      winner_weight: selectedSegment.weight,
      total_eligible_weight: totalWeight,
      eligible_snapshot_json: JSON.stringify(segments),
      random_ticket: randomTicket,
      actor_username: actor,
      started_at: startedAt,
      completed_at: completedAt,
      created_at: startedAt,
    };

    const insertStmt = this.db.prepare(`
      INSERT INTO lucky_wheel_draws (
        id, prize_id, prize_title, prize_order, duration_seconds,
        winner_member_id, winner_name, winner_disambiguator, winner_weight,
        total_eligible_weight, eligible_snapshot_json, random_ticket, actor_username,
        started_at, completed_at, created_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, CURRENT_TIMESTAMP
      )
    `);

    const auditStmt = this.db.prepare(`
      INSERT INTO audit_logs (
        id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const tx = this.db.transaction(() => {
      insertStmt.run(
        drawRow.id,
        drawRow.prize_id,
        drawRow.prize_title,
        drawRow.prize_order,
        drawRow.duration_seconds,
        drawRow.winner_member_id,
        drawRow.winner_name,
        drawRow.winner_disambiguator,
        drawRow.winner_weight,
        drawRow.total_eligible_weight,
        drawRow.eligible_snapshot_json,
        drawRow.random_ticket,
        drawRow.actor_username,
        drawRow.started_at,
        drawRow.completed_at
      );

      auditStmt.run(
        crypto.randomUUID(),
        actor,
        'TRIGGER_LUCKY_DRAW',
        'LUCKY_WHEEL',
        prizeDef.prizeId,
        null,
        JSON.stringify({
          prizeId: prizeDef.prizeId,
          prizeTitle: prizeDef.prizeTitle,
          winnerMemberId: drawRow.winner_member_id,
          winnerName: drawRow.winner_name,
          winnerWeight: drawRow.winner_weight,
          randomTicket: drawRow.random_ticket,
          startedAt: drawRow.started_at,
          completedAt: drawRow.completed_at,
        })
      );
    });

    tx();

    return drawRow;
  }

  /**
   * Resets lucky wheel test state (STAGING ONLY gate).
   */
  resetLotteryState(actor: string, isAllowed: boolean): void {
    if (!isAllowed) {
      throw new Error('Chức năng đặt lại chỉ khả dụng trong môi trường kiểm thử/staging.');
    }

    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM lucky_wheel_draws').run();

      this.db.prepare(`
        INSERT INTO audit_logs (
          id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        crypto.randomUUID(),
        actor,
        'RESET_LUCKY_WHEEL_TEST_STATE',
        'LUCKY_WHEEL',
        'ALL',
        null,
        JSON.stringify({ resetAt: new Date().toISOString() })
      );
    });

    tx();
  }

  // ==========================================
  // BACKGROUND MUSIC METHODS
  // ==========================================

  getBackgroundMusicMetadata(): BackgroundMusicMetadata | null {
    const row = this.db
      .prepare("SELECT value FROM system_state WHERE key = 'lottery_background_music'")
      .get() as { value: string } | undefined;

    if (!row || !row.value) return null;
    try {
      return JSON.parse(row.value) as BackgroundMusicMetadata;
    } catch {
      return null;
    }
  }

  getBackgroundMusicFilePath(): { filePath: string; mimeType: string } | null {
    const meta = this.getBackgroundMusicMetadata();
    if (!meta) return null;

    const audioDir = path.join(this.storageDir, 'audio');
    const fullPath = path.join(audioDir, meta.filename);

    if (fs.existsSync(fullPath)) {
      return { filePath: fullPath, mimeType: meta.mimeType };
    }
    return null;
  }

  saveBackgroundMusic(buffer: Buffer, originalFilename: string, actor: string): BackgroundMusicMetadata {
    const validation = validateAudioMagicBytes(buffer, originalFilename);
    if (!validation.isValid || !validation.mimeType) {
      throw new Error(validation.error || 'Tập tin âm thanh không hợp lệ.');
    }

    const audioDir = path.join(this.storageDir, 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    // Remove any previous music file
    const oldMeta = this.getBackgroundMusicMetadata();
    if (oldMeta) {
      try {
        const oldFile = path.join(audioDir, oldMeta.filename);
        if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
      } catch {
        // ignore
      }
    }

    const ext = path.extname(originalFilename).toLowerCase() || '.mp3';
    const safeFilename = `lottery_bgm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const targetPath = path.join(audioDir, safeFilename);

    fs.writeFileSync(targetPath, buffer);

    const meta: BackgroundMusicMetadata = {
      filename: safeFilename,
      originalName: path.basename(originalFilename),
      mimeType: validation.mimeType,
      sizeBytes: buffer.length,
      uploadedAt: new Date().toISOString(),
      actor,
    };

    const tx = this.db.transaction(() => {
      this.db
        .prepare(`
          INSERT INTO system_state (key, value)
          VALUES ('lottery_background_music', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(JSON.stringify(meta));

      this.db
        .prepare(`
          INSERT INTO audit_logs (
            id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .run(
          crypto.randomUUID(),
          actor,
          'UPLOAD_LOTTERY_MUSIC',
          'LOTTERY_MUSIC',
          safeFilename,
          oldMeta ? JSON.stringify(oldMeta) : null,
          JSON.stringify(meta)
        );
    });

    tx();

    return meta;
  }

  deleteBackgroundMusic(actor: string): void {
    const oldMeta = this.getBackgroundMusicMetadata();
    if (!oldMeta) return;

    const audioDir = path.join(this.storageDir, 'audio');
    const oldFile = path.join(audioDir, oldMeta.filename);
    try {
      if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    } catch {
      // ignore
    }

    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM system_state WHERE key = 'lottery_background_music'").run();

      this.db
        .prepare(`
          INSERT INTO audit_logs (
            id, actor, action, entity_type, entity_id, before_state, after_state, timestamp
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
        .run(
          crypto.randomUUID(),
          actor,
          'DELETE_LOTTERY_MUSIC',
          'LOTTERY_MUSIC',
          oldMeta.filename,
          JSON.stringify(oldMeta),
          null
        );
    });

    tx();
  }

  /**
   * Retrieves the current real-time synchronized state of the Lucky Wheel.
   */
  getPublicWheelState(): LuckyWheelState {
    const completedDraws = this.getCompletedDraws();
    const completedPrizeIds = new Set(completedDraws.map((d) => d.prize_id));
    const previousWinnerIds = new Set(completedDraws.map((d) => d.winner_member_id));

    // Find next pending prize
    const nextPrize = LUCKY_WHEEL_PRIZES.find((p) => !completedPrizeIds.has(p.prizeId)) || null;

    // Check if there is an active spinning draw or most recent draw
    const now = new Date();
    const nowMs = now.getTime();

    // Find active draw: either currently spinning or the most recent completed draw
    const latestDraw = completedDraws.length > 0 ? completedDraws[completedDraws.length - 1] : null;

    let activeDrawInfo: LuckyWheelState['activeDraw'] = null;
    let currentPrize: LuckyWheelPrizeDef | null = nextPrize;
    let status: LuckyWheelState['status'] = 'IDLE';

    let { segments, totalWeight } = this.getWheelSegments(previousWinnerIds);

    if (latestDraw) {
      const startedMs = new Date(latestDraw.started_at).getTime();
      const durationMs = latestDraw.duration_seconds * 1000;
      const completedMs = startedMs + durationMs;
      const isSpinning = nowMs < completedMs;

      // When the latest draw is spinning or is the active target, reconstruct its wheel segments
      if (isSpinning || (!nextPrize && completedDraws.length === LUCKY_WHEEL_PRIZES.length)) {
        try {
          const snapshot = JSON.parse(latestDraw.eligible_snapshot_json) as LuckyWheelSegment[];
          if (Array.isArray(snapshot) && snapshot.length > 0) {
            segments = snapshot;
            totalWeight = latestDraw.total_eligible_weight;
          }
        } catch {
          // fallback to current segments
        }
      }

      // Find target segment index
      const targetIndex = segments.findIndex((s) => s.memberId === latestDraw.winner_member_id);
      const targetSeg = targetIndex >= 0 ? segments[targetIndex] : null;
      const targetAngle = targetSeg ? (targetSeg.startAngle + targetSeg.endAngle) / 2 : 0;

      activeDrawInfo = {
        prizeId: latestDraw.prize_id,
        prizeTitle: latestDraw.prize_title,
        durationSeconds: latestDraw.duration_seconds,
        startedAt: latestDraw.started_at,
        completedAt: latestDraw.completed_at,
        isSpinning,
        isRevealed: nowMs >= completedMs,
        targetSegmentIndex: targetIndex,
        targetAngle,
        winner: {
          memberId: latestDraw.winner_member_id,
          fullName: latestDraw.winner_name,
          disambiguator: latestDraw.winner_disambiguator,
          weight: latestDraw.winner_weight,
        },
      };

      if (isSpinning) {
        status = 'SPINNING';
        currentPrize = LUCKY_WHEEL_PRIZES.find((p) => p.prizeId === latestDraw.prize_id) || null;
      } else if (!nextPrize) {
        status = 'FINISHED';
        currentPrize = null;
      }
    }

    const musicMeta = this.getBackgroundMusicMetadata();

    return {
      serverTime: now.toISOString(),
      status,
      currentPrize,
      nextPrize,
      hasBackgroundMusic: Boolean(musicMeta),
      backgroundMusicMetadata: musicMeta,
      allowTestReset: config.ALLOW_LOTTERY_TEST_RESET,
      activeDraw: activeDrawInfo,
      wheelSegments: segments,
      totalEligibleWeight: totalWeight,
      completedPrizes: completedDraws.map((d) => ({
        prizeId: d.prize_id,
        prizeTitle: d.prize_title,
        prizeOrder: d.prize_order,
        durationSeconds: d.duration_seconds,
        winnerMemberId: d.winner_member_id,
        winnerName: d.winner_name,
        winnerDisambiguator: d.winner_disambiguator,
        winnerWeight: d.winner_weight,
        completedAt: d.completed_at,
      })),
    };
  }
}
