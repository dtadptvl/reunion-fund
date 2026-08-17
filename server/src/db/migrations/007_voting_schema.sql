-- Migration 007: Voting Categories, Votes, and Admin Awards Schema

-- 1. Voting Categories
CREATE TABLE IF NOT EXISTS voting_categories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    display_order INTEGER NOT NULL,
    manual_winner_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Votes (Exactly 1 vote per category per voter account)
CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL REFERENCES voting_categories(id) ON DELETE CASCADE,
    voter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    voter_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    candidate_member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(voter_user_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_category ON votes(category_id);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON votes(candidate_member_id);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_user_id);

-- 3. System State: is_voting_locked
INSERT OR IGNORE INTO system_state (key, value)
VALUES ('is_voting_locked', 'false');

-- 4. Seed Canonical 3 Award Categories
INSERT OR IGNORE INTO voting_categories (id, title, description, display_order)
VALUES 
    ('dang-quy-nhat', 'Người bạn cùng lớp đáng quý nhất', 'Gương mặt luôn thân thiện, giúp đỡ và gắn kết tập thể lớp A1', 1),
    ('gia-dinh-vien-man', 'Gia đình viên mãn nhất', 'Gia đình hạnh phúc, ấm êm và tràn đầy yêu thương', 2),
    ('su-nghiep-an-tuong', 'Sự nghiệp ấn tượng nhất', 'Những bước tiến và thành tựu xuất sắc trong công việc, sự nghiệp', 3);
