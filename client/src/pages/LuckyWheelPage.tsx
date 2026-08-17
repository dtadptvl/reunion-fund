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
}

// Vivid high-contrast palette for wheel segments
const SEGMENT_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#059669', '#0891b2',
  '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#e11d48',
  '#0d9488', '#65a30d', '#ca8a04', '#9333ea', '#0284c7',
  '#16a34a', '#f97316', '#3b82f6', '#8b5cf6', '#db2777'
];

export const LuckyWheelPage: React.FC<LuckyWheelPageProps> = ({ currentUser }) => {
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

  // Initial presentation start overlay
  const [showStartOverlay, setShowStartOverlay] = useState<boolean>(true);

  // Admin draw trigger state
  const [triggering, setTriggering] = useState<boolean>(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // YouTube background music state
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
            // Ongoing spin
            if (lastActiveDrawStartedAt.current !== startedAt) {
              lastActiveDrawStartedAt.current = startedAt;
              startSpinAnimation(data.activeDraw.targetAngle, data.activeDraw.durationSeconds, elapsedMs, data.activeDraw);
            }
          } else if (elapsedMs >= durationMs) {
            // Already completed spin
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

  // 2. Start Spin Animation Synchronized to Duration
  const startSpinAnimation = (
    targetAngleDeg: number,
    totalDurationSec: number,
    elapsedMs: number,
    activeDrawData: any
  ) => {
    setIsSpinningLocal(true);
    setRevealedWinner(null); // Keep winner hidden while spinning

    // Pointer is at the top (270 degrees)
    const desiredFinalAngle = (270 - targetAngleDeg + 360) % 360;
    const fullSpins = totalDurationSec >= 30 ? 24 : totalDurationSec >= 20 ? 18 : 12;
    const finalTotalRotation = fullSpins * 360 + desiredFinalAngle;

    const startTimestamp = performance.now() - elapsedMs;

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTimestamp) / (totalDurationSec * 1000));
      // Cubic ease-out curve for dramatic deceleration
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const angle = easeOut * finalTotalRotation;
      setCurrentRotation(angle);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Animation finished: reveal winner
        setIsSpinningLocal(false);
        if (activeDrawData?.winner) {
          setRevealedWinner({
            prizeTitle: activeDrawData.prizeTitle,
            name: activeDrawData.winner.fullName,
            disambiguator: activeDrawData.winner.disambiguator,
            weight: activeDrawData.winner.weight,
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

  // 3. Render Canvas Wheel with Upright Legible Typography
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !wheelState) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const size = 640;
    const center = size / 2;
    const radius = center - 24;

    canvas.width = size;
    canvas.height = size;

    ctx.clearRect(0, 0, size, size);

    // Rotate context to current spin rotation
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate((currentRotation * Math.PI) / 180);

    const segments = wheelState.wheelSegments || [];

    if (segments.length === 0) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, 2 * Math.PI);
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#475569';
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
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      // Draw Text on Segment — Upright Alignment
      ctx.save();
      const midAngleRad = startRad + (endRad - startRad) / 2;
      const midAngleDeg = (seg.startAngle + seg.endAngle) / 2;
      const angleSpanDeg = seg.endAngle - seg.startAngle;

      ctx.rotate(midAngleRad);

      // Only draw inline text if segment is wide enough (>= 6 deg)
      if (angleSpanDeg >= 6) {
        // Prevent upside down text: flip by 180 deg when midAngle is between 90 and 270 deg
        const isFlipped = midAngleDeg > 90 && midAngleDeg < 270;

        if (isFlipped) {
          ctx.rotate(Math.PI);
          ctx.textAlign = 'left';
        } else {
          ctx.textAlign = 'right';
        }

        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
        ctx.shadowBlur = 6;

        const fontSize = angleSpanDeg < 12 ? 11 : angleSpanDeg < 20 ? 13 : 15;
        ctx.font = `bold ${fontSize}px sans-serif`;

        const displayName = `${seg.fullName}${seg.disambiguator ? ` (${seg.disambiguator})` : ''}`;
        const nameText = angleSpanDeg < 10 ? displayName.split(' ').slice(-1)[0] : displayName;

        const textX = isFlipped ? -radius + 20 : radius - 20;
        const textY = angleSpanDeg >= 16 ? -4 : fontSize / 3;

        ctx.fillText(nameText, textX, textY);

        // Render percentage if segment has enough height
        if (angleSpanDeg >= 14) {
          ctx.font = `bold ${fontSize - 2}px sans-serif`;
          ctx.fillStyle = '#fef08a';
          ctx.fillText(seg.probabilityDisplay, textX, textY + fontSize + 2);
        }
      }

      ctx.restore();
    });

    ctx.restore();

    // Outer Golden Ring
    ctx.save();
    ctx.translate(center, center);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, 0, 2 * Math.PI);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#facc15';
    ctx.shadowColor = 'rgba(234, 179, 8, 0.6)';
    ctx.shadowBlur = 15;
    ctx.stroke();

    // Center Hub
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, 2 * Math.PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#facc15';
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('12A1', 0, 0);
    ctx.restore();
  }, [wheelState, currentRotation]);

  // Handle Presentation Start (Music + Fullscreen in 1 user gesture)
  const handleStartPresentation = () => {
    setShowStartOverlay(false);
    setMusicPlaying(true);
    setMusicMuted(false);

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  // Admin Trigger Draw
  const handleTriggerDraw = async (prizeId: string, prizeTitle: string) => {
    if (triggering || isSpinningLocal) return;
    setTriggering(true);
    setAdminMessage(null);

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

      setAdminMessage({
        text: `Đang quay ${prizeTitle}... Chúc may mắn!`,
        type: 'success',
      });
      await fetchWheelState();
    } catch (err: any) {
      setAdminMessage({ text: err.message || 'Lỗi khi kích hoạt quay thưởng.', type: 'error' });
    } finally {
      setTriggering(false);
    }
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
  const isAdmin = currentUser?.role === 'ADMIN';

  // Completed prizes display list: hide current spinning prize until revealed
  const displayedCompletedPrizes = (wheelState?.completedPrizes || []).filter((p) => {
    if (isSpinningLocal && wheelState?.activeDraw?.prizeId === p.prizeId) {
      return false; // Hide from history while animation is running
    }
    return true;
  });

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #070a12 0%, #0f172a 50%, #1e1b4b 100%)',
        color: '#ffffff',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        position: 'relative',
        overflowX: 'hidden',
      }}
    >
      {/* INITIAL PRESENTATION START OVERLAY */}
      {showStartOverlay && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(3, 7, 18, 0.94)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '1rem', letterSpacing: '3px', textTransform: 'uppercase', color: '#fbbf24', fontWeight: 700, marginBottom: '12px' }}>
            KỶ NIỆM 10 NĂM RA TRƯỜNG • THPT VĂN LÂM (2013–2016)
          </div>
          <h1
            style={{
              fontSize: 'clamp(2.2rem, 6vw, 3.8rem)',
              fontWeight: 900,
              color: '#ffffff',
              margin: '0 0 16px 0',
              background: 'linear-gradient(135deg, #ffffff 0%, #fef08a 50%, #eab308 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textShadow: '0 4px 30px rgba(234, 179, 8, 0.5)',
            }}
          >
            🎡 VÒNG QUAY MAY MẮN
          </h1>
          <p style={{ maxWidth: '600px', color: '#cbd5e1', fontSize: '1.1rem', lineHeight: 1.6, marginBottom: '32px' }}>
            Chào mừng bạn đến với chương trình quay thưởng tri ân tập thể lớp A1. Nhấn nút bên dưới để mở toàn màn hình và bắt đầu nhạc nền gala.
          </p>
          <button
            onClick={handleStartPresentation}
            style={{
              background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
              color: '#000000',
              fontWeight: 900,
              fontSize: '1.3rem',
              padding: '16px 44px',
              borderRadius: '40px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 0 35px rgba(234, 179, 8, 0.7)',
              transition: 'transform 0.2s ease',
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.06)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            🎬 BẮT ĐẦU TRÌNH CHIẾU
          </button>
        </div>
      )}

      {/* BACKGROUND YOUTUBE MUSIC (LOOPING) */}
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

      {/* TOP HEADER CONTROLS */}
      <div
        style={{
          width: '100%',
          maxWidth: '1200px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
              color: '#000000',
              fontWeight: 800,
              fontSize: '0.85rem',
              padding: '4px 14px',
              borderRadius: '20px',
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}
          >
            🎡 QUAY SỐ MAY MẮN
          </span>
          <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>
            Lớp A1 — Khóa 48 THPT Văn Lâm
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* MUSIC TOGGLE */}
          <button
            onClick={() => setMusicPlaying(!musicPlaying)}
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
              onClick={() => setMusicMuted(!musicMuted)}
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

          {/* FULLSCREEN */}
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
        </div>
      </div>

      {/* PRIZE HEADER TITLE & ACTIVE PRIZE BANNER */}
      <div style={{ textAlign: 'center', marginBottom: '20px' }}>
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
          {isSpinningLocal
            ? 'ĐANG QUAY THƯỞNG...'
            : wheelState?.status === 'FINISHED'
            ? 'ĐÃ HOÀN TẤT QUAY THƯỞNG'
            : 'HẠNG MỤC HIỆN TẠI'}
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
            Thời lượng: <strong>{wheelState.nextPrize.durationSeconds} giây</strong> • Tỷ lệ phân bổ theo mức đóng góp
          </p>
        )}
      </div>

      {/* ADMIN CONTROL BUTTONS EMBEDDED DIRECTLY ON PRESENTATION PAGE */}
      {isAdmin && (
        <div
          style={{
            marginBottom: '24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          {wheelState?.nextPrize ? (
            <button
              onClick={() => handleTriggerDraw(wheelState.nextPrize!.prizeId, wheelState.nextPrize!.prizeTitle)}
              disabled={triggering || isSpinningLocal}
              style={{
                background: isSpinningLocal ? '#475569' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '1.2rem',
                padding: '14px 36px',
                borderRadius: '30px',
                border: '2px solid #60a5fa',
                cursor: isSpinningLocal ? 'not-allowed' : 'pointer',
                boxShadow: isSpinningLocal ? 'none' : '0 0 25px rgba(37, 99, 235, 0.6)',
                transition: 'all 0.2s ease',
              }}
              onMouseOver={(e) => {
                if (!isSpinningLocal) e.currentTarget.style.transform = 'scale(1.05)';
              }}
              onMouseOut={(e) => {
                if (!isSpinningLocal) e.currentTarget.style.transform = 'scale(1)';
              }}
            >
              {triggering
                ? 'ĐANG KÍCH HOẠT...'
                : isSpinningLocal
                ? 'ĐANG QUAY THƯỞNG...'
                : `🎯 BẮT ĐẦU QUAY ${wheelState.nextPrize.prizeTitle.toUpperCase()} (${wheelState.nextPrize.durationSeconds}S)`}
            </button>
          ) : (
            <div style={{ background: '#166534', color: '#bbf7d0', padding: '8px 20px', borderRadius: '20px', fontWeight: 700, fontSize: '0.95rem' }}>
              ✓ ĐÃ HOÀN TẤT TẤT CẢ CÁC HẠNG MỤC QUAY THƯỞNG
            </div>
          )}

          {adminMessage && (
            <div style={{ fontSize: '0.85rem', color: adminMessage.type === 'success' ? '#86efac' : '#fca5a5' }}>
              {adminMessage.text}
            </div>
          )}
        </div>
      )}

      {/* MAIN STAGE: WHEEL + LEGEND + WINNER REVEAL */}
      <div
        style={{
          width: '100%',
          maxWidth: '1100px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          alignItems: 'center',
          gap: '32px',
          marginBottom: '32px',
        }}
      >
        {/* LEFT/CENTER: WHEEL DISPLAY */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
          {/* WHEEL POINTER AT TOP */}
          <div
            style={{
              position: 'absolute',
              top: '-16px',
              zIndex: 30,
              width: 0,
              height: 0,
              borderLeft: '20px solid transparent',
              borderRight: '20px solid transparent',
              borderTop: '38px solid #ef4444',
              filter: 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.9))',
            }}
          />

          <div
            style={{
              width: 'min(90vw, 500px)',
              height: 'min(90vw, 500px)',
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
                  : '0 10px 40px rgba(0, 0, 0, 0.6)',
                transition: isSpinningLocal ? 'none' : 'box-shadow 0.5s ease',
              }}
            />
          </div>
        </div>

        {/* RIGHT: ELIGIBLE MEMBERS LEGEND & LIVE STATS */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '20px',
            maxHeight: '500px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fef08a', margin: 0 }}>
              📋 THÀNH VIÊN THAM GIA ({wheelState?.wheelSegments.length || 0})
            </h2>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              Tổng: {wheelState?.totalEligibleWeight.toLocaleString('vi-VN')} đ
            </span>
          </div>

          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {wheelState?.wheelSegments.map((seg, idx) => {
              const swatchColor = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
              return (
                <div
                  key={seg.memberId}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: swatchColor, flexShrink: 0 }} />
                    <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                      {seg.fullName}
                      {seg.disambiguator && (
                        <span style={{ opacity: 0.7, fontSize: '0.8rem', marginLeft: '4px' }}>
                          ({seg.disambiguator})
                        </span>
                      )}
                    </span>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fef08a' }}>
                      {seg.probabilityDisplay}
                    </span>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {seg.weight.toLocaleString('vi-VN')} đ
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* WINNER REVEAL CELEBRATION (ONLY AFTER ANIMATION COMPLETES) */}
      {revealedWinner && (
        <div
          style={{
            marginBottom: '32px',
            width: '100%',
            maxWidth: '680px',
            background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(202, 138, 4, 0.4) 100%)',
            border: '2px solid #facc15',
            borderRadius: '20px',
            padding: '24px 30px',
            textAlign: 'center',
            boxShadow: '0 0 50px rgba(234, 179, 8, 0.6)',
            animation: 'fadeInUp 0.6s ease',
          }}
        >
          <div style={{ fontSize: '0.95rem', color: '#fef08a', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase' }}>
            🎉 CHÚC MỪNG CHIẾN THẮNG {revealedWinner.prizeTitle.toUpperCase()} 🎉
          </div>
          <div
            style={{
              fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 900,
              color: '#ffffff',
              margin: '8px 0',
              textShadow: '0 2px 25px rgba(255, 255, 255, 0.9)',
            }}
          >
            {revealedWinner.name}
            {revealedWinner.disambiguator && (
              <span style={{ fontSize: '1.3rem', opacity: 0.85, marginLeft: '8px' }}>
                ({revealedWinner.disambiguator})
              </span>
            )}
          </div>
          <div style={{ fontSize: '1rem', color: '#fef08a', fontWeight: 700 }}>
            Mức đóng góp hợp lệ: <strong>{revealedWinner.weight.toLocaleString('vi-VN')} đ</strong>
          </div>
        </div>
      )}

      {/* COMPLETED PRIZES RESULTS SECTION */}
      <div
        style={{
          width: '100%',
          maxWidth: '1000px',
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
          {renderPrizeCard('Giải Ba', 'giai-ba', displayedCompletedPrizes)}
          {/* GIẢI NHÌ */}
          {renderPrizeCard('Giải Nhì', 'giai-nhi', displayedCompletedPrizes)}
          {/* GIẢI NHẤT */}
          {renderPrizeCard('Giải Nhất', 'giai-nhat', displayedCompletedPrizes)}
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
        background: winner ? 'rgba(234, 179, 8, 0.12)' : 'rgba(0, 0, 0, 0.25)',
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
