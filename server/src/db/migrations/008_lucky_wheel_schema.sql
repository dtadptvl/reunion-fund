-- Migration 008: Lucky Wheel Draws Schema

CREATE TABLE IF NOT EXISTS lucky_wheel_draws (
    id TEXT PRIMARY KEY, -- 'giai-ba', 'giai-nhi', 'giai-nhat'
    prize_id TEXT NOT NULL,
    prize_title TEXT NOT NULL,
    prize_order INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    winner_member_id TEXT NOT NULL REFERENCES members(id),
    winner_name TEXT NOT NULL,
    winner_disambiguator TEXT,
    winner_weight INTEGER NOT NULL,
    total_eligible_weight INTEGER NOT NULL,
    eligible_snapshot_json TEXT NOT NULL,
    random_ticket INTEGER NOT NULL,
    actor_username TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_lucky_wheel_order ON lucky_wheel_draws(prize_order);
CREATE INDEX IF NOT EXISTS idx_lucky_wheel_winner ON lucky_wheel_draws(winner_member_id);
