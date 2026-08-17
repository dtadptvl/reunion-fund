import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';
import { stringify } from 'csv-stringify/sync';

export class ExportService {
  constructor(private db: Database.Database) {}

  generatePublicXLSX(): Buffer {
    const workbook = XLSX.utils.book_new();

    // 1. Sheet Tổng quan
    const totals = this.getFinancialTotals();
    const overviewData = [
      { 'Chỉ số': 'Tổng số tiền đã thu (Đóng góp)', 'Giá trị (VNĐ)': totals.totalIncome },
      { 'Chỉ số': 'Tổng số tiền đã chi (Chi phí)', 'Giá trị (VNĐ)': totals.totalExpense },
      { 'Chỉ số': 'Số dư quỹ hiện tại', 'Giá trị (VNĐ)': totals.balance },
      { 'Chỉ số': 'Số người đã đóng góp', 'Giá trị (VNĐ)': totals.contributorCount },
      { 'Chỉ số': 'Trạng thái quyết toán', 'Giá trị (VNĐ)': totals.isSettled ? 'ĐÃ QUYẾT TOÁN' : 'Đang hoạt động' },
    ];
    const wsOverview = XLSX.utils.json_to_sheet(overviewData);
    XLSX.utils.book_append_sheet(workbook, wsOverview, 'Tổng quan');

    // 2. Sheet Đóng góp
    const contributions = this.db
      .prepare(`
        SELECT
          c.created_at AS 'Thời gian',
          COALESCE(m.full_name, ext.display_name, 'Chưa xác định') AS 'Người đóng góp',
          c.amount AS 'Số tiền (VNĐ)',
          CASE
            WHEN c.contributor_type = 'MEMBER' THEN 'Thành viên lớp'
            WHEN c.contributor_type = 'EXTERNAL' THEN 'Khách / Người ngoài'
            ELSE 'Chưa xác định'
          END AS 'Phân loại',
          c.notes AS 'Ghi chú'
        FROM contributions c
        LEFT JOIN members m ON c.member_id = m.id
        LEFT JOIN external_contributors ext ON c.external_contributor_id = ext.id
        ORDER BY c.created_at DESC
      `)
      .all();
    const wsContributions = XLSX.utils.json_to_sheet(contributions);
    XLSX.utils.book_append_sheet(workbook, wsContributions, 'Đóng góp');

    // 3. Sheet Chi tiêu
    const expenses = this.db
      .prepare(`
        SELECT
          e.created_at AS 'Thời gian',
          COALESCE(e.vietnamese_title, e.title, 'Chưa rõ mục đích') AS 'Mục đích chi tiêu',
          e.amount AS 'Số tiền (VNĐ)',
          e.category AS 'Danh mục',
          COALESCE(e.recipient_name, 'Không rõ') AS 'Người nhận',
          e.notes AS 'Ghi chú'
        FROM expenses e
        ORDER BY e.created_at DESC
      `)
      .all();
    const wsExpenses = XLSX.utils.json_to_sheet(expenses);
    XLSX.utils.book_append_sheet(workbook, wsExpenses, 'Chi tiêu');

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  generatePublicCSV(type: 'contributions' | 'expenses'): string {
    if (type === 'contributions') {
      const records = this.db
        .prepare(`
          SELECT
            c.created_at AS 'thoi_gian',
            COALESCE(m.full_name, ext.display_name, 'Chua xac dinh') AS 'nguoi_dong_gop',
            c.amount AS 'so_tien',
            c.contributor_type AS 'phan_loai'
          FROM contributions c
          LEFT JOIN members m ON c.member_id = m.id
          LEFT JOIN external_contributors ext ON c.external_contributor_id = ext.id
          ORDER BY c.created_at DESC
        `)
        .all();
      return stringify(records, { header: true });
    } else {
      const records = this.db
        .prepare(`
          SELECT
            e.created_at AS 'thoi_gian',
            COALESCE(e.vietnamese_title, e.title, 'Chua ro muc dich') AS 'muc_dich',
            e.amount AS 'so_tien',
            e.category AS 'danh_muc',
            COALESCE(e.recipient_name, '') AS 'nguoi_nhan'
          FROM expenses e
          ORDER BY e.created_at DESC
        `)
        .all();
      return stringify(records, { header: true });
    }
  }

  private getFinancialTotals() {
    const incomeRow = this.db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM contributions')
      .get() as { total: number };
    const expenseRow = this.db
      .prepare('SELECT COALESCE(SUM(amount), 0) as total FROM expenses')
      .get() as { total: number };
    const countRow = this.db
      .prepare('SELECT COUNT(DISTINCT member_id) + COUNT(DISTINCT external_contributor_id) as count FROM contributions WHERE member_id IS NOT NULL OR external_contributor_id IS NOT NULL')
      .get() as { count: number };
    const settledRow = this.db
      .prepare("SELECT value FROM system_state WHERE key = 'is_settled'")
      .get() as { value: string } | undefined;

    const totalIncome = incomeRow.total;
    const totalExpense = expenseRow.total;
    return {
      totalIncome,
      totalExpense,
      balance: totalIncome - totalExpense,
      contributorCount: countRow.count,
      isSettled: settledRow?.value === 'true',
    };
  }
}
