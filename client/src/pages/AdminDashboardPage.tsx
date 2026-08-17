import React, { useEffect, useState, useRef } from 'react';
import { formatVND, formatDateVN } from '../utils/format.js';

interface AdminDashboardProps {
  user: any;
  onLogout: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  FOOD: 'Ẩm thực / Tiệc',
  GIFT_TEACHER: 'Quà tri ân thầy cô',
  FLOWERS: 'Hoa tươi',
  PHOTO_VIDEO: 'Quay phim / Chụp ảnh',
  PRINTING: 'In ấn kỷ yếu / Băng rôn',
  TRANSPORT: 'Phương tiện / Đi lại',
  REFUND: 'Hoàn tiền',
  FUND_TRANSFER: 'Chuyển quỹ lớp',
  OTHER: 'Chi phí khác',
  UNKNOWN: 'Chưa phân loại',
};

const MATCH_METHOD_LABELS: Record<string, string> = {
  EXACT_PAYMENT_CODE: 'Khớp mã thanh toán',
  DETERMINISTIC_NAME_FALLBACK: 'Khớp tên tự động',
  MANUAL_ASSIGNMENT: 'Thủ quỹ chỉ định',
  UNRESOLVED: 'Chưa xác định',
};

export const AdminDashboardPage: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [exceptions, setExceptions] = useState<any>(null);
  const [financials, setFinancials] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [suggestedAmountInput, setSuggestedAmountInput] = useState<number>(500000);
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountSaveMsg, setAmountSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // Upload state per expense
  const [uploadingExpenseId, setUploadingExpenseId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  const loadData = () => {
    Promise.all([
      fetch('/api/v1/admin/exceptions').then((r) => r.json()),
      fetch('/api/v1/admin/financials').then((r) => r.json()).catch(() => null),
      fetch('/api/v1/public/members').then((r) => r.json()),
      fetch('/api/v1/public/config').then((r) => r.json()).catch(() => ({})),
    ])
      .then(([exData, finData, memData, cfgData]) => {
        setExceptions(exData);
        setFinancials(finData);
        setMembers(memData.members || []);
        if (cfgData?.suggestedAmount) {
          setSuggestedAmountInput(cfgData.suggestedAmount);
        }
        setLoading(false);
      })
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSyncSePay = async () => {
    setSyncing(true);
    setSyncMessage('');
    try {
      const res = await fetch('/api/v1/admin/reconcile', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        setSyncMessage(`Đồng bộ thành công! Đã kiểm tra ${data.summary.totalChecked}, bổ sung ${data.summary.newlyImported} giao dịch mới.`);
        loadData();
      } else {
        setSyncMessage(`Lỗi đồng bộ: ${data.error}`);
      }
    } catch {
      setSyncMessage('Không thể kết nối máy chủ để đồng bộ');
    } finally {
      setSyncing(false);
    }
  };

  const handleAssignContribution = async (contributionId: string, memberId: string) => {
    if (!memberId) return;
    try {
      const res = await fetch(`/api/v1/admin/contributions/${contributionId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      if (res.ok) {
        loadData();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveSuggestedAmount = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAmount(true);
    setAmountSaveMsg('');
    try {
      const res = await fetch('/api/v1/admin/config/suggested-amount', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: Number(suggestedAmountInput) }),
      });
      const data = await res.json();
      if (res.ok) {
        setAmountSaveMsg(data.message || 'Đã cập nhật mức đề xuất thành công');
      } else {
        setAmountSaveMsg(`Lỗi: ${data.error}`);
      }
    } catch {
      setAmountSaveMsg('Không thể kết nối máy chủ');
    } finally {
      setSavingAmount(false);
    }
  };

  const handleUploadReceipts = async (expenseId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;

    setUploadingExpenseId(expenseId);
    setUploadMessage(null);

    let successCount = 0;
    let errorText = '';

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(`/api/v1/admin/expenses/${expenseId}/attachments`, {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();
        if (res.ok) {
          successCount++;
        } else {
          errorText = data.error || 'Lỗi khi tải lên chứng từ';
        }
      } catch {
        errorText = 'Không thể kết nối máy chủ để tải lên';
      }
    }

    if (successCount > 0 && !errorText) {
      setUploadMessage({ id: expenseId, type: 'success', text: `Đã tải lên ${successCount} chứng từ thành công!` });
    } else if (errorText) {
      setUploadMessage({ id: expenseId, type: 'error', text: `Lỗi tải lên: ${errorText}` });
    }

    // Reset file input
    if (fileInputRefs.current[expenseId]) {
      fileInputRefs.current[expenseId]!.value = '';
    }

    setUploadingExpenseId(null);
    loadData();
  };

  const handleDeleteReceipt = async (attachmentId: string, originalName: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa chứng từ "${originalName}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/v1/admin/attachments/${attachmentId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(`Lỗi khi xóa chứng từ: ${data.error}`);
      }
    } catch {
      alert('Không thể kết nối máy chủ để xóa chứng từ');
    }
  };

  if (loading || !exceptions) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải bảng điều khiển thủ quỹ...</div>;
  }

  return (
    <div>
      {/* 1. Header & Quick Actions */}
      <div className="card">
        <div className="card-header">
          <div>
            <h1 className="card-title">Bảng Điều Khiển Thủ Quỹ</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Xin chào, <strong>{user?.fullName || user?.username}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-primary" onClick={handleSyncSePay} disabled={syncing}>
              {syncing ? 'Đang đồng bộ...' : '🔄 Đồng bộ SePay ngay'}
            </button>
            <button className="btn btn-outline" onClick={onLogout}>
              Đăng xuất
            </button>
          </div>
        </div>

        {syncMessage && (
          <div style={{ padding: '12px', background: 'var(--primary-bg)', color: 'var(--primary-text)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
            {syncMessage}
          </div>
        )}

        {/* Financial Summary Metric Cards */}
        {financials && (
          <div className="stats-grid" style={{ marginBottom: '20px' }}>
            <div className="stat-box">
              <div className="stat-label">Tổng thu</div>
              <div className="stat-value income">{formatVND(financials.totalIncome || 0)}</div>
            </div>
            <div className="stat-box">
              <div className="stat-label">Tổng chi</div>
              <div className="stat-value expense">{formatVND(financials.totalExpense || 0)}</div>
            </div>
            <div className="stat-box" style={{ borderColor: 'var(--primary)', background: 'var(--primary-bg)' }}>
              <div className="stat-label" style={{ color: 'var(--primary-text)', fontWeight: 600 }}>Quỹ còn lại</div>
              <div className="stat-value primary">{formatVND(financials.balance || 0)}</div>
            </div>
          </div>
        )}

        {/* Exception Queue Metric Cards */}
        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-label">Khoản thu chưa xác định</div>
            <div className="stat-value expense">{exceptions.unresolvedIncomeCount}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Khoản chi cần bổ sung</div>
            <div className="stat-value warning">{exceptions.expensesNeedingReviewCount}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Yêu cầu sửa tên</div>
            <div className="stat-value">{exceptions.pendingCorrectionsCount || 0}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Tên cần chuẩn hóa</div>
            <div className="stat-value">{exceptions.pendingNamesCount}</div>
          </div>
        </div>
      </div>

      {/* 2. Configuration: Mức đóng góp đề xuất */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Cấu hình mức đóng góp đề xuất</h2>
        </div>
        {amountSaveMsg && (
          <div style={{ padding: '10px 14px', background: 'var(--primary-bg)', color: 'var(--primary-text)', borderRadius: 'var(--radius-md)', marginBottom: '14px' }}>
            {amountSaveMsg}
          </div>
        )}
        <form onSubmit={handleSaveSuggestedAmount} style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.9rem', fontWeight: 600, marginBottom: '6px' }}>
              Mức đóng góp đề xuất (VNĐ)
            </label>
            <input
              type="number"
              min="1000"
              step="10000"
              value={suggestedAmountInput}
              onChange={(e) => setSuggestedAmountInput(Number(e.target.value))}
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                fontSize: '1rem',
                fontWeight: 700,
                width: '220px',
              }}
            />
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={savingAmount}>
              {savingAmount ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        </form>
      </div>

      {/* 3. Section: Yêu cầu sửa tên */}
      {exceptions.pendingCorrections?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Yêu cầu sửa tên thành viên lớp</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Tên hiện tại</th>
                <th>Tên yêu cầu sửa</th>
                <th>Ghi chú</th>
                <th>Thời gian</th>
                <th style={{ textAlign: 'right' }}>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.pendingCorrections.map((item: any) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.current_name}</strong>
                  </td>
                  <td style={{ color: 'var(--primary)', fontWeight: 600 }}>
                    {item.requested_name}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {item.notes || 'Không có ghi chú'}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {formatDateVN(item.created_at)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={async () => {
                          await fetch(`/api/v1/admin/name-corrections/${item.id}/review`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'APPROVE' }),
                          });
                          loadData();
                        }}
                      >
                        ✓ Duyệt
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={async () => {
                          await fetch(`/api/v1/admin/name-corrections/${item.id}/review`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ action: 'REJECT' }),
                          });
                          loadData();
                        }}
                      >
                        ✕ Từ chối
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Section: Khoản thu chưa xác định */}
      {exceptions.unresolvedIncome?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Khoản thu chưa xác định được người đóng</h2>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Số tiền</th>
                <th>Nội dung chuyển khoản</th>
                <th>Gán vào thành viên</th>
              </tr>
            </thead>
            <tbody>
              {exceptions.unresolvedIncome.map((item: any) => (
                <tr key={item.id}>
                  <td>{formatDateVN(item.created_at)}</td>
                  <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{formatVND(item.amount)}</td>
                  <td>
                    <code>{item.content || item.description}</code>
                  </td>
                  <td>
                    <select
                      onChange={(e) => handleAssignContribution(item.id, e.target.value)}
                      defaultValue=""
                      style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}
                    >
                      <option value="">-- Chọn thành viên --</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.disambiguator ? `${m.full_name} (${m.disambiguator})` : m.full_name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 5. Section A: "Khoản thu" (Incoming Contributions) */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Khoản thu</h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Tổng cộng: <strong>{financials?.contributions?.length || 0}</strong> lượt đóng góp
          </div>
        </div>
        {financials?.contributions?.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Người đóng</th>
                <th>Số tiền</th>
                <th>Thời gian</th>
                <th>Trạng thái / Cách đối chiếu</th>
              </tr>
            </thead>
            <tbody>
              {financials.contributions.map((c: any) => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.contributor_name}</strong>
                    {c.contributor_type === 'EXTERNAL' && (
                      <span className="badge badge-outline" style={{ marginLeft: '8px', fontSize: '0.75rem' }}>Khách mời</span>
                    )}
                    {c.contributor_type === 'UNRESOLVED' && (
                      <span className="badge badge-warning" style={{ marginLeft: '8px', fontSize: '0.75rem' }}>Chưa khớp</span>
                    )}
                  </td>
                  <td style={{ fontWeight: 700, color: 'var(--income)' }}>
                    +{formatVND(c.amount)}
                  </td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                    {formatDateVN(c.created_at)}
                  </td>
                  <td>
                    <span className="badge badge-neutral" style={{ fontSize: '0.8rem' }}>
                      {MATCH_METHOD_LABELS[c.match_method] || c.match_method || 'Hoàn tất'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
            Chưa có khoản thu nào được ghi nhận.
          </div>
        )}
      </div>

      {/* 6. Section B: "Khoản chi" (Expenses & Receipts) */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Khoản chi</h2>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Tổng cộng: <strong>{financials?.expenses?.length || 0}</strong> khoản chi
          </div>
        </div>
        {financials?.expenses?.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {financials.expenses.map((e: any) => (
              <div
                key={e.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background: '#fff',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)' }}>{e.title}</h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                      <span className="badge badge-neutral">{CATEGORY_LABELS[e.category] || e.category}</span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatDateVN(e.created_at)}</span>
                      {e.recipient_name && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Người nhận: <strong>{e.recipient_name}</strong></span>
                      )}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--expense)' }}>
                      -{formatVND(e.amount)}
                    </div>
                    <div>
                      {e.needs_review ? (
                        <span className="badge badge-warning" style={{ fontSize: '0.75rem', marginTop: '4px' }}>Cần bổ sung thông tin</span>
                      ) : (
                        <span className="badge badge-success" style={{ fontSize: '0.75rem', marginTop: '4px' }}>✓ Đã phân loại</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Sub-section: Chứng từ / Hóa đơn */}
                <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px dashed var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                    <strong style={{ fontSize: '0.9rem' }}>Chứng từ / Hóa đơn:</strong>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      Chứng từ này sẽ được hiển thị công khai.
                    </span>
                  </div>

                  {/* Upload message feedback */}
                  {uploadMessage && uploadMessage.id === e.id && (
                    <div
                      style={{
                        padding: '8px 12px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.85rem',
                        marginBottom: '10px',
                        background: uploadMessage.type === 'success' ? 'rgba(46, 125, 50, 0.1)' : 'rgba(211, 47, 47, 0.1)',
                        color: uploadMessage.type === 'success' ? '#2e7d32' : '#d32f2f',
                      }}
                    >
                      {uploadMessage.text}
                    </div>
                  )}

                  {/* Existing attachments list */}
                  {e.attachments && e.attachments.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '12px' }}>
                      {e.attachments.map((att: any) => {
                        const isPdf = att.mime_type === 'application/pdf';
                        const fileUrl = `/api/v1/public/attachments/${att.id}`;
                        return (
                          <div
                            key={att.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border-color)',
                              borderRadius: 'var(--radius-sm)',
                              fontSize: '0.85rem',
                            }}
                          >
                            {isPdf ? (
                              <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--primary)' }}>
                                📄 {att.original_name}
                              </a>
                            ) : (
                              <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: 'var(--text-main)' }}>
                                <img
                                  src={fileUrl}
                                  alt={att.original_name}
                                  style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '3px' }}
                                />
                                <span>{att.original_name}</span>
                              </a>
                            )}
                            <button
                              className="btn btn-danger"
                              style={{ padding: '2px 6px', fontSize: '0.75rem', marginLeft: '4px' }}
                              title="Xóa chứng từ này"
                              onClick={() => handleDeleteReceipt(att.id, att.original_name)}
                            >
                              ✕ Xóa
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '10px' }}>
                      Chưa có chứng từ nào được tải lên cho khoản chi này.
                    </div>
                  )}

                  {/* Upload Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <input
                      type="file"
                      ref={(el) => (fileInputRefs.current[e.id] = el)}
                      accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                      multiple
                      style={{ display: 'none' }}
                      id={`file-upload-${e.id}`}
                      onChange={(ev) => handleUploadReceipts(e.id, ev.target.files)}
                      disabled={uploadingExpenseId === e.id}
                    />
                    <label
                      htmlFor={`file-upload-${e.id}`}
                      className="btn btn-outline"
                      style={{
                        cursor: uploadingExpenseId === e.id ? 'not-allowed' : 'pointer',
                        fontSize: '0.85rem',
                        padding: '6px 12px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {uploadingExpenseId === e.id ? '⏳ Đang tải lên...' : '📤 Tải lên chứng từ / hóa đơn (JPG, PNG, WebP, PDF)'}
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
            Chưa có khoản chi nào được ghi nhận.
          </div>
        )}
      </div>
    </div>
  );
};
