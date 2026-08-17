import React, { useEffect, useState } from 'react';
import { formatVND, formatDateVN, getCategoryLabelVN } from '../utils/format.js';

export const ExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/expenses')
      .then((res) => res.json())
      .then((data) => {
        setExpenses(data.expenses || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải danh sách chi tiêu...</div>;
  }

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <h1 className="card-title">Danh Sách Khoản Chi Minh Bạch</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Mọi khoản tiền chi ra từ tài khoản quỹ đều được tự động ghi nhận từ biến động số dư ngân hàng.
            </div>
          </div>
          <div>
            <a href="/api/v1/public/export/xlsx" className="btn btn-outline" download>
              📥 Xuất Excel (XLSX)
            </a>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Chưa có khoản chi tiêu nào phát sinh.
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Mục đích chi tiêu</th>
                <th>Danh mục</th>
                <th>Người / Đơn vị nhận</th>
                <th>Thời gian</th>
                <th style={{ textAlign: 'right' }}>Số tiền</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong style={{ color: 'var(--text-main)' }}>{item.title}</strong>
                    {item.notes && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{item.notes}</div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{getCategoryLabelVN(item.category)}</span>
                  </td>
                  <td>{item.recipient_name || 'Không có dữ liệu từ ngân hàng'}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {formatDateVN(item.created_at)}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                    -{formatVND(item.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
