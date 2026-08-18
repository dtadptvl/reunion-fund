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
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="card-title">Danh Sách Khoản Chi Minh Bạch</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Mọi khoản tiền chi ra từ tài khoản quỹ đều được tự động ghi nhận từ biến động số dư ngân hàng kèm chứng từ hóa đơn.
            </div>
          </div>
          <div>
            <a href="/api/v1/public/export/xlsx" className="btn btn-outline btn-sm" download>
              📥 Xuất Excel (XLSX)
            </a>
          </div>
        </div>

        {expenses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Chưa có khoản chi tiêu nào phát sinh.
          </div>
        ) : (
          <>
            {/* DESKTOP TABLE VIEW (>= 768px) */}
            <div className="responsive-table-desktop">
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
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                            {item.notes}
                          </div>
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
                                  onClick={() =>
                                    setPreviewImage({ url: fileUrl, title: `${item.title} — ${att.original_name}` })
                                  }
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
            </div>

            {/* MOBILE STACKED CARDS VIEW (< 768px) */}
            <div className="responsive-cards-mobile">
              {expenses.map((item) => (
                <div key={item.id} className="expense-mobile-card">
                  <div className="expense-card-header">
                    <span className="badge badge-neutral badge-sm">
                      {getCategoryLabelVN(item.category)}
                    </span>
                    <span className="expense-card-amount">
                      -{formatVND(item.amount)}
                    </span>
                  </div>

                  <div className="expense-card-title">{item.title}</div>
                  {item.notes && <div className="expense-card-notes">{item.notes}</div>}

                  <div className="expense-card-info-row">
                    <span className="info-label">Người nhận:</span>
                    <span className="info-val">{item.recipient_name || '—'}</span>
                  </div>

                  <div className="expense-card-info-row">
                    <span className="info-label">Thời gian:</span>
                    <span className="info-val text-muted">{formatDateVN(item.created_at)}</span>
                  </div>

                  <div className="expense-card-attachments">
                    <div className="info-label" style={{ marginBottom: '6px' }}>Chứng từ đính kèm:</div>
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
                                className="btn btn-outline btn-sm"
                                style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                              >
                                📄 Xem PDF
                              </a>
                            );
                          }
                          return (
                            <img
                              key={att.id}
                              src={fileUrl}
                              alt={att.original_name}
                              onClick={() =>
                                setPreviewImage({ url: fileUrl, title: `${item.title} — ${att.original_name}` })
                              }
                              style={{
                                width: '56px',
                                height: '56px',
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
                      <span className="text-muted" style={{ fontSize: '0.85rem' }}>Chưa có chứng từ</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Modal image preview */}
      {previewImage && (
        <div
          onClick={() => setPreviewImage(null)}
          className="modal-backdrop"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <img
              src={previewImage.url}
              alt={previewImage.title}
              style={{
                maxWidth: '100%',
                maxHeight: '80vh',
                objectFit: 'contain',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
              }}
            />
            <div
              style={{
                color: '#fff',
                marginTop: '10px',
                fontSize: '0.9rem',
                textAlign: 'center',
              }}
            >
              {previewImage.title}
            </div>
            <button
              onClick={() => setPreviewImage(null)}
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '12px' }}
            >
              ✕ Đóng ảnh
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
