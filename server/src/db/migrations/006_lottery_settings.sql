-- Migration 006: Lottery Base Fund Exclusion Setting

INSERT OR IGNORE INTO system_state (key, value)
VALUES ('lottery_base_fund_exclusion', '6000000');
