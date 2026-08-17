-- Migration 005: Activity RSVP & Reunion Plan

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_rsvps (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_count INTEGER NOT NULL DEFAULT 1 CHECK(participant_count >= 1),
  notes TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(activity_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_rsvps_activity ON activity_rsvps(activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_rsvps_member ON activity_rsvps(member_id);
CREATE INDEX IF NOT EXISTS idx_activity_rsvps_user ON activity_rsvps(user_id);

-- Seed initial system_state for rsvp lock if not present
INSERT OR IGNORE INTO system_state (key, value) VALUES ('is_rsvp_locked', 'false');

-- Seed initial 4 activities
INSERT OR IGNORE INTO activities (id, title, description, display_order) VALUES
  ('ve-truong', 'Về trường tặng quà', 'Thăm lại trường xưa THPT Văn Lâm và trao quà lưu niệm', 1),
  ('ve-nha-co', 'Về nhà tặng quà cô giáo', 'Đến thăm và chúc sức khỏe cô giáo chủ nhiệm', 2),
  ('an-uong', 'Ăn uống', 'Tiệc liên hoan họp mặt kỷ niệm 10 năm ra trường', 3),
  ('vui-choi', 'Vui chơi sau ăn', 'Giao lưu văn nghệ, hát hò và trò chuyện', 4);
