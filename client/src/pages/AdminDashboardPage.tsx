import React, { useEffect, useState, useRef } from 'react';
import { formatVND, formatDateVN } from '../utils/format.js';

interface AdminDashboardProps {
  user: any;
  onLogout: () => void;
  onGoToVotingResults?: () => void;
  onGoToPresentation?: () => void;
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
  MANUAL_TREASURER_ASSIGNMENT: 'Admin chỉ định',
  MANUAL_ASSIGNMENT: 'Admin chỉ định',
  UNRESOLVED: 'Chưa xác định',
};

export const AdminDashboardPage: React.FC<AdminDashboardProps> = ({
  user,
  onLogout,
  onGoToVotingResults,
  onGoToPresentation,
}) => {
  const [exceptions, setExceptions] = useState<any>(null);
  const [financials, setFinancials] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [suggestedAmountInput, setSuggestedAmountInput] = useState<number>(500000);
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountSaveMsg, setAmountSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  // RSVP Management State
  const [rsvpData, setRsvpData] = useState<any | null>(null);
  const [lockingRsvp, setLockingRsvp] = useState(false);
  const [rsvpLockMsg, setRsvpLockMsg] = useState('');

  // Upload state per expense
  const [uploadingExpenseId, setUploadingExpenseId] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<{ id: string; type: 'success' | 'error'; text: string } | null>(null);
  const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

  // Expense Edit/Review Modal State
  const [editingExpense, setEditingExpense] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    vietnameseTitle: '',
    category: 'FOOD',
    recipientName: '',
    notes: '',
  });
  const [savingExpense, setSavingExpense] = useState(false);
  const [editExpenseError, setEditExpenseError] = useState('');

  const loadData = () => {
    Promise.all([
      fetch('/api/v1/admin/exceptions').then((r) => r.json()),
      fetch('/api/v1/admin/financials').then((r) => r.json()).catch(() => null),
      fetch('/api/v1/public/members').then((r) => r.json()),
      fetch('/api/v1/public/config').then((r) => r.json()).catch(() => ({})),
      fetch('/api/v1/admin/rsvps').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([exData, finData, memData, cfgData, rsvps]) => {
        setExceptions(exData);
        setFinancials(finData);
        setMembers(memData.members || []);
        if (cfgData?.suggestedAmount) {
          setSuggestedAmountInput(cfgData.suggestedAmount);
        }
        if (rsvps) {
          setRsvpData(rsvps);
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

  const handleUnassignContribution = async (contributionId: string) => {
    if (!window.confirm('Bạn có chắc muốn hoàn tác việc gán khoản thu này?')) {
      return;
    }
    try {
      const res = await fetch(`/api/v1/admin/contributions/${contributionId}/unassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        loadData();
      } else {
        const data = await res.json();
        alert(`Lỗi: ${data.error}`);
      }
    } catch {
      alert('Không thể kết nối máy chủ để hoàn tác gán');
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

  const handleOpenEditExpense = (expense: any) => {
    setEditingExpense(expense);
    setEditForm({
      vietnameseTitle: expense.title || '',
      category: expense.category === 'UNKNOWN' ? 'FOOD' : expense.category,
      recipientName: expense.recipient_name || '',
      notes: expense.notes || '',
    });
    setEditExpenseError('');
  };

  const handleSaveExpenseReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExpense) return;

    setSavingExpense(true);
    setEditExpenseError('');

    try {
      const res = await fetch(`/api/v1/admin/expenses/${editingExpense.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vietnameseTitle: editForm.vietnameseTitle,
          category: editForm.category,
          recipientName: editForm.recipientName || undefined,
          notes: editForm.notes || undefined,
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setEditingExpense(null);
        loadData();
      } else {
        setEditExpenseError(data.error || 'Lỗi khi cập nhật thông tin khoản chi');
      }
    } catch {
      setEditExpenseError('Không thể kết nối máy chủ để lưu thông tin');
    } finally {
      setSavingExpense(false);
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

  const handleToggleRsvpLock = async (newLockState: boolean) => {
    setLockingRsvp(true);
    setRsvpLockMsg('');
    try {
      const res = await fetch('/api/v1/admin/rsvps/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: newLockState }),
      });
      const data = await res.json();
      if (res.ok) {
        setRsvpLockMsg(data.message);
        loadData();
      } else {
        setRsvpLockMsg(`Lỗi: ${data.error}`);
      }
    } catch {
      setRsvpLockMsg('Lỗi kết nối máy chủ');
    } finally {
      setLockingRsvp(false);
    }
  };

  if (loading || !exceptions) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải bảng điều khiển Quản trị...</div>;
  }

  return (
    <div>
      {/* 1. Header & Quick Actions */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="card-title">Bảng Điều Khiển Quản Trị</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Xin chào, <strong>{user?.fullName || user?.username}</strong>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            {onGoToVotingResults && (
              <button className="btn btn-outline" onClick={onGoToVotingResults} style={{ borderColor: '#eab308', color: '#854d0e', fontWeight: 700 }}>
                📊 Kết quả bình chọn
              </button>
            )}
            {onGoToPresentation && (
              <button className="btn btn-primary" onClick={onGoToPresentation} style={{ background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)', color: '#000000', fontWeight: 800, border: 'none' }}>
                🎬 Trình chiếu trao giải
              </button>
            )}
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
                maxWidth: '100%',
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

      {/* 2.5. Section: Quản lý Đăng ký Hoạt động Họp Lớp */}
      {rsvpData && (
        <div className="card">
          <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <h2 className="card-title">Quản lý Đăng ký Hoạt động Họp Lớp</h2>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                Kiểm soát đăng ký tham gia các hoạt động kỷ niệm 10 năm ra trường
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span
                style={{
                  padding: '4px 10px',
                  borderRadius: '12px',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  background: rsvpData.isLocked ? '#fef2f2' : '#f0fdf4',
                  color: rsvpData.isLocked ? '#dc2626' : '#16a34a',
                  border: `1px solid ${rsvpData.isLocked ? '#fecaca' : '#bbf7d0'}`,
                }}
              >
                {rsvpData.isLocked ? '🔒 ĐÃ KHÓA ĐĂNG KÝ' : '🔓 ĐANG MỞ ĐĂNG KÝ'}
              </span>

              <button
                className={rsvpData.isLocked ? 'btn btn-primary' : 'btn btn-outline'}
                onClick={() => handleToggleRsvpLock(!rsvpData.isLocked)}
                disabled={lockingRsvp}
                style={{ fontSize: '0.85rem', padding: '6px 14px' }}
              >
                {lockingRsvp
                  ? 'Đang xử lý...'
                  : rsvpData.isLocked
                  ? '🔓 Mở lại đăng ký'
                  : '🔒 Khóa đăng ký hoạt động'}
              </button>
            </div>
          </div>

          {rsvpLockMsg && (
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--primary-bg)',
                color: 'var(--primary-text)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              {rsvpLockMsg}
            </div>
          )}

          <div style={{ marginBottom: '16px', padding: '12px 16px', background: 'var(--bg-card-subtle, #f8fafc)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
            <div style={{ fontSize: '0.95rem', fontWeight: 600 }}>
              Tổng số thành viên lớp đã đăng ký ít nhất một hoạt động:{' '}
              <strong style={{ color: 'var(--primary)', fontSize: '1.1rem' }}>
                {rsvpData.totalDistinctMembers} / 40 bạn
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {rsvpData.activitySummaries?.map((act: any) => (
              <div
                key={act.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px 16px',
                  background: 'var(--bg-card)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)' }}>
                      {act.title}
                    </h3>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                      {act.memberCount} thành viên lớp đăng ký
                    </div>
                  </div>
                  <div
                    style={{
                      background: 'var(--primary-light, #eff6ff)',
                      color: 'var(--primary, #1e40af)',
                      padding: '4px 12px',
                      borderRadius: '16px',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                    }}
                  >
                    Tổng số người tham gia: {act.totalPeopleCount} người
                  </div>
                </div>

                {act.participants?.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '6px' }}>
                    {act.participants.map((p: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          padding: '6px 10px',
                          background: 'var(--bg-card-subtle, #f8fafc)',
                          borderRadius: 'var(--radius-sm)',
                          fontSize: '0.85rem',
                          border: '1px solid var(--border-color)',
                        }}
                      >
                        <span>{p.fullName} {p.disambiguator ? `(${p.disambiguator})` : ''}</span>
                        <strong style={{ color: 'var(--primary)' }}>{p.participantCount} người</strong>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    Chưa có thành viên nào đăng ký hoạt động này.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Section: Yêu cầu sửa tên */}
      {exceptions.pendingCorrections?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Yêu cầu sửa tên thành viên lớp</h2>
          </div>

          {/* Desktop Table View */}
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
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

          {/* Mobile Stacked Card View */}
          <div className="mobile-only income-cards-mobile">
            {exceptions.pendingCorrections.map((item: any) => (
              <div key={item.id} className="income-card-item">
                <div className="income-card-row">
                  <span className="income-card-label">Tên hiện tại:</span>
                  <strong style={{ textAlign: 'right' }}>{item.current_name}</strong>
                </div>

                <div className="income-card-row">
                  <span className="income-card-label">Yêu cầu sửa:</span>
                  <strong style={{ color: 'var(--primary)', textAlign: 'right' }}>{item.requested_name}</strong>
                </div>

                {item.notes && (
                  <div className="income-card-row">
                    <span className="income-card-label">Ghi chú:</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{item.notes}</span>
                  </div>
                )}

                <div className="income-card-row">
                  <span className="income-card-label">Thời gian:</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {formatDateVN(item.created_at)}
                  </span>
                </div>

                <div className="income-card-row" style={{ marginTop: '6px', paddingTop: '8px', borderTop: '1px dashed var(--border-color)', justifyContent: 'flex-end', gap: '8px' }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '6px 14px', fontSize: '0.85rem', flex: '1' }}
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
                    style={{ padding: '6px 14px', fontSize: '0.85rem', flex: '1' }}
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Section: Khoản thu chưa xác định */}
      {exceptions.unresolvedIncome?.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Khoản thu chưa xác định được người đóng</h2>
          </div>
          
          {/* Desktop Table View */}
          <div className="desktop-only" style={{ overflowX: 'auto' }}>
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
                        style={{ padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)', maxWidth: '100%' }}
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

          {/* Mobile Stacked Card View */}
          <div className="mobile-only income-cards-mobile">
            {exceptions.unresolvedIncome.map((item: any) => (
              <div key={item.id} className="income-card-item">
                <div className="income-card-row">
                  <span className="income-card-label">Thời gian:</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {formatDateVN(item.created_at)}
                  </span>
                </div>

                <div className="income-card-row">
                  <span className="income-card-label">Số tiền:</span>
                  <strong style={{ color: 'var(--income)', fontSize: '1rem' }}>
                    +{formatVND(item.amount)}
                  </strong>
                </div>

                <div className="income-card-row">
                  <span className="income-card-label">Nội dung CK:</span>
                  <code style={{ fontSize: '0.85rem', background: 'var(--bg-card-subtle)', padding: '2px 6px', borderRadius: '4px' }}>
                    {item.content || item.description}
                  </code>
                </div>

                <div className="income-card-row">
                  <span className="income-card-label">Trạng thái:</span>
                  <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>
                    Chưa xác định
                  </span>
                </div>

                <div className="income-card-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px', marginTop: '4px' }}>
                  <span className="income-card-label">Gán vào thành viên:</span>
                  <select
                    onChange={(e) => handleAssignContribution(item.id, e.target.value)}
                    defaultValue=""
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.9rem',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="">-- Chọn thành viên --</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.disambiguator ? `${m.full_name} (${m.disambiguator})` : m.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
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
          <>
            {/* Desktop Table View */}
            <div className="desktop-only" style={{ overflowX: 'auto' }}>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span className="badge badge-neutral" style={{ fontSize: '0.8rem' }}>
                            {MATCH_METHOD_LABELS[c.match_method] || c.match_method || 'Hoàn tất'}
                          </span>
                          {(c.match_method === 'MANUAL_TREASURER_ASSIGNMENT' || c.match_method === 'MANUAL_ASSIGNMENT') && (
                            <button
                              className="btn btn-outline"
                              style={{ fontSize: '0.75rem', padding: '2px 8px', color: 'var(--danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}
                              onClick={() => handleUnassignContribution(c.id)}
                              title="Hoàn tác gán khoản thu này về trạng thái chưa xác định"
                            >
                              ↩️ Hoàn tác gán
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Card View */}
            <div className="mobile-only income-cards-mobile">
              {financials.contributions.map((c: any) => (
                <div key={c.id} className="income-card-item">
                  <div className="income-card-row">
                    <span className="income-card-label">Người đóng:</span>
                    <strong style={{ textAlign: 'right' }}>
                      {c.contributor_name}
                      {c.contributor_type === 'EXTERNAL' && (
                        <span className="badge badge-outline" style={{ marginLeft: '6px', fontSize: '0.7rem' }}>Khách mời</span>
                      )}
                      {c.contributor_type === 'UNRESOLVED' && (
                        <span className="badge badge-warning" style={{ marginLeft: '6px', fontSize: '0.7rem' }}>Chưa khớp</span>
                      )}
                    </strong>
                  </div>

                  <div className="income-card-row">
                    <span className="income-card-label">Số tiền:</span>
                    <strong style={{ color: 'var(--income)', fontSize: '1rem' }}>
                      +{formatVND(c.amount)}
                    </strong>
                  </div>

                  <div className="income-card-row">
                    <span className="income-card-label">Thời gian:</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      {formatDateVN(c.created_at)}
                    </span>
                  </div>

                  <div className="income-card-row" style={{ alignItems: 'flex-start' }}>
                    <span className="income-card-label">Trạng thái / đối chiếu:</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '100%' }}>
                      <span className="badge badge-neutral" style={{ fontSize: '0.75rem' }}>
                        {MATCH_METHOD_LABELS[c.match_method] || c.match_method || 'Hoàn tất'}
                      </span>
                      {(c.match_method === 'MANUAL_TREASURER_ASSIGNMENT' || c.match_method === 'MANUAL_ASSIGNMENT') && (
                        <button
                          className="btn btn-outline"
                          style={{
                            fontSize: '0.75rem',
                            padding: '3px 8px',
                            color: 'var(--danger)',
                            borderColor: 'rgba(239, 68, 68, 0.4)',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%',
                            boxSizing: 'border-box',
                          }}
                          onClick={() => handleUnassignContribution(c.id)}
                        >
                          Hoàn tác gán
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
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
            {financials.expenses.map((e: any) => {
              const isNeedsReview = e.needs_review || e.category === 'UNKNOWN';
              return (
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
                    <div style={{ maxWidth: '100%' }}>
                      <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-main)', wordBreak: 'break-word' }}>{e.title}</h3>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px', flexWrap: 'wrap' }}>
                        <span className="badge badge-neutral">{CATEGORY_LABELS[e.category] || e.category}</span>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatDateVN(e.created_at)}</span>
                        {e.recipient_name && (
                          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Người nhận: <strong>{e.recipient_name}</strong></span>
                        )}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: '120px' }}>
                      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--expense)' }}>
                        -{formatVND(e.amount)}
                      </div>
                      <div style={{ marginTop: '6px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                        {isNeedsReview ? (
                          <>
                            <span className="badge badge-warning" style={{ fontSize: '0.75rem' }}>Cần bổ sung thông tin</span>
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: '0.8rem', padding: '4px 10px' }}
                              onClick={() => handleOpenEditExpense(e)}
                            >
                              ✏️ Bổ sung thông tin
                            </button>
                          </>
                        ) : (
                          <span className="badge badge-success" style={{ fontSize: '0.75rem' }}>✓ Đã phân loại</span>
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
                            <div key={att.id} className="receipt-item-box">
                              {isPdf ? (
                                <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'var(--primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                  <span>📄</span>
                                  <span className="receipt-filename" title={att.original_name}>{att.original_name}</span>
                                </a>
                              ) : (
                                <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: 'var(--text-main)' }}>
                                  <img
                                    src={fileUrl}
                                    alt={att.original_name}
                                    style={{ width: '28px', height: '28px', objectFit: 'cover', borderRadius: '3px', flexShrink: 0 }}
                                  />
                                  <span className="receipt-filename" title={att.original_name}>{att.original_name}</span>
                                </a>
                              )}
                              <button
                                className="btn btn-danger"
                                style={{ padding: '2px 6px', fontSize: '0.75rem', marginLeft: '4px', flexShrink: 0 }}
                                title="Xóa chứng từ này"
                                onClick={() => handleDeleteReceipt(att.id, att.original_name)}
                              >
                                ✕
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
                          maxWidth: '100%',
                          boxSizing: 'border-box',
                        }}
                      >
                        {uploadingExpenseId === e.id ? '⏳ Đang tải lên...' : '📤 Tải lên chứng từ / hóa đơn (JPG, PNG, WebP, PDF)'}
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
            Chưa có khoản chi nào được ghi nhận.
          </div>
        )}
      </div>

      {/* 7. Modal: Bổ sung thông tin khoản chi */}
      {editingExpense && (
        <div
          onClick={() => setEditingExpense(null)}
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
            padding: '16px',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              padding: '24px',
              borderRadius: 'var(--radius-lg)',
              maxWidth: '540px',
              width: '100%',
              boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
              maxHeight: '90vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Bổ sung thông tin khoản chi</h3>
              <button
                className="btn btn-outline"
                style={{ padding: '2px 8px', fontSize: '0.85rem' }}
                onClick={() => setEditingExpense(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ padding: '10px 14px', background: 'var(--bg-card-subtle)', borderRadius: 'var(--radius-sm)', marginBottom: '16px', fontSize: '0.85rem' }}>
              <div>Số tiền: <strong style={{ color: 'var(--expense)' }}>-{formatVND(editingExpense.amount)}</strong></div>
              <div>Thời gian: <strong>{formatDateVN(editingExpense.created_at)}</strong></div>
            </div>

            {editExpenseError && (
              <div style={{ padding: '8px 12px', background: 'var(--danger-bg)', color: 'var(--danger-text)', borderRadius: 'var(--radius-sm)', marginBottom: '14px', fontSize: '0.85rem' }}>
                {editExpenseError}
              </div>
            )}

            <form onSubmit={handleSaveExpenseReview}>
              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Nội dung khoản chi <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editForm.vietnameseTitle}
                  onChange={(e) => setEditForm({ ...editForm, vietnameseTitle: e.target.value })}
                  placeholder="Ví dụ: Đặt cọc nhà hàng, Nước uống họp lớp..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Danh mục chi tiêu <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <select
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="FOOD">Ẩm thực / Tiệc</option>
                  <option value="GIFT_TEACHER">Quà tri ân thầy cô</option>
                  <option value="FLOWERS">Hoa tươi</option>
                  <option value="PHOTO_VIDEO">Quay phim / Chụp ảnh</option>
                  <option value="PRINTING">In ấn kỷ yếu / Băng rôn</option>
                  <option value="TRANSPORT">Phương tiện / Đi lại</option>
                  <option value="REFUND">Hoàn tiền</option>
                  <option value="FUND_TRANSFER">Chuyển quỹ lớp</option>
                  <option value="OTHER">Chi phí khác</option>
                </select>
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Người / Đơn vị nhận tiền (tùy chọn)
                </label>
                <input
                  type="text"
                  value={editForm.recipientName}
                  onChange={(e) => setEditForm({ ...editForm, recipientName: e.target.value })}
                  placeholder="Tên nhà hàng, quán nước, người nhận..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                  Ghi chú bổ sung (tùy chọn)
                </label>
                <textarea
                  rows={3}
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                  placeholder="Ghi chú chi tiết cho Ban Quản trị và tập thể lớp..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-color)',
                    fontSize: '0.95rem',
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setEditingExpense(null)}
                  disabled={savingExpense}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingExpense}
                >
                  {savingExpense ? 'Đang lưu...' : 'Lưu thông tin'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
