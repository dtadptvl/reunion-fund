import React, { useEffect, useRef, useState } from 'react';
import { formatVND } from '../utils/format.js';

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

interface BackgroundMusicMetadata {
  filename: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  actor: string;
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
  hasBackgroundMusic: boolean;
  backgroundMusicMetadata: BackgroundMusicMetadata | null;
  allowTestReset: boolean;
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

// 25 Vivid high-contrast projector-ready palette
const SEGMENT_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#059669', '#0891b2',
  '#2563eb', '#4f46e5', '#7c3aed', '#c026d3', '#e11d48',
  '#0d9488', '#65a30d', '#ca8a04', '#9333ea', '#0284c7',
  '#16a34a', '#f97316', '#3b82f6', '#8b5cf6', '#db2777',
  '#e11d48', '#0284c7', '#10b981', '#f59e0b', '#6366f1'
];

export const LuckyWheelPage: React.FC<LuckyWheelPageProps> = ({ currentUser }) => {
  const [wheelState, setWheelState] = useState<LuckyWheelState | null>(null);
  const [currentRotation, setCurrentRotation] = useState<number>(0);
  const [isSpinningLocal, setIsSpinningLocal] = useState<boolean>(false);
  const [revealedWinner, setRevealedWinner] = useState<{
    prizeTitle: string;
    name: string;
    disambiguator: string | null;
    weight: number;
  } | null>(null);

  // Presentation Mode State
  const [isPresentationMode, setIsPresentationMode] = useState<boolean>(false);
  const [showStartOverlay, setShowStartOverlay] = useState<boolean>(true);

  // Admin draw trigger & reset state
  const [triggering, setTriggering] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
  const [showResetModal, setShowResetModal] = useState<boolean>(false);
  const [adminMessage, setAdminMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Native Audio player state
  const [musicPlaying, setMusicPlaying] = useState<boolean>(false);
  const [musicMuted, setMusicMuted] = useState<boolean>(false);
  const [musicAvailable, setMusicAvailable] = useState<boolean>(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
        setMusicAvailable(Boolean(data.hasBackgroundMusic));

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
      console.error('Error fetching lucky wheel state:', err);
    }
  };

  useEffect(() => {
    fetchWheelState();
    const interval = setInterval(fetchWheelState, 2000);
    return () => clearInterval(interval);
  }, []);

  // 2. Wheel Spin Animation
  const startSpinAnimation = (
    targetAngleDeg: number,
    totalDurationSec: number,
    elapsedMs: number,
    activeDrawData: any
  ) => {
    setIsSpinningLocal(true);
    setRevealedWinner(null);

    const fullRotations = 8 * 360;
    const finalAngle = (360 - (targetAngleDeg % 360) + 270) % 360;
    const finalTotalRotation = fullRotations + finalAngle;

    const startTimestamp = performance.now() - elapsedMs;

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTimestamp) / (totalDurationSec * 1000));
      // Cubic ease-out curve for smooth deceleration
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

  // 3. Render Canvas Wheel with PURE NUMBER BADGES (No names, no percentages, always UPRIGHT)
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

    const segments = wheelState.wheelSegments || [];
    const count = segments.length;

    if (count === 0) {
      ctx.save();
      ctx.translate(center, center);
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

    // Step A: Draw Wheel Segments (Rotated with Current Spin)
    ctx.save();
    ctx.translate(center, center);
    ctx.rotate((currentRotation * Math.PI) / 180);

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
    });

    ctx.restore();

    // Step B: Draw Number Labels on Segments (ALWAYS UPRIGHT, NEVER UPSIDE-DOWN OR INVERTED)
    segments.forEach((seg, i) => {
      const midAngleDeg = (seg.startAngle + seg.endAngle) / 2;
      const angleSpanDeg = seg.endAngle - seg.startAngle;

      // Absolute angle in canvas coordinate space
      const currentCanvasAngleDeg = (currentRotation + midAngleDeg) % 360;
      const currentCanvasAngleRad = (currentCanvasAngleDeg * Math.PI) / 180;

      // Position number at 0.62 * radius from center (visually centered in wedge)
      const labelRadius = radius * 0.62;
      const x = center + labelRadius * Math.cos(currentCanvasAngleRad);
      const y = center + labelRadius * Math.sin(currentCanvasAngleRad);

      // Adaptive font size based on segment width (clamped between 15px and 24px)
      const fontSize = Math.max(15, Math.min(24, Math.floor(angleSpanDeg * 1.25)));

      ctx.save();
      ctx.translate(x, y);

      // Draw high-contrast backdrop shadow & crisp bold upright number
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 2;
      ctx.font = `900 ${fontSize}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Render ONLY the participant number
      ctx.fillText(`${i + 1}`, 0, 0);

      ctx.restore();
    });

    // Step C: Outer Golden Rim
    ctx.save();
    ctx.translate(center, center);
    ctx.beginPath();
    ctx.arc(0, 0, radius + 2, 0, 2 * Math.PI);
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#facc15';
    ctx.shadowColor = 'rgba(234, 179, 8, 0.6)';
    ctx.shadowBlur = 16;
    ctx.stroke();

    // Step D: Center Hub "12A1"
    ctx.beginPath();
    ctx.arc(0, 0, 44, 0, 2 * Math.PI);
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

  // 4. Handle Presentation Start & Background Music
  const handleStartPresentation = () => {
    setShowStartOverlay(false);
    setIsPresentationMode(true);

    if (audioRef.current && musicAvailable) {
      audioRef.current.volume = 0.7;
      audioRef.current.play()
        .then(() => setMusicPlaying(true))
        .catch((err) => console.warn('Autoplay prevented:', err));
    }

    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const handleToggleMusic = () => {
    if (!audioRef.current) return;
    if (musicPlaying) {
      audioRef.current.pause();
      setMusicPlaying(false);
    } else {
      audioRef.current.play()
        .then(() => setMusicPlaying(true))
        .catch(() => {});
    }
  };

  const handleToggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !musicMuted;
    setMusicMuted(!musicMuted);
  };

  // 5. Admin Trigger Draw Action
  const handleTriggerDraw = async (prizeId: string) => {
    setTriggering(true);
    setAdminMessage(null);
    try {
      const res = await fetch('/api/v1/admin/lottery/draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prizeId }),
      });
      const data = await res.json();
      if (res.ok) {
        await fetchWheelState();
      } else {
        setAdminMessage({ text: data.error || 'Lỗi khi kích hoạt quay thưởng', type: 'error' });
      }
    } catch (err) {
      setAdminMessage({ text: 'Lỗi kết nối máy chủ', type: 'error' });
    } finally {
      setTriggering(false);
    }
  };

  // 6. Admin Official Lottery Reset Action
  const handleResetLottery = async () => {
    setResetting(true);
    setAdminMessage(null);
    setShowResetModal(false);
    try {
      const res = await fetch('/api/v1/admin/lottery/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setAdminMessage({ text: 'Đã đặt lại kết quả quay thưởng thành công.', type: 'success' });
        setRevealedWinner(null);
        setCurrentRotation(0);
        await fetchWheelState();
      } else {
        setAdminMessage({ text: data.error || 'Lỗi khi đặt lại kết quả', type: 'error' });
      }
    } catch (err) {
      setAdminMessage({ text: 'Lỗi kết nối máy chủ', type: 'error' });
    } finally {
      setResetting(false);
    }
  };

  const isAdmin = currentUser?.role === 'ADMIN';
  const isCompletedAll = wheelState?.status === 'FINISHED' || (!wheelState?.nextPrize && (wheelState?.completedPrizes?.length || 0) >= 3);
  const activePrize = wheelState?.nextPrize;
  const segments = wheelState?.wheelSegments || [];

  return (
    <div
      className={isPresentationMode ? 'presentation-active' : ''}
      style={{
        ...(isPresentationMode
          ? {
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              width: '100vw',
              height: '100vh',
              overflow: 'hidden',
              padding: '12px 20px',
              boxSizing: 'border-box',
            }
          : {
              minHeight: '100vh',
              padding: '20px 16px 40px',
              boxSizing: 'border-box',
            }),
        background: 'linear-gradient(135deg, #070a12 0%, #0f172a 50%, #1e1b4b 100%)',
        color: '#ffffff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {/* NATIVE HTML5 AUDIO ELEMENT */}
      <audio
        ref={audioRef}
        src="/api/v1/public/lottery/background-music"
        loop
        preload="auto"
        onPlay={() => setMusicPlaying(true)}
        onPause={() => setMusicPlaying(false)}
        onError={() => setMusicAvailable(false)}
      />

      {/* INITIAL PRESENTATION START OVERLAY */}
      {showStartOverlay && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            background: 'rgba(3, 7, 18, 0.96)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '0.95rem', letterSpacing: '3px', textTransform: 'uppercase', color: '#fbbf24', fontWeight: 700, marginBottom: '12px' }}>
            KỶ NIỆM 10 NĂM RA TRƯỜNG • THPT VĂN LÂM (2013–2016)
          </div>
          <h1
            style={{
              fontSize: 'clamp(2.2rem, 5vw, 3.6rem)',
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
          <p style={{ maxWidth: '620px', color: '#cbd5e1', fontSize: '1.05rem', lineHeight: 1.6, marginBottom: '28px' }}>
            Chào mừng bạn đến với chương trình quay số tri ân tập thể lớp A1. Nhấn nút bên dưới để mở giao diện trình chiếu sân khấu (16:9) và tự động phát nhạc nền gala.
          </p>
          <button
            onClick={handleStartPresentation}
            style={{
              background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
              color: '#000000',
              fontWeight: 900,
              fontSize: '1.25rem',
              padding: '16px 40px',
              borderRadius: '40px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 0 35px rgba(234, 179, 8, 0.7)',
              transition: 'transform 0.2s ease',
            }}
            onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
            onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            🎬 BẮT ĐẦU TRÌNH CHIẾU
          </button>
        </div>
      )}

      {/* TOP HEADER CONTROLS (COMPACT LANDSCAPE BAR) */}
      <div
        style={{
          width: '100%',
          maxWidth: '1560px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: '8px',
          flexShrink: 0,
          boxSizing: 'border-box',
        }}
      >
        {/* Left Badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
              color: '#000000',
              fontWeight: 800,
              fontSize: '0.8rem',
              padding: '4px 12px',
              borderRadius: '16px',
              letterSpacing: '1px',
              textTransform: 'uppercase',
            }}
          >
            🎡 QUAY SỐ MAY MẮN
          </span>
          <span style={{ fontSize: '0.85rem', color: '#94a3b8', fontWeight: 600 }}>
            Lớp A1 — Khóa 48 (2013–2016)
          </span>
        </div>

        {/* Center: Stage Status */}
        <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isSpinningLocal ? (
            <span
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.95rem',
                padding: '4px 18px',
                borderRadius: '20px',
                animation: 'pulse 1.2s infinite ease-in-out',
                boxShadow: '0 0 15px rgba(239, 68, 68, 0.6)',
              }}
            >
              ⏳ ĐANG QUAY {(activePrize?.prizeTitle || 'GIẢI THƯỞNG').toUpperCase()}...
            </span>
          ) : isCompletedAll ? (
            <span
              style={{
                background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.95rem',
                padding: '4px 18px',
                borderRadius: '20px',
                boxShadow: '0 0 15px rgba(22, 163, 74, 0.5)',
              }}
            >
              ✓ ĐÃ HOÀN TẤT TẤT CẢ CÁC GIẢI THƯỞNG
            </span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#fbbf24', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                HẠNG MỤC TIẾP THEO:
              </span>
              <strong style={{ fontSize: '1.05rem', color: '#ffffff', fontWeight: 800 }}>
                {activePrize?.prizeTitle || 'GIẢI BA'}
              </strong>
            </div>
          )}
        </div>

        {/* Right Controls: Admin Triggers + Music + Screen */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Admin Draw Action (Strict Exact Button Text) */}
          {isAdmin && activePrize && !isSpinningLocal && (
            <button
              onClick={() => handleTriggerDraw(activePrize.prizeId)}
              disabled={triggering || isSpinningLocal}
              style={{
                background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.85rem',
                padding: '6px 16px',
                borderRadius: '20px',
                border: '1px solid #60a5fa',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(37, 99, 235, 0.5)',
              }}
            >
              {triggering ? 'Đang kích hoạt...' : `Bắt đầu quay ${activePrize.prizeTitle}`}
            </button>
          )}

          {/* Official Admin Reset Button */}
          {isAdmin && (
            <button
              onClick={() => setShowResetModal(true)}
              disabled={resetting || isSpinningLocal}
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid #ef4444',
                color: '#fca5a5',
                padding: '5px 12px',
                borderRadius: '16px',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {resetting ? 'Đang đặt lại...' : 'Đặt lại kết quả'}
            </button>
          )}

          {/* Persistent Music Player Controls */}
          {musicAvailable ? (
            <>
              <button
                onClick={handleToggleMusic}
                style={{
                  background: musicPlaying ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  border: `1px solid ${musicPlaying ? '#10b981' : 'rgba(255, 255, 255, 0.2)'}`,
                  color: '#ffffff',
                  padding: '5px 12px',
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title={musicPlaying ? 'Tạm dừng nhạc nền' : 'Phát nhạc nền'}
              >
                {musicPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
              </button>

              <button
                onClick={handleToggleMute}
                style={{
                  background: musicMuted ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                  border: `1px solid ${musicMuted ? '#ef4444' : 'rgba(255, 255, 255, 0.2)'}`,
                  color: '#ffffff',
                  padding: '5px 10px',
                  borderRadius: '16px',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
                title={musicMuted ? 'Bật tiếng' : 'Tắt tiếng'}
              >
                {musicMuted ? '🔇' : '🔈'}
              </button>
            </>
          ) : (
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              🔇 Nhạc nền chưa khả dụng
            </span>
          )}

          {/* Presentation Toggle */}
          <button
            onClick={() => {
              if (isPresentationMode && document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
              }
              setIsPresentationMode(!isPresentationMode);
            }}
            style={{
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              color: '#ffffff',
              padding: '5px 12px',
              borderRadius: '16px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isPresentationMode ? '✕ Thu nhỏ' : '⛶ Toàn màn hình'}
          </button>
        </div>
      </div>

      {/* Admin Status Toast */}
      {adminMessage && (
        <div
          style={{
            padding: '6px 16px',
            borderRadius: '16px',
            marginBottom: '6px',
            fontSize: '0.85rem',
            fontWeight: 600,
            background: adminMessage.type === 'error' ? 'rgba(239, 68, 68, 0.25)' : 'rgba(16, 185, 129, 0.25)',
            border: `1px solid ${adminMessage.type === 'error' ? '#ef4444' : '#10b981'}`,
            color: adminMessage.type === 'error' ? '#fca5a5' : '#86efac',
            boxSizing: 'border-box',
          }}
        >
          {adminMessage.text}
        </div>
      )}

      {/* MAIN 16:9 SPLIT PRESENTATION LAYOUT */}
      <div
        style={{
          width: '100%',
          maxWidth: '1560px',
          flex: 1,
          display: 'grid',
          gridTemplateColumns: isPresentationMode ? '55% 45%' : 'minmax(0, 1.2fr) minmax(0, 1fr)',
          gap: '16px',
          alignItems: 'center',
          overflow: 'hidden',
          minHeight: 0,
          boxSizing: 'border-box',
        }}
      >
        {/* ========================================================================= */}
        {/* LEFT COLUMN: LARGE LUCKY WHEEL CANVAS */}
        {/* ========================================================================= */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            height: '100%',
            maxHeight: 'calc(100vh - 80px)',
            boxSizing: 'border-box',
          }}
        >
          {/* Top Golden Arrow Pointer */}
          <div
            style={{
              position: 'relative',
              zIndex: 20,
              marginBottom: '-26px',
              filter: 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.8))',
            }}
          >
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '20px solid transparent',
                borderRight: '20px solid transparent',
                borderTop: '36px solid #eab308',
              }}
            />
          </div>

          {/* Canvas Element */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              maxWidth: 'min(70vh, 560px)',
              aspectRatio: '1 / 1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxSizing: 'border-box',
            }}
          >
            <canvas
              ref={canvasRef}
              style={{
                width: '100%',
                height: '100%',
                display: 'block',
                borderRadius: '50%',
                boxShadow: '0 0 45px rgba(234, 179, 8, 0.3)',
              }}
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* RIGHT COLUMN: PRIZE / WINNER / ADAPTIVE LEGEND / COMPACT HALL OF FAME */}
        {/* ========================================================================= */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            height: '100%',
            maxHeight: 'calc(100vh - 80px)',
            justifyContent: 'space-between',
            overflowY: 'auto',
            padding: '2px 4px 2px 2px',
            boxSizing: 'border-box',
            width: '100%',
          }}
        >
          {/* 1. Winner Reveal Celebration Banner (Box-Sizing Safe, Full Visible Borders on All 4 Sides) */}
          {revealedWinner && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.25) 0%, rgba(202, 138, 4, 0.35) 100%)',
                border: '2px solid #facc15',
                borderRadius: '12px',
                padding: '12px 16px',
                textAlign: 'center',
                boxShadow: '0 0 25px rgba(234, 179, 8, 0.5)',
                animation: 'winnerPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                boxSizing: 'border-box',
                width: '100%',
                margin: '0',
                overflow: 'hidden',
                wordBreak: 'break-word',
              }}
            >
              <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#fef08a', textTransform: 'uppercase', letterSpacing: '1px' }}>
                🎉 CHÚC MỪNG {revealedWinner.prizeTitle.toUpperCase()}!
              </div>
              <div
                style={{
                  fontSize: 'clamp(1.3rem, 2.2vw, 1.85rem)',
                  fontWeight: 900,
                  color: '#ffffff',
                  margin: '4px 0',
                  textShadow: '0 2px 10px rgba(0, 0, 0, 0.8)',
                  lineHeight: 1.25,
                }}
              >
                {revealedWinner.name}
                {revealedWinner.disambiguator && (
                  <span style={{ fontSize: '0.85rem', color: '#fef08a', marginLeft: '6px', fontWeight: 700 }}>
                    ({revealedWinner.disambiguator})
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                Đóng góp hợp lệ: <strong style={{ color: '#86efac' }}>{formatVND(revealedWinner.weight)}</strong>
              </div>
            </div>
          )}

          {/* 2. Adaptive Participants Legend (Sorted by Highest Win Probability Descending) */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: 0,
              boxSizing: 'border-box',
              width: '100%',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                DANH SÁCH THAM GIA ({segments.length} THÀNH VIÊN)
              </span>
              <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 600 }}>
                Tổng quỹ quay: {formatVND(wheelState?.totalEligibleWeight || 0)}
              </span>
            </div>

            {/* 2-Column Responsive Grid of Members (Sorted by Probability Descending) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: segments.length > 8 ? 'repeat(2, 1fr)' : '1fr',
                gap: '6px 10px',
                overflowY: 'auto',
                paddingRight: '2px',
                maxHeight: isPresentationMode ? '32vh' : '260px',
                boxSizing: 'border-box',
              }}
            >
              {segments.map((seg, idx) => (
                <div
                  key={seg.memberId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '5px 8px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    fontSize: '0.8rem',
                    boxSizing: 'border-box',
                    gap: '8px',
                  }}
                >
                  {/* Left: Number badge + Full Name */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '7px', overflow: 'hidden', minWidth: 0 }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '20px',
                        height: '20px',
                        borderRadius: '5px',
                        background: SEGMENT_COLORS[idx % SEGMENT_COLORS.length],
                        color: '#ffffff',
                        fontSize: '0.7rem',
                        fontWeight: 900,
                        textAlign: 'center',
                        lineHeight: '20px',
                        flexShrink: 0,
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <span
                      style={{
                        fontWeight: 600,
                        color: '#ffffff',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={`${seg.fullName}${seg.disambiguator ? ` (${seg.disambiguator})` : ''}`}
                    >
                      {seg.fullName}
                      {seg.disambiguator && (
                        <span style={{ color: '#fef08a', fontSize: '0.72rem', marginLeft: '3px' }}>
                          ({seg.disambiguator})
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Right: Contribution Amount + Win Probability % */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, textAlign: 'right' }}>
                    <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                      {formatVND(seg.weight)}
                    </span>
                    <span
                      style={{
                        color: '#86efac',
                        fontWeight: 800,
                        fontSize: '0.82rem',
                        minWidth: '50px',
                        textAlign: 'right',
                      }}
                    >
                      {seg.probabilityDisplay}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3. Completed Prizes / Hall of Fame (Compact 3 Cards in 1 Row) */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.75)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '10px 14px',
              boxSizing: 'border-box',
              width: '100%',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.5px' }}>
              🏆 KẾT QUẢ CÁC HẠNG MỤC
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', boxSizing: 'border-box' }}>
              {/* Prize 1: Giải Ba */}
              {(() => {
                const draw = (wheelState?.completedPrizes || []).find((p) => p.prizeId === 'giai-ba');
                return (
                  <div
                    style={{
                      background: draw ? 'rgba(202, 138, 4, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${draw ? '#ca8a04' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: '8px',
                      padding: '8px',
                      textAlign: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fef08a' }}>🥉 GIẢI BA</div>
                    {draw ? (
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {draw.winnerName}
                        </div>
                        {draw.winnerDisambiguator && (
                          <div style={{ fontSize: '0.7rem', color: '#fef08a' }}>({draw.winnerDisambiguator})</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>Chưa quay</div>
                    )}
                  </div>
                );
              })()}

              {/* Prize 2: Giải Nhì */}
              {(() => {
                const draw = (wheelState?.completedPrizes || []).find((p) => p.prizeId === 'giai-nhi');
                return (
                  <div
                    style={{
                      background: draw ? 'rgba(148, 163, 184, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${draw ? '#94a3b8' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: '8px',
                      padding: '8px',
                      textAlign: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#e2e8f0' }}>🥈 GIẢI NHÌ</div>
                    {draw ? (
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {draw.winnerName}
                        </div>
                        {draw.winnerDisambiguator && (
                          <div style={{ fontSize: '0.7rem', color: '#fef08a' }}>({draw.winnerDisambiguator})</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>Chưa quay</div>
                    )}
                  </div>
                );
              })()}

              {/* Prize 3: Giải Nhất */}
              {(() => {
                const draw = (wheelState?.completedPrizes || []).find((p) => p.prizeId === 'giai-nhat');
                return (
                  <div
                    style={{
                      background: draw ? 'rgba(234, 179, 8, 0.25)' : 'rgba(255, 255, 255, 0.03)',
                      border: `1px solid ${draw ? '#facc15' : 'rgba(255, 255, 255, 0.08)'}`,
                      borderRadius: '8px',
                      padding: '8px',
                      textAlign: 'center',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#fbbf24' }}>🥇 GIẢI NHẤT</div>
                    {draw ? (
                      <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {draw.winnerName}
                        </div>
                        {draw.winnerDisambiguator && (
                          <div style={{ fontSize: '0.7rem', color: '#fef08a' }}>({draw.winnerDisambiguator})</div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px' }}>Chưa quay</div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal: Official Admin Lottery Reset */}
      {showResetModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1200,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '1px solid #ef4444',
              borderRadius: '16px',
              padding: '24px',
              maxWidth: '460px',
              width: '100%',
              textAlign: 'center',
              boxShadow: '0 10px 40px rgba(239, 68, 68, 0.3)',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>⚠️</div>
            <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fca5a5', margin: '0 0 10px 0' }}>
              Xác Nhận Đặt Lại Kết Quả Vòng Quay
            </h2>
            <p style={{ fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '20px' }}>
              Hành động này sẽ xóa toàn bộ kết quả của <strong>Giải Ba, Giải Nhì và Giải Nhất</strong> để bắt đầu quay lại từ đầu. Toàn bộ tiền đóng góp, tỷ lệ thành viên và nhạc nền vẫn được giữ nguyên.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  padding: '10px 20px',
                  borderRadius: '10px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={handleResetLottery}
                disabled={resetting}
                style={{
                  background: '#dc2626',
                  border: 'none',
                  color: '#ffffff',
                  padding: '10px 24px',
                  borderRadius: '10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 0 15px rgba(220, 38, 38, 0.5)',
                }}
              >
                {resetting ? 'Đang đặt lại...' : 'Xác nhận Đặt lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
