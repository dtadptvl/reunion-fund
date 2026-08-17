import React, { useEffect, useState } from 'react';

interface LuckyWheelSegment {
  memberId: string;
  fullName: string;
  disambiguator: string | null;
  weight: number;
  probability: number;
  probabilityDisplay: string;
}

interface CompletedPrize {
  prizeId: string;
  prizeTitle: string;
  prizeOrder: number;
  durationSeconds: number;
  winnerMemberId: string;
  winnerName: string;
  winnerDisambiguator: string | null;
  winnerWeight: number;
  completedAt: string;
}

interface LuckyWheelState {
  serverTime: string;
  status: 'IDLE' | 'SPINNING' | 'FINISHED';
  currentPrize: {
    prizeId: string;
    prizeTitle: string;
    prizeOrder: number;
    durationSeconds: number;
  } | null;
  nextPrize: {
    prizeId: string;
    prizeTitle: string;
    prizeOrder: number;
    durationSeconds: number;
  } | null;
  activeDraw: {
    prizeId: string;
    prizeTitle: string;
    durationSeconds: number;
    startedAt: string;
    completedAt: string;
    isSpinning: boolean;
    isRevealed: boolean;
    winner: {
      memberId: string;
      fullName: string;
      disambiguator: string | null;
      weight: number;
    } | null;
  } | null;
  wheelSegments: LuckyWheelSegment[];
  totalEligibleWeight: number;
  completedPrizes: CompletedPrize[];
}

interface AdminLuckyWheelPageProps {
  onBackToDashboard: () => void;
  onOpenPublicWheel: () => void;
}

export const AdminLuckyWheelPage: React.FC<AdminLuckyWheelPageProps> = ({
  onBackToDashboard,
  onOpenPublicWheel,
}) => {
  const [wheelState, setWheelState] = useState<LuckyWheelState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [triggering, setTriggering] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const fetchWheelState = async () => {
    try {
      const res = await fetch('/api/v1/public/lottery/wheel-state');
      if (res.ok) {
        const data = await res.json();
        setWheelState(data);
        setLoading(false);
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchWheelState();
    const interval = setInterval(fetchWheelState, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleTriggerDraw = async (prizeId: string, prizeTitle: string) => {
    if (triggering) return;
    setTriggering(true);
    setMessage(null);

    try {
      const res = await fetch('/api/v1/admin/lottery/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeId }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Không thể thực hiện quay số.');
      }

      setMessage({
        text: `Đã kích hoạt quay ${prizeTitle} thành công! Người chiến thắng đã được xác định và lưu trữ an toàn.`,
        type: 'success',
      });
      await fetchWheelState();
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi khi kích hoạt quay thưởng.', type: 'error' });
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
        <p>Đang tải dữ liệu vòng quay may mắn...</p>
      </div>
    );
  }

  const completedPrizeIds = new Set(wheelState?.completedPrizes.map((p) => p.prizeId) || []);
  const nextPrize = wheelState?.nextPrize;

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* HEADER BAR */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <button className="btn btn-outline" onClick={onBackToDashboard} style={{ marginBottom: '8px' }}>
            ← Quay lại Bảng Quản Trị
          </button>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: 'var(--text-main)' }}>
            ⚙ Quản Trị Quay Số May Mắn
          </h1>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-primary" onClick={onOpenPublicWheel}>
            🎬 Mở Màn Hình Trình Chiếu Vòng Quay
          </button>
        </div>
      </div>

      {/* FEEDBACK MESSAGE */}
      {message && (
        <div
          style={{
            padding: '14px 18px',
            borderRadius: '8px',
            fontSize: '0.95rem',
            fontWeight: 600,
            background: message.type === 'success' ? '#f0fdf4' : '#fef2f2',
            color: message.type === 'success' ? '#166534' : '#991b1b',
            border: `1px solid ${message.type === 'success' ? '#bbf7d0' : '#fecaca'}`,
          }}
        >
          {message.type === 'success' ? '✓ ' : '⚠ '}
          {message.text}
        </div>
      )}

      {/* DRAW CONTROL PANEL */}
      <div className="card" style={{ padding: '24px' }}>
        <h2 style={{ fontSize: '1.2rem', margin: '0 0 8px 0', color: 'var(--text-main)' }}>
          🎯 Điều Khiển Quay Thưởng Theo Thứ Tự
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>
          Hệ thống đảm bảo tính công bằng tuyệt đối: người trúng thưởng ở giải trước sẽ tự động bị loại khỏi các giải sau, và tỷ lệ của các thành viên còn lại được chuẩn hóa lại 100%.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {/* GIẢI BA */}
          <div
            style={{
              border: completedPrizeIds.has('giai-ba') ? '1px solid #10b981' : nextPrize?.prizeId === 'giai-ba' ? '2px solid #2563eb' : '1px solid var(--border-color)',
              background: completedPrizeIds.has('giai-ba') ? '#f0fdf4' : nextPrize?.prizeId === 'giai-ba' ? '#eff6ff' : '#f8fafc',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>1. Giải Ba</strong>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>15 giây</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Hạng mục quay đầu tiên trong đêm gala.
              </p>
            </div>

            {completedPrizeIds.has('giai-ba') ? (
              <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700 }}>
                ✓ Đã quay xong (Người trúng: {wheelState?.completedPrizes.find((p) => p.prizeId === 'giai-ba')?.winnerName})
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => handleTriggerDraw('giai-ba', 'Giải Ba')}
                disabled={triggering || nextPrize?.prizeId !== 'giai-ba'}
                style={{ width: '100%', padding: '10px' }}
              >
                {triggering && nextPrize?.prizeId === 'giai-ba' ? 'Đang kích hoạt...' : '🎯 Kích Hoạt Quay Giải Ba'}
              </button>
            )}
          </div>

          {/* GIẢI NHÌ */}
          <div
            style={{
              border: completedPrizeIds.has('giai-nhi') ? '1px solid #10b981' : nextPrize?.prizeId === 'giai-nhi' ? '2px solid #2563eb' : '1px solid var(--border-color)',
              background: completedPrizeIds.has('giai-nhi') ? '#f0fdf4' : nextPrize?.prizeId === 'giai-nhi' ? '#eff6ff' : '#f8fafc',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>2. Giải Nhì</strong>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>25 giây</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Yêu cầu hoàn thành Giải Ba trước.
              </p>
            </div>

            {completedPrizeIds.has('giai-nhi') ? (
              <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700 }}>
                ✓ Đã quay xong (Người trúng: {wheelState?.completedPrizes.find((p) => p.prizeId === 'giai-nhi')?.winnerName})
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => handleTriggerDraw('giai-nhi', 'Giải Nhì')}
                disabled={triggering || nextPrize?.prizeId !== 'giai-nhi'}
                style={{ width: '100%', padding: '10px' }}
              >
                {triggering && nextPrize?.prizeId === 'giai-nhi' ? 'Đang kích hoạt...' : '🎯 Kích Hoạt Quay Giải Nhì'}
              </button>
            )}
          </div>

          {/* GIẢI NHẤT */}
          <div
            style={{
              border: completedPrizeIds.has('giai-nhat') ? '1px solid #10b981' : nextPrize?.prizeId === 'giai-nhat' ? '2px solid #2563eb' : '1px solid var(--border-color)',
              background: completedPrizeIds.has('giai-nhat') ? '#f0fdf4' : nextPrize?.prizeId === 'giai-nhat' ? '#eff6ff' : '#f8fafc',
              borderRadius: '12px',
              padding: '18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: '12px',
            }}
          >
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <strong style={{ fontSize: '1.1rem', color: 'var(--text-main)' }}>3. Giải Nhất</strong>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>35 giây</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                Hạng mục danh giá nhất, yêu cầu hoàn tất Giải Nhì.
              </p>
            </div>

            {completedPrizeIds.has('giai-nhat') ? (
              <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: '8px', fontSize: '0.88rem', fontWeight: 700 }}>
                ✓ Đã quay xong (Người trúng: {wheelState?.completedPrizes.find((p) => p.prizeId === 'giai-nhat')?.winnerName})
              </div>
            ) : (
              <button
                className="btn btn-primary"
                onClick={() => handleTriggerDraw('giai-nhat', 'Giải Nhất')}
                disabled={triggering || nextPrize?.prizeId !== 'giai-nhat'}
                style={{ width: '100%', padding: '10px' }}
              >
                {triggering && nextPrize?.prizeId === 'giai-nhat' ? 'Đang kích hoạt...' : '🎯 Kích Hoạt Quay Giải Nhất'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* CURRENT ELIGIBLE SEGMENTS & WEIGHT TABLE */}
      <div className="card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', margin: '0 0 4px 0', color: 'var(--text-main)' }}>
              👥 Danh Sách Thành Viên Tham Gia Vòng Quay Hiện Tại
            </h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Tổng cộng {wheelState?.wheelSegments.length || 0} thành viên • Tổng trọng số: <strong>{wheelState?.totalEligibleWeight.toLocaleString('vi-VN')} đ</strong>
            </p>
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="table" style={{ width: '100%', fontSize: '0.9rem' }}>
            <thead>
              <tr>
                <th style={{ width: '50px' }}>STT</th>
                <th>Thành viên</th>
                <th style={{ textAlign: 'right' }}>Mức đóng góp (Trọng số)</th>
                <th style={{ textAlign: 'right' }}>Tỷ lệ trúng thưởng</th>
              </tr>
            </thead>
            <tbody>
              {wheelState?.wheelSegments.map((seg, idx) => (
                <tr key={seg.memberId}>
                  <td>{idx + 1}</td>
                  <td>
                    <strong>{seg.fullName}</strong>
                    {seg.disambiguator && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
                        ({seg.disambiguator})
                      </span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>
                    {seg.weight.toLocaleString('vi-VN')} đ
                  </td>
                  <td style={{ textAlign: 'right', color: '#2563eb', fontWeight: 700 }}>
                    {seg.probabilityDisplay}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
