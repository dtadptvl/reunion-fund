import React, { useEffect, useState } from 'react';
import { formatVND, formatDateVN, getCategoryLabelVN } from '../utils/format.js';

export const ExpensesPage: React.FC = () => {
  const [expenses, setExpenses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);

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
              Mọi khoản tiền chi ra từ tài khoản quỹ đều được tự động ghi nhận từ biến động số dư ngân hàng kèm chứng từ hóa đơn.
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
                <th>Chứng từ</th>
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
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>{item.notes}</div>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-neutral">{getCategoryLabelVN(item.category)}</span>
                  </td>
                  <td>{item.recipient_name || '—'}</td>
                  <td>
                    {item.attachments && item.attachments.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        {item.attachments.map((att: any) => {
                          const isPdf = att.mime_type === 'application/pdf';
                          const fileUrl = `/api/v1/public/attachments/${att.id}`;
                          if (isPdf) {
                            return (
                              <a
                                key={att.id}
                                href={fileUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-outline"
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '4px 8px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                                title={att.original_name}
                              >
                                📄 Xem chứng từ PDF
                              </a>
                            );
                          }
                          return (
                            <img
                              key={att.id}
                              src={fileUrl}
                              alt={att.original_name}
                              title={`Bấm để xem ảnh lớn: ${att.original_name}`}
                              onClick={() => setPreviewImage({ url: fileUrl, title: `${item.title} — ${att.original_name}` })}
                              style={{
                                width: '48px',
                                height: '48px',
                                objectFit: 'cover',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border-color)',
                                cursor: 'pointer',
                              }}
                            />
                          );
                        })}
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Chưa có chứng từ</span>
                    )}
                  </td>
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

      {/* Modal image preview for public members */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '0.95rem' }}>{previewImage.title}</strong>
              <button
                className="btn btn-outline"
                style={{ padding: '2px 8px', fontSize: '0.85rem' }}
                onClick={() => setPreviewImage(null)}
              >
                ✕ Đóng
              </button>
            </div>
            <img
              src={previewImage.url}
              alt={previewImage.title}
              style={{
                maxWidth: '100%',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: 'var(--radius-sm)',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
