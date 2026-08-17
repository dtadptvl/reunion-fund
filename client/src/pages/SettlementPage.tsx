import React, { useEffect, useState } from 'react';
import { formatVND } from '../utils/format.js';

export const SettlementPage: React.FC = () => {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/overview')
      .then((res) => res.json())
      .then((data) => {
        setOverview(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading || !overview) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải trạng thái quyết toán...</div>;
  }

  return (
    <div style={{ maxWidth: '680px', margin: '0 auto' }}>
      <div className="card" style={{ textAlign: 'center', padding: '36px 24px' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
          {overview.isSettled ? '✅' : '⏳'}
        </div>

        <h1 className="card-title" style={{ fontSize: '1.8rem', marginBottom: '8px' }}>
          {overview.isSettled ? 'ĐÃ QUYẾT TOÁN QUỸ LỚP' : 'QUỸ ĐANG HOẠT ĐỘNG'}
        </h1>

        <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
          {overview.isSettled
            ? 'Quỹ kỷ niệm 10 năm ra trường đã hoàn tất quyết toán. Toàn bộ số dư còn lại đã được chuyển về Quỹ Chung của lớp để phục vụ công việc hiếu hỉ, thăm bệnh.'
            : 'Sự kiện kỷ niệm 10 năm ra trường đang diễn ra. Quỹ sẽ được quyết toán sau khi sự kiện kết thúc.'}
        </p>

        <div style={{ background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-lg)', padding: '20px', textAlign: 'left', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span>Tổng số tiền đóng góp:</span>
            <strong style={{ color: 'var(--primary)' }}>{formatVND(overview.totalIncome)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
            <span>Tổng chi phí sự kiện:</span>
            <strong style={{ color: 'var(--danger)' }}>{formatVND(overview.totalExpense)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 4px 0', fontSize: '1.1rem' }}>
            <span>Số dư còn lại:</span>
            <strong>{formatVND(overview.balance)}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <a href="/api/v1/public/export/xlsx" className="btn btn-outline" download>
            📥 Tải toàn bộ sổ thu chi (Excel)
          </a>
        </div>
      </div>
    </div>
  );
};
