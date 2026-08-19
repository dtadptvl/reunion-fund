-- Migration 009: Deterministic one-time cleanup of legacy 'Thủ Quỹ' identity strings

UPDATE staff_users
SET full_name = 'Dương Tuấn Anh'
WHERE full_name = 'Thủ Quỹ Lớp A1' OR full_name = 'Thủ Quỹ Lớp' OR full_name = 'Thủ Quỹ' OR full_name LIKE '%Thủ Quỹ%';

UPDATE users
SET full_name = 'Dương Tuấn Anh'
WHERE full_name = 'Thủ Quỹ Lớp A1' OR full_name = 'Thủ Quỹ Lớp' OR full_name = 'Thủ Quỹ' OR full_name LIKE '%Thủ Quỹ%';
