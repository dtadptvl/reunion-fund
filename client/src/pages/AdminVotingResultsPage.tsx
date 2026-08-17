import React, { useEffect, useState } from 'react';
import { formatVND } from '../utils/format.js';

interface CandidateResult {
  member_id: string;
  full_name: string;
  disambiguator: string | null;
  vote_count: number;
  total_contributed: number;
  is_eligible_winner: boolean;
  rank: number;
}

interface CategoryResult {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
  total_votes: number;
  candidates: CandidateResult[];
  winner: {
    member_id: string;
    full_name: string;
    disambiguator: string | null;
    vote_count: number;
    total_contributed: number;
    is_manual_selection: boolean;
  } | null;
  needs_admin_tie_break: boolean;
  tied_candidates: Array<{
    member_id: string;
    full_name: string;
    disambiguator: string | null;
    vote_count: number;
    total_contributed: number;
  }>;
}

interface AdminVotingResultsPageProps {
  onGoToPresentation: () => void;
  onBackToDashboard: () => void;
}

export const AdminVotingResultsPage: React.FC<AdminVotingResultsPageProps> = ({
  onGoToPresentation,
  onBackToDashboard,
}) => {
  const [data, setData] = useState<{ isLocked: boolean; categories: CategoryResult[] }>({
    isLocked: false,
    categories: [],
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchResults = () => {
    fetch('/api/v1/admin/voting/results')
      .then((res) => {
        if (!res.ok) throw new Error('Không thể tải kết quả bình chọn');
        return res.json();
      })
      .then((resData) => {
        setData(resData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchResults();
  }, []);

  const handleToggleLock = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/admin/voting/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isLocked: !data.isLocked }),
      });
      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.error || 'Thao tác thất bại');
      }

      setData((prev) => ({ ...prev, isLocked: resData.isLocked }));
      setMessage({ text: resData.message, type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi xử lý', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelectTieWinner = async (categoryId: string, candidateMemberId: string) => {
    if (actionLoading) return;
    setActionLoading(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/v1/admin/voting/categories/${categoryId}/winner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ winnerMemberId: candidateMemberId }),
      });
      const resData = await res.json();

      if (!res.ok) {
        throw new Error(resData.error || 'Không thể chọn người đạt giải.');
      }

      setMessage({ text: 'Đã chọn người chiến thắng thành công!', type: 'success' });
      fetchResults();
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi khi chọn người đạt giải', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const getDisplayName = (full_name: string, disambiguator: string | null) =>
    `${full_name}${disambiguator ? ` (${disambiguator})` : ''}`;

  if (loading) {
    return <div className="card" style={{ textAlign: 'center', padding: '60px' }}>Đang tải kết quả bình chọn...</div>;
  }

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* HEADER CONTROLS */}
      <div className="card" style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <button
              className="btn btn-outline"
              onClick={onBackToDashboard}
              style={{ marginBottom: '10px', fontSize: '0.85rem', padding: '4px 10px' }}
            >
              ← Quay lại Quản trị
            </button>
            <h1 className="card-title" style={{ margin: 0 }}>📊 Kết Quả Bình Chọn Trao Giải</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '4px 0 0 0' }}>
              Theo dõi kết quả bình chọn, giải quyết hòa điểm và điều khiển trình chiếu gala.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              className={`btn ${data.isLocked ? 'btn-outline' : 'btn-danger'}`}
              onClick={handleToggleLock}
              disabled={actionLoading}
              style={{ fontWeight: 600 }}
            >
              {data.isLocked ? '🔓 Mở lại bình chọn' : '🔒 Khóa bình chọn'}
            </button>

            <button
              className="btn btn-primary"
              onClick={onGoToPresentation}
              style={{ background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)', color: '#000000', fontWeight: 800, border: 'none' }}
            >
              🎬 Trình Chiếu Trao Giải
            </button>
          </div>
        </div>

        {message && (
          <div
            style={{
              marginTop: '14px',
              padding: '10px 14px',
              borderRadius: '6px',
              fontSize: '0.9rem',
              fontWeight: 600,
              background: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
              color: message.type === 'success' ? '#166534' : '#991b1b',
            }}
          >
            {message.text}
          </div>
        )}
      </div>

      {/* CATEGORIES BREAKDOWN */}
      {data.categories.map((cat, index) => (
        <div key={cat.id} className="card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
            <div>
              <span className="badge badge-neutral" style={{ marginBottom: '4px' }}>
                Hạng mục {index + 1}
              </span>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '1.25rem', color: 'var(--text-main)' }}>
                {cat.title}
              </h2>
              {cat.description && (
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                  {cat.description}
                </p>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="badge badge-success" style={{ fontSize: '0.9rem', padding: '6px 12px' }}>
                Tổng phiếu: {cat.total_votes}
              </span>
            </div>
          </div>

          {/* WINNER OR TIE STATUS */}
          {cat.winner ? (
            <div
              style={{
                background: 'linear-gradient(135deg, #fefce8 0%, #fef08a 100%)',
                border: '1px solid #fde047',
                borderRadius: '8px',
                padding: '14px 18px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '10px',
              }}
            >
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', color: '#854d0e', letterSpacing: '0.5px' }}>
                  🏆 Người Đạt Giải Dự Kiến
                </span>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#713f12', marginTop: '2px' }}>
                  {getDisplayName(cat.winner.full_name, cat.winner.disambiguator)}
                </div>
                <div style={{ fontSize: '0.85rem', color: '#a16207', marginTop: '2px' }}>
                  {cat.winner.vote_count} phiếu | Đã đóng: {formatVND(cat.winner.total_contributed)}
                  {cat.winner.is_manual_selection && ' (Admin chọn hòa điểm)'}
                </div>
              </div>
            </div>
          ) : cat.needs_admin_tie_break ? (
            /* TIE BREAK ADMIN SELECTION */
            <div
              style={{
                background: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: '8px',
                padding: '14px 18px',
                marginBottom: '16px',
              }}
            >
              <div style={{ fontWeight: 700, color: '#92400e', marginBottom: '6px' }}>
                ⚖ Có trường hợp hòa điểm tuyệt đối (Cùng số phiếu & cùng số tiền đóng góp):
              </div>
              <p style={{ margin: '0 0 10px 0', fontSize: '0.88rem', color: '#78350f' }}>
                Vui lòng chọn 1 thành viên đạt giải chính thức:
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {cat.tied_candidates.map((tc) => (
                  <button
                    key={tc.member_id}
                    className="btn btn-primary"
                    disabled={actionLoading}
                    onClick={() => handleSelectTieWinner(cat.id, tc.member_id)}
                    style={{ fontSize: '0.85rem', padding: '6px 14px' }}
                  >
                    👑 Chọn {getDisplayName(tc.full_name, tc.disambiguator)} ({tc.vote_count} phiếu - {formatVND(tc.total_contributed)})
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '8px',
                padding: '12px 16px',
                marginBottom: '16px',
                color: 'var(--text-muted)',
                fontSize: '0.9rem',
              }}
            >
              Chưa có thành viên hợp lệ đạt giải (Chưa có phiếu hoặc người được bầu chưa đóng quỹ).
            </div>
          )}

          {/* CANDIDATES TABLE */}
          {cat.candidates.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', margin: '10px 0 0 0' }}>
              Chưa có phiếu bình chọn nào cho hạng mục này.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Hạng</th>
                  <th>Thành viên</th>
                  <th style={{ textAlign: 'center' }}>Số phiếu</th>
                  <th style={{ textAlign: 'right' }}>Đã đóng quỹ</th>
                  <th style={{ textAlign: 'center' }}>Đủ ĐK nhận giải</th>
                </tr>
              </thead>
              <tbody>
                {cat.candidates.map((c) => (
                  <tr key={c.member_id}>
                    <td>
                      <strong style={{ color: c.rank === 1 ? 'var(--primary)' : 'var(--text-muted)' }}>
                        #{c.rank}
                      </strong>
                    </td>
                    <td>
                      <strong>{getDisplayName(c.full_name, c.disambiguator)}</strong>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="badge badge-neutral" style={{ fontWeight: 700 }}>
                        {c.vote_count} phiếu
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {c.total_contributed > 0 ? (
                        <span style={{ color: 'var(--primary)' }}>{formatVND(c.total_contributed)}</span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)' }}>0 ₫</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {c.is_eligible_winner ? (
                        <span className="badge badge-success">✓ Đủ điều kiện</span>
                      ) : (
                        <span className="badge badge-danger">✕ Chưa đóng quỹ</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
};
