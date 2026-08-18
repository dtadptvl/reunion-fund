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

  // Presentation Mode State
  const [isPresentationMode, setIsPresentationMode] = useState<boolean>(false);
  const [showStartOverlay, setShowStartOverlay] = useState<boolean>(true);

  // Admin draw trigger & reset state
  const [triggering, setTriggering] = useState<boolean>(false);
  const [resetting, setResetting] = useState<boolean>(false);
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
        setLoading(false);
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
        } else {
          // If no active draw (e.g. after reset)
          setRevealedWinner(null);
          setIsSpinningLocal(false);
          lastActiveDrawStartedAt.current = null;
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

  // Sync fullscreen change with presentation state
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isPresentationMode) {
        // user pressed ESC to exit fullscreen
        setIsPresentationMode(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, [isPresentationMode]);

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

  // Presentation Start: Native Audio Play + Enter Fullscreen Mode
  const handleStartPresentation = () => {
    setShowStartOverlay(false);
    setIsPresentationMode(true);

    if (audioRef.current && wheelState?.hasBackgroundMusic) {
      audioRef.current.play().then(() => {
        setMusicPlaying(true);
      }).catch((e) => {
        console.warn('Audio playback not started:', e);
      });
    }

    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  // Toggle Audio Play/Pause
  const handleToggleMusic = () => {
    if (!audioRef.current) return;
    if (musicPlaying) {
      audioRef.current.pause();
      setMusicPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setMusicPlaying(true);
      }).catch(() => {});
    }
  };

  // Toggle Audio Mute
  const handleToggleMute = () => {
    if (!audioRef.current) return;
    audioRef.current.muted = !audioRef.current.muted;
    setMusicMuted(audioRef.current.muted);
  };

  // Toggle Fullscreen / Presentation Mode
  const togglePresentation = () => {
    if (!isPresentationMode) {
      setIsPresentationMode(true);
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      setIsPresentationMode(false);
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  };

  // Admin Trigger Draw
  const handleTriggerDraw = async (prizeId: string) => {
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

      await fetchWheelState();
    } catch (err: any) {
      setAdminMessage({ text: err.message || 'Lỗi khi kích hoạt quay thưởng.', type: 'error' });
    } finally {
      setTriggering(false);
    }
  };

  // Admin Staging Reset
  const handleResetLottery = async () => {
    const confirmed = window.confirm(
      '⚠️ XÁC NHẬN ĐẶT LẠI KẾT QUẢ QUAY THỬ?\n\nToàn bộ kết quả Giải Ba, Giải Nhì, Giải Nhất sẽ bị xóa để kiểm thử lại từ đầu. Danh sách đóng góp và quỹ lớp hoàn toàn không bị ảnh hưởng.'
    );
    if (!confirmed) return;

    setResetting(true);
    setAdminMessage(null);

    try {
      const res = await fetch('/api/v1/admin/lottery/reset', { method: 'POST' });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Không thể đặt lại kết quả.');
      }

      setCurrentRotation(0);
      setRevealedWinner(null);
      setIsSpinningLocal(false);
      lastActiveDrawStartedAt.current = null;
      setAdminMessage({ text: 'Đã đặt lại kết quả quay thử thành công! Bắt đầu lại từ Giải Ba.', type: 'success' });
      await fetchWheelState();
    } catch (err: any) {
      setAdminMessage({ text: err.message || 'Lỗi khi đặt lại kết quả.', type: 'error' });
    } finally {
      setResetting(false);
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

  const isAdmin = currentUser?.role === 'ADMIN';
  const completedCount = wheelState?.completedPrizes?.length || 0;
  const isCompletedAll = completedCount >= 3 || (!wheelState?.nextPrize && completedCount > 0);

  // Active prize title resolution
  const activePrizeTitle = isSpinningLocal
    ? (wheelState?.activeDraw?.prizeTitle || wheelState?.nextPrize?.prizeTitle || 'Hạng Mục Quay Thưởng')
    : wheelState?.nextPrize
    ? wheelState.nextPrize.prizeTitle
    : 'Chương Trình Quay Thưởng';

  // Completed prizes display list: hide current spinning prize until revealed
  const displayedCompletedPrizes = (wheelState?.completedPrizes || []).filter((p) => {
    if (isSpinningLocal && wheelState?.activeDraw?.prizeId === p.prizeId) {
      return false; // Hide from history while animation is running
    }
    return true;
  });

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
            Chào mừng bạn đến với chương trình quay số tri ân tập thể lớp A1. Nhấn nút bên dưới để bắt đầu giao diện trình chiếu sân khấu (16:9) và tự động phát nhạc nền gala.
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
          maxWidth: '1500px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '10px',
          paddingBottom: '8px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          marginBottom: '10px',
          flexShrink: 0,
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

        {/* Center: Stage Status & Prize Title */}
        <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isSpinningLocal ? (
            <span
              style={{
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.95rem',
                padding: '4px 16px',
                borderRadius: '20px',
                animation: 'pulse 1.2s infinite ease-in-out',
                boxShadow: '0 0 15px rgba(239, 68, 68, 0.6)',
              }}
            >
              ⏳ ĐANG QUAY {activePrizeTitle.toUpperCase()}...
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
              ✓ ĐÃ HOÀN TẤT QUAY THƯỞNG
            </span>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ color: '#fbbf24', fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px' }}>
                HẠNG MỤC TIẾP THEO:
              </span>
              <strong style={{ fontSize: '1.05rem', color: '#ffffff', fontWeight: 800 }}>
                {activePrizeTitle}
              </strong>
              {wheelState?.nextPrize && (
                <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                  ({wheelState.nextPrize.durationSeconds}s)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Controls: Audio + Fullscreen + Admin Trigger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Admin Draw Action (Compact) */}
          {isAdmin && wheelState?.nextPrize && (
            <button
              onClick={() => handleTriggerDraw(wheelState.nextPrize!.prizeId)}
              disabled={triggering || isSpinningLocal}
              style={{
                background: isSpinningLocal ? '#475569' : 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '0.85rem',
                padding: '6px 16px',
                borderRadius: '20px',
                border: '1px solid #60a5fa',
                cursor: isSpinningLocal ? 'not-allowed' : 'pointer',
                boxShadow: isSpinningLocal ? 'none' : '0 0 15px rgba(37, 99, 235, 0.5)',
              }}
            >
              {triggering ? 'Đang kích hoạt...' : `🎯 Quay ${wheelState.nextPrize.prizeTitle}`}
            </button>
          )}

          {/* Staging Reset Button */}
          {isAdmin && wheelState?.allowTestReset && (
            <button
              onClick={handleResetLottery}
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
              title="Đặt lại kết quả quay thử"
            >
              {resetting ? 'Đang đặt lại...' : '🔄 Đặt lại'}
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
              >
                {musicPlaying ? '⏸ Tạm dừng' : '▶ Phát nhạc'}
              </button>

              <button
                onClick={handleToggleMute}
                style={{
                  background: 'rgba(255, 255, 255, 0.1)',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
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
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic' }}>
              🔇 Nhạc nền chưa khả dụng
            </span>
          )}

          {/* Fullscreen / Toggle Presentation */}
          <button
            onClick={togglePresentation}
            style={{
              background: isPresentationMode ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255, 255, 255, 0.1)',
              border: `1px solid ${isPresentationMode ? '#eab308' : 'rgba(255, 255, 255, 0.2)'}`,
              color: isPresentationMode ? '#fef08a' : '#ffffff',
              padding: '5px 12px',
              borderRadius: '16px',
              fontSize: '0.8rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isPresentationMode ? '✕ Thu nhỏ' : '🎬 Trình chiếu'}
          </button>
        </div>
      </div>

      {adminMessage && (
        <div style={{ fontSize: '0.85rem', color: adminMessage.type === 'success' ? '#86efac' : '#fca5a5', fontWeight: 600, marginBottom: '6px' }}>
          {adminMessage.text}
        </div>
      )}

      {/* MAIN STAGE (LANDSCAPE 2-COLUMN COMPOSITION) */}
      <div
        style={{
          width: '100%',
          maxWidth: '1500px',
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: isPresentationMode ? 'minmax(340px, 1fr) minmax(380px, 1.15fr)' : 'repeat(auto-fit, minmax(340px, 1fr))',
          gap: '20px',
          alignItems: 'center',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        {/* LEFT COLUMN: LARGE LUCKY WHEEL */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            height: '100%',
            maxHeight: isPresentationMode ? 'calc(100vh - 90px)' : 'auto',
          }}
        >
          {/* Top Pointer Arrow */}
          <div
            style={{
              position: 'absolute',
              top: '-12px',
              zIndex: 30,
              width: 0,
              height: 0,
              borderLeft: '18px solid transparent',
              borderRight: '18px solid transparent',
              borderTop: '34px solid #ef4444',
              filter: 'drop-shadow(0 4px 10px rgba(0, 0, 0, 0.9))',
            }}
          />

          <div
            style={{
              width: isPresentationMode ? 'min(66vh, 500px)' : 'min(88vw, 460px)',
              height: isPresentationMode ? 'min(66vh, 500px)' : 'min(88vw, 460px)',
              aspectRatio: '1/1',
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
                  ? '0 0 50px rgba(234, 179, 8, 0.6), 0 0 80px rgba(59, 130, 246, 0.3)'
                  : '0 8px 35px rgba(0, 0, 0, 0.6)',
                transition: isSpinningLocal ? 'none' : 'box-shadow 0.4s ease',
              }}
            />
          </div>
        </div>

        {/* RIGHT COLUMN: REVEAL + PARTICIPANTS + HALL OF FAME */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            height: '100%',
            maxHeight: isPresentationMode ? 'calc(100vh - 90px)' : 'auto',
            justifyContent: 'space-between',
            overflow: 'hidden',
          }}
        >
          {/* 1. WINNER REVEAL CELEBRATION (IF REVEALED) */}
          {revealedWinner && !isSpinningLocal && (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(234, 179, 8, 0.22) 0%, rgba(202, 138, 4, 0.38) 100%)',
                border: '2px solid #facc15',
                borderRadius: '14px',
                padding: '12px 18px',
                textAlign: 'center',
                boxShadow: '0 0 35px rgba(234, 179, 8, 0.5)',
                animation: 'fadeInUp 0.5s ease',
                flexShrink: 0,
              }}
            >
              <div style={{ fontSize: '0.85rem', color: '#fef08a', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase' }}>
                🎉 CHÚC MỪNG CHIẾN THẮNG {revealedWinner.prizeTitle.toUpperCase()} 🎉
              </div>
              <div
                style={{
                  fontSize: 'clamp(1.6rem, 3.2vw, 2.4rem)',
                  fontWeight: 900,
                  color: '#ffffff',
                  margin: '4px 0',
                  textShadow: '0 2px 20px rgba(255, 255, 255, 0.85)',
                }}
              >
                {revealedWinner.name}
                {revealedWinner.disambiguator && (
                  <span style={{ fontSize: '1.1rem', opacity: 0.85, marginLeft: '6px' }}>
                    ({revealedWinner.disambiguator})
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#fef08a', fontWeight: 700 }}>
                Mức đóng góp hợp lệ: <strong>{revealedWinner.weight.toLocaleString('vi-VN')} đ</strong>
              </div>
            </div>
          )}

          {/* 2. ELIGIBLE MEMBERS LEGEND & LIVE STATS */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '12px 16px',
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              minHeight: '120px',
              maxHeight: isPresentationMode
                ? (revealedWinner ? '22vh' : '36vh')
                : '300px',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexShrink: 0 }}>
              <h2 style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fef08a', margin: 0 }}>
                📋 THÀNH VIÊN THAM GIA ({wheelState?.wheelSegments.length || 0})
              </h2>
              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                Tổng: {wheelState?.totalEligibleWeight.toLocaleString('vi-VN')} đ
              </span>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, paddingRight: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {wheelState?.wheelSegments.map((seg, idx) => {
                const swatchColor = SEGMENT_COLORS[idx % SEGMENT_COLORS.length];
                return (
                  <div
                    key={seg.memberId}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: swatchColor, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600 }}>
                        {seg.fullName}
                        {seg.disambiguator && (
                          <span style={{ opacity: 0.7, fontSize: '0.75rem', marginLeft: '4px' }}>
                            ({seg.disambiguator})
                          </span>
                        )}
                      </span>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontWeight: 800, color: '#fef08a', marginRight: '8px' }}>
                        {seg.probabilityDisplay}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                        {seg.weight.toLocaleString('vi-VN')} đ
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. COMPLETED PRIZES RESULTS (3 CARDS SIDE BY SIDE) */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '12px',
              padding: '12px 16px',
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fef08a', marginBottom: '8px' }}>
              🏆 BẢNG VINH DANH TRÚNG THƯỞNG
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              {renderPrizeCard('Giải Ba', 'giai-ba', displayedCompletedPrizes)}
              {renderPrizeCard('Giải Nhì', 'giai-nhi', displayedCompletedPrizes)}
              {renderPrizeCard('Giải Nhất', 'giai-nhat', displayedCompletedPrizes)}
            </div>
          </div>
        </div>
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
        background: winner ? 'rgba(234, 179, 8, 0.12)' : 'rgba(0, 0, 0, 0.3)',
        border: winner ? '1px solid #eab308' : '1px dashed rgba(255, 255, 255, 0.15)',
        borderRadius: '8px',
        padding: '8px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#facc15', textTransform: 'uppercase' }}>
          {title}
        </span>
        {winner ? (
          <span style={{ fontSize: '0.68rem', background: '#166534', color: '#bbf7d0', padding: '1px 6px', borderRadius: '8px', fontWeight: 600 }}>
            ✓ Đã có
          </span>
        ) : (
          <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
            Chưa quay
          </span>
        )}
      </div>

      {winner ? (
        <>
          <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            👑 {winner.winnerName}
            {winner.winnerDisambiguator && (
              <span style={{ fontSize: '0.75rem', opacity: 0.8, marginLeft: '3px' }}>
                ({winner.winnerDisambiguator})
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
            <strong style={{ color: '#fef08a' }}>{winner.winnerWeight.toLocaleString('vi-VN')} đ</strong>
          </div>
        </>
      ) : (
        <div style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic', padding: '4px 0' }}>
          Đang chờ...
        </div>
      )}
    </div>
  );
}
