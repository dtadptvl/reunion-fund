import React, { useEffect, useState } from 'react';
import { formatVND, formatDateVN } from '../utils/format.js';

interface AdminDashboardProps {
  user: any;
  onLogout: () => void;
}

export const AdminDashboardPage: React.FC<AdminDashboardProps> = ({ user, onLogout }) => {
  const [exceptions, setExceptions] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [suggestedAmountInput, setSuggestedAmountInput] = useState<number>(500000);
  const [savingAmount, setSavingAmount] = useState(false);
  const [amountSaveMsg, setAmountSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');

  const loadData = () => {
    Promise.all([
      fetch('/api/v1/admin/exceptions').then((r) => r.json()),
      fetch('/api/v1/public/members').then((r) => r.json()),
      fetch('/api/v1/public/config').then((r) => r.json()).catch(() => ({})),
    ])
      .then(([exData, memData, cfgData]) => {
        setExceptions(exData);
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
    } catch (err) {
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
    } catch (err) {
      setAmountSaveMsg('Không thể kết nối máy chủ');
    } finally {
      setSavingAmount(false);
    }
  };

  if (loading || !exceptions) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải bảng điều khiển thủ quỹ...</div>;
  }

  return (
    <div>
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

        {/* Exception Metric Cards */}
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

      {/* Configuration: Mức đóng góp đề xuất */}
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
              min="10000"
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

      {/* Section 0: Name Correction Requests */}
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

      {/* Section 1: Unresolved Incoming Transactions */}
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
                          {m.full_name}
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
    </div>
  );
};
