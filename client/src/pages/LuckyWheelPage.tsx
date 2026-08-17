import React, { useEffect, useRef, useState } from 'react';

interface LuckyWheelSegment {
  memberId: string;
  fullName: string;
  disambiguator: string | null;
  weight: number;
  probability: number;
  probabilityDisplay: string;
  startAngle: number;
  endAngle: number;
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
    targetSegmentIndex: number;
    targetAngle: number;
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

interface LuckyWheelPageProps {
  currentUser?: any;
  onGoToAdmin?: () => void;
}

// Vivid festive palette for wheel segments
const SEGMENT_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#10b981', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#14b8a6', '#84cc16', '#eab308', '#d946ef', '#0284c7',
  '#059669', '#ea580c', '#4f46e5', '#7c3aed', '#db2777'
];

export const LuckyWheelPage: React.FC<LuckyWheelPageProps> = ({ currentUser, onGoToAdmin }) => {
  const [wheelState, setWheelState] = useState<LuckyWheelState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [currentRotation, setCurrentRotation] = useState<number>(0);
  const [isSpinningLocal, setIsSpinningLocal] = useState<boolean>(false);
  const [revealedWinner, setRevealedWinner] = useState<{
    prizeTitle: string;
    name: string;
    disambiguator: string | null;
    weight: number;
  } | null>(null);

  // YouTube audio player state
  const [musicPlaying, setMusicPlaying] = useState<boolean>(false);
  const [musicMuted, setMusicMuted] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastActiveDrawStartedAt = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // 1. Fetch Wheel State with Lightweight Polling
  const fetchWheelState = async () => {
    try {
      const res = await fetch('/api/v1/public/lottery/wheel-state');
      if (res.ok) {
        const data: LuckyWheelState = await res.json();
        setWheelState(data);
        setLoading(false);

        // Handle Active Draw Animation
        if (data.activeDraw) {
          const startedAt = data.activeDraw.startedAt;
          const serverNowMs = new Date(data.serverTime).getTime();
          const startedMs = new Date(startedAt).getTime();
          const durationMs = data.activeDraw.durationSeconds * 1000;
          const elapsedMs = serverNowMs - startedMs;

          if (elapsedMs < durationMs && elapsedMs >= 0) {
            // New spin or currently ongoing spin
            if (lastActiveDrawStartedAt.current !== startedAt) {
              lastActiveDrawStartedAt.current = startedAt;
              startSpinAnimation(data.activeDraw.targetAngle, data.activeDraw.durationSeconds, elapsedMs);
            }
          } else if (elapsedMs >= durationMs) {
            // Spin completed
            if (!isSpinningLocal && data.activeDraw.winner) {
              setRevealedWinner({
                prizeTitle: data.activeDraw.prizeTitle,
                name: data.activeDraw.winner.fullName,
                disambiguator: data.activeDraw.winner.disambiguator,
                weight: data.activeDraw.winner.weight,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('Error fetching wheel state:', err);
    }
  };

  useEffect(() => {
    fetchWheelState();
    const interval = setInterval(fetchWheelState, 1500);
    return () => clearInterval(interval);
  }, []);

  // 2. Smooth Spin Animation synchronized with duration
  const startSpinAnimation = (targetAngleDeg: number, totalDurationSec: number, elapsedMs: number) => {
    setIsSpinningLocal(true);
    setRevealedWinner(null);

    // Pointer is at the top (270 degrees)
    // To have targetAngle align at top 270 deg:
    // targetRotation mod 360 = (270 - targetAngleDeg + 360) mod 360
    const desiredFinalAngle = (270 - targetAngleDeg + 360) % 360;
    // Add large number of rotations depending on duration
    const fullSpins = totalDurationSec >= 30 ? 25 : totalDurationSec >= 20 ? 18 : 12;
    const finalTotalRotation = fullSpins * 360 + desiredFinalAngle;

    const startTimestamp = performance.now() - elapsedMs;

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTimestamp) / (totalDurationSec * 1000));
      // Cubic ease-out deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const angle = easeOut * finalTotalRotation;
      setCurrentRotation(angle);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setIsSpinningLocal(false);
        if (wheelState?.activeDraw?.winner) {
          setRevealedWinner({
            prizeTitle: wheelState.activeDraw.prizeTitle,
            name: wheelState.activeDraw.winner.fullName,
            disambiguator: wheelState.activeDraw.winner.disambiguator,
            weight: wheelState.activeDraw.winner.weight,
          });
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  };

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, []);

  // 3. Render Canvas Wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !wheelState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 600;
    const center = size / 2;
    const radius = center - 20;

    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    // Save and rotate context
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate((currentRotation * Math.PI) / 180);

    const segments = wheelState.wheelSegments || [];

    if (segments.length === 0) {
      // Empty wheel placeholder
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#334155';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#64748b';
      ctx.stroke();

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Chưa có thành viên hợp lệ', 0, 0);
      ctx.restore();
      return;
    }

    // Draw Wheel Segments
    segments.forEach((seg, i) => {
      const startRad = (seg.startAngle * Math.PI) / 180;
      const endRad = (seg.endAngle * Math.PI) / 180;
      const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length];

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, startRad, endRad);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Draw Text on Segment
      ctx.save();
      const midAngle = startRad + (endRad - startRad) / 2;
      ctx.rotate(midAngle);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 4;

      const angleSpanDeg = seg.endAngle - seg.startAngle;
      const fontSize = angleSpanDeg < 8 ? 10 : angleSpanDeg < 15 ? 12 : 14;
      ctx.font = `bold ${fontSize}px sans-serif`;

      const displayName = `${seg.fullName}${seg.disambiguator ? ` (${seg.disambiguator})` : ''}`;
      // Truncate if segment is small
      const label = angleSpanDeg < 10 ? displayName.split(' ').slice(-1)[0] : displayName;
      ctx.fillText(label, radius - 24, fontSize / 3);

      // Percentage label if angle is large enough
      if (angleSpanDeg >= 14) {
        ctx.font = `600 ${fontSize - 2}px sans-serif`;
        ctx.fillStyle = '#fef08a';
        ctx.fillText(`${seg.probabilityDisplay}`, radius - 24, fontSize + 4);
      }

      ctx.restore();
    });

    // Outer wheel border & glowing ring
    ctx.restore();

    ctx.save();
    ctx.translate(center, center);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, 0, 2 * Math.PI);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();

    // Center Hub
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('12A1', 0, 0);
    ctx.restore();
  }, [wheelState, currentRotation]);

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Toggle YouTube Music
  const handleToggleMusic = () => {
    setMusicPlaying(!musicPlaying);
  };

  const handleToggleMute = () => {
    setMusicMuted(!musicMuted);
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e1b4b 100%)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.2rem',
        }}
      >
        Đang tải vòng quay may mắn...
      </div>
    );
  }

  const activePrizeTitle = wheelState?.activeDraw?.prizeTitle || wheelState?.nextPrize?.prizeTitle || 'Vòng Quay May Mắn';

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e1b4b 100%)',
        color: '#ffffff',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* BACKGROUND YOUTUBE MUSIC (ID: atq9S7pp1rQ) */}
      <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {musicPlaying && (
          <iframe
            ref={iframeRef}
            width="100"
            height="100"
            src={`https://www.youtube.com/embed/atq9S7pp1rQ?autoplay=1&loop=1&playlist=atq9S7pp1rQ&enablejsapi=1&mute=${musicMuted ? 1 : 0}`}
            title="Lucky Wheel Music"
            allow="autoplay"
          />
        )}
      </div>

      {/* TOP CONTROLS & STATUS BAR */}
      <div
        style={{
          width: '100%',
          maxWidth: '1100px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
              color: '#000000',
              fontWeight: 800,
              fontSize: '0.85rem',
              padding: '4px 12px',
              borderRadius: '20px',
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}
          >
            🎡 QUAY SỐ MAY MẮN
          </span>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
            Kỷ niệm 10 năm THPT Văn Lâm
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* MUSIC CONTROLS */}
          <button
            onClick={handleToggleMusic}
            style={{
              background: musicPlaying ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              border: `1px solid ${musicPlaying ? '#10b981' : 'rgba(255, 255, 255, 0.2)'}`,
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {musicPlaying ? '🎵 Tắt nhạc' : '🔊 Bật nhạc nền'}
          </button>

          {musicPlaying && (
            <button
              onClick={handleToggleMute}
              style={{
                background: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                padding: '6px 12px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                cursor: 'pointer',
              }}
            >
              {musicMuted ? '🔇' : '🔈'}
            </button>
          )}

          {/* FULLSCREEN BUTTON */}
          <button
            onClick={toggleFullscreen}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              padding: '6px 14px',
              borderRadius: '20px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⛶ Toàn màn hình
          </button>

          {/* ADMIN SHORTCUT */}
          {currentUser?.role === 'ADMIN' && onGoToAdmin && (
            <button
              onClick={onGoToAdmin}
              style={{
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                padding: '6px 14px',
                borderRadius: '20px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ⚙ Quản trị quay
            </button>
          )}
        </div>
      </div>

      {/* PRIZE HEADER TITLE */}
      <div style={{ textAlign: 'center', marginBottom: '24px' }}>
        <div
          style={{
            fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color: '#fbbf24',
            fontWeight: 700,
            marginBottom: '4px',
          }}
        >
          {isSpinningLocal ? 'ĐANG QUAY THƯỞNG...' : wheelState?.status === 'FINISHED' ? 'ĐÃ HOÀN TẤT QUAY THƯỞNG' : 'HẠNG MỤC TIẾP THEO'}
        </div>
        <h1
          style={{
            fontSize: 'clamp(2.2rem, 6vw, 3.8rem)',
            fontWeight: 900,
            margin: 0,
            lineHeight: 1.1,
            background: 'linear-gradient(135deg, #ffffff 0%, #fef08a 50%, #eab308 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 4px 30px rgba(234, 179, 8, 0.4)',
          }}
        >
          {activePrizeTitle}
        </h1>
        {wheelState?.nextPrize && !isSpinningLocal && (
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', margin: '6px 0 0 0' }}>
            Thời lượng quay: <strong>{wheelState.nextPrize.durationSeconds} giây</strong> • Tỷ lệ phân bổ theo mức đóng góp
          </p>
        )}
      </div>

      {/* MAIN STAGE: WHEEL + WINNER REVEAL */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          width: '100%',
          maxWidth: '650px',
          marginBottom: '32px',
        }}
      >
        {/* WHEEL POINTER AT TOP */}
        <div
          style={{
            position: 'absolute',
            top: '-14px',
            zIndex: 30,
            width: 0,
            height: 0,
            borderLeft: '18px solid transparent',
            borderRight: '18px solid transparent',
            borderTop: '36px solid #ef4444',
            filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.8))',
          }}
        />

        {/* CANVAS WHEEL */}
        <div
          style={{
            width: 'min(90vw, 520px)',
            height: 'min(90vw, 520px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              boxShadow: isSpinningLocal
                ? '0 0 60px rgba(234, 179, 8, 0.6), 0 0 100px rgba(59, 130, 246, 0.3)'
                : '0 10px 40px rgba(0, 0, 0, 0.5)',
              transition: isSpinningLocal ? 'none' : 'box-shadow 0.5s ease',
            }}
          />
        </div>

        {/* WINNER REVEAL BANNER */}
        {revealedWinner && (
          <div
            style={{
              marginTop: '24px',
              width: '100%',
              maxWidth: '560px',
              background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.2) 0%, rgba(202, 138, 4, 0.35) 100%)',
              border: '2px solid #facc15',
              borderRadius: '16px',
              padding: '20px 24px',
              textAlign: 'center',
              boxShadow: '0 0 40px rgba(234, 179, 8, 0.5)',
              animation: 'fadeInUp 0.6s ease',
            }}
          >
            <div style={{ fontSize: '0.9rem', color: '#fef08a', fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase' }}>
              🎉 CHÚC MỪNG CHIẾN THẮNG {revealedWinner.prizeTitle.toUpperCase()} 🎉
            </div>
            <div
              style={{
                fontSize: 'clamp(1.8rem, 5vw, 2.6rem)',
                fontWeight: 900,
                color: '#ffffff',
                margin: '8px 0',
                textShadow: '0 2px 20px rgba(255, 255, 255, 0.8)',
              }}
            >
              {revealedWinner.name}
              {revealedWinner.disambiguator && (
                <span style={{ fontSize: '1.2rem', opacity: 0.85, marginLeft: '6px' }}>
                  ({revealedWinner.disambiguator})
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.95rem', color: '#cbd5e1' }}>
              Mức đóng góp hợp lệ: <strong style={{ color: '#fef08a' }}>{revealedWinner.weight.toLocaleString('vi-VN')} đ</strong>
            </div>
          </div>
        )}
      </div>

      {/* COMPLETED PRIZES RESULTS SECTION */}
      <div
        style={{
          width: '100%',
          maxWidth: '900px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          padding: '24px',
        }}
      >
        <h2
          style={{
            fontSize: '1.2rem',
            fontWeight: 800,
            color: '#fef08a',
            margin: '0 0 16px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          🏆 BẢNG VINH DANH TRÚNG THƯỞNG
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {/* GIẢI BA */}
          {renderPrizeCard('Giải Ba', 'giai-ba', wheelState?.completedPrizes)}
          {/* GIẢI NHÌ */}
          {renderPrizeCard('Giải Nhì', 'giai-nhi', wheelState?.completedPrizes)}
          {/* GIẢI NHẤT */}
          {renderPrizeCard('Giải Nhất', 'giai-nhat', wheelState?.completedPrizes)}
        </div>
      </div>

      {/* FOOTER NOTICE */}
      <div style={{ marginTop: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
        Tỷ lệ trúng thưởng được tính toán tự động dựa trên tổng số tiền đóng góp hợp lệ của từng thành viên.
      </div>
    </div>
  );
};

function renderPrizeCard(
  title: string,
  prizeId: string,
  completed?: CompletedPrize[]
) {
  const winner = completed?.find((p) => p.prizeId === prizeId);

  return (
    <div
      style={{
        background: winner ? 'rgba(234, 179, 8, 0.1)' : 'rgba(0, 0, 0, 0.2)',
        border: winner ? '1px solid #eab308' : '1px dashed rgba(255, 255, 255, 0.15)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#facc15', textTransform: 'uppercase' }}>
          {title}
        </span>
        {winner ? (
          <span style={{ fontSize: '0.75rem', background: '#166534', color: '#bbf7d0', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
            ✓ Đã có chủ nhân
          </span>
        ) : (
          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
            Chưa quay
          </span>
        )}
      </div>

      {winner ? (
        <>
          <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#ffffff' }}>
            👑 {winner.winnerName}
            {winner.winnerDisambiguator && (
              <span style={{ fontSize: '0.9rem', opacity: 0.8, marginLeft: '4px' }}>
                ({winner.winnerDisambiguator})
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#94a3b8' }}>
            Đóng góp: <strong style={{ color: '#fef08a' }}>{winner.winnerWeight.toLocaleString('vi-VN')} đ</strong>
          </div>
        </>
      ) : (
        <div style={{ fontSize: '0.95rem', color: '#64748b', fontStyle: 'italic', padding: '8px 0' }}>
          Đang chờ kết quả...
        </div>
      )}
    </div>
  );
}
