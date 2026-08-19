-- Migration 009: Deterministic one-time cleanup of legacy exact 'Thủ Quỹ' identity strings

UPDATE staff_users
SET full_name = 'Dương Tuấn Anh'
WHERE full_name IN ('Thủ Quỹ Lớp A1', 'Thủ Quỹ Lớp', 'Thủ Quỹ');

UPDATE users
SET full_name = 'Dương Tuấn Anh'
WHERE full_name IN ('Thủ Quỹ Lớp A1', 'Thủ Quỹ Lớp', 'Thủ Quỹ');
