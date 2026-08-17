import React, { useState, useEffect } from 'react';

interface AwardPresentationItem {
  categoryId: string;
  title: string;
  description: string | null;
  displayOrder: number;
  winner: {
    memberId: string;
    fullName: string;
    disambiguator: string | null;
    voteCount?: number;
  } | null;
}

interface AwardPresentationPageProps {
  onExit: () => void;
}

export const AwardPresentationPage: React.FC<AwardPresentationPageProps> = ({ onExit }) => {
  const [awards, setAwards] = useState<AwardPresentationItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/v1/admin/voting/presentation')
      .then((res) => {
        if (!res.ok) throw new Error('Không thể tải dữ liệu trình chiếu');
        return res.json();
      })
      .then((data) => {
        setAwards(data.awards || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const currentAward = awards[currentIndex];

  const handleNext = () => {
    if (currentIndex < awards.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setIsRevealed(false);
    }
  };

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setIsRevealed(false);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => console.error(err));
    } else {
      document.exitFullscreen().catch((err) => console.error(err));
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#ffffff' }}>
        <h2>Đang chuẩn bị sân khấu trao giải...</h2>
      </div>
    );
  }

  if (awards.length === 0) {
    return (
      <div style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#090d16', color: '#ffffff', gap: '20px' }}>
        <h2>Chưa có dữ liệu hạng mục trao giải</h2>
        <button className="btn btn-outline" onClick={onExit} style={{ color: '#ffffff', borderColor: '#ffffff' }}>
          Quay lại Quản trị
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '85vh',
        background: 'radial-gradient(ellipse at top, #1e1b4b 0%, #090d16 100%)',
        color: '#ffffff',
        borderRadius: '16px',
        padding: '30px 20px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        alignItems: 'center',
        position: 'relative',
        boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
        textAlign: 'center',
      }}
    >
      {/* TOP NAVIGATION BAR */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '16px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <button
          onClick={onExit}
          className="btn btn-outline"
          style={{
            color: '#cbd5e1',
            borderColor: 'rgba(255,255,255,0.2)',
            fontSize: '0.85rem',
            padding: '6px 14px',
          }}
        >
          ✕ Thoát Trình Chiếu
        </button>

        <div style={{ fontSize: '0.9rem', color: '#94a3b8', fontWeight: 600 }}>
          Hạng mục {currentIndex + 1} / {awards.length}
        </div>

        <button
          onClick={toggleFullscreen}
          className="btn btn-outline"
          style={{
            color: '#cbd5e1',
            borderColor: 'rgba(255,255,255,0.2)',
            fontSize: '0.85rem',
            padding: '6px 14px',
          }}
        >
          ⛶ Toàn Màn Hình
        </button>
      </div>

      {/* CENTER CEREMONY STAGE */}
      <div
        style={{
          margin: 'auto 0',
          maxWidth: '900px',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
        }}
      >
        {/* EVENT TITLE */}
        <div
          style={{
            fontSize: '1rem',
            letterSpacing: '3px',
            textTransform: 'uppercase',
            color: '#fbbf24',
            fontWeight: 700,
          }}
        >
          KỶ NIỆM 10 NĂM RA TRƯỜNG • LỚP A1 (2013–2016)
        </div>

        {/* AWARD CATEGORY TITLE */}
        <h1
          style={{
            fontSize: 'clamp(2rem, 5vw, 3.2rem)',
            fontWeight: 900,
            margin: 0,
            lineHeight: 1.2,
            background: 'linear-gradient(135deg, #ffffff 0%, #fef08a 50%, #eab308 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            textShadow: '0 4px 20px rgba(234, 179, 8, 0.3)',
          }}
        >
          {currentAward.title}
        </h1>

        {currentAward.description && (
          <p
            style={{
              fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
              color: '#94a3b8',
              margin: '0 auto',
              maxWidth: '650px',
            }}
          >
            {currentAward.description}
          </p>
        )}

        {/* REVEAL CARD */}
        <div
          style={{
            marginTop: '20px',
            minHeight: '180px',
            width: '100%',
            maxWidth: '600px',
            background: isRevealed
              ? 'linear-gradient(135deg, rgba(234, 179, 8, 0.15) 0%, rgba(202, 138, 4, 0.25) 100%)'
              : 'rgba(255, 255, 255, 0.05)',
            border: isRevealed ? '2px solid #facc15' : '1px dashed rgba(255, 255, 255, 0.2)',
            borderRadius: '20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '30px',
            transition: 'all 0.5s ease',
            boxShadow: isRevealed ? '0 0 50px rgba(234, 179, 8, 0.4)' : 'none',
          }}
        >
          {!isRevealed ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
              <div style={{ fontSize: '3rem' }}>🎁</div>
              <div style={{ fontSize: '1.2rem', color: '#cbd5e1', fontWeight: 600 }}>
                Người đạt giải thưởng danh dự
              </div>
              <button
                onClick={() => setIsRevealed(true)}
                style={{
                  background: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '30px',
                  padding: '14px 40px',
                  fontSize: '1.2rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 20px rgba(234, 179, 8, 0.4)',
                  transform: 'scale(1)',
                  transition: 'transform 0.2s ease',
                }}
                onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
                onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                ✨ CÔNG BỐ NGƯỜI CHIẾN THẮNG
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  fontSize: '0.9rem',
                  textTransform: 'uppercase',
                  letterSpacing: '2px',
                  color: '#facc15',
                  fontWeight: 700,
                }}
              >
                👑 VINH DANH NGƯỜI CHIẾN THẮNG
              </div>
              <div
                style={{
                  fontSize: 'clamp(2.2rem, 6vw, 3.5rem)',
                  fontWeight: 900,
                  color: '#ffffff',
                  textShadow: '0 2px 30px rgba(255, 255, 255, 0.8)',
                  animation: 'fadeInUp 0.6s ease',
                }}
              >
                {currentAward.winner ? currentAward.winner.fullName : 'Chưa xác định'}
                {currentAward.winner?.disambiguator && (
                  <span style={{ fontSize: '1.5rem', opacity: 0.8, marginLeft: '8px' }}>
                    ({currentAward.winner.disambiguator})
                  </span>
                )}
              </div>

              {currentAward.winner && typeof currentAward.winner.voteCount === 'number' && (
                <div
                  style={{
                    background: 'rgba(234, 179, 8, 0.25)',
                    border: '1px solid #facc15',
                    borderRadius: '20px',
                    padding: '6px 20px',
                    fontSize: '1.25rem',
                    fontWeight: 800,
                    color: '#fef08a',
                    marginTop: '6px',
                    animation: 'fadeInUp 0.8s ease',
                  }}
                >
                  🎉 {currentAward.winner.voteCount} phiếu bình chọn
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM NAVIGATION CONTROLS */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: '20px',
          borderTop: '1px solid rgba(255,255,255,0.1)',
        }}
      >
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="btn btn-outline"
          style={{
            color: '#ffffff',
            borderColor: 'rgba(255,255,255,0.3)',
            opacity: currentIndex === 0 ? 0.3 : 1,
            cursor: currentIndex === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          ← Hạng mục trước
        </button>

        <div style={{ display: 'flex', gap: '8px' }}>
          {awards.map((_, idx) => (
            <div
              key={idx}
              style={{
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                background: idx === currentIndex ? '#eab308' : 'rgba(255,255,255,0.2)',
                transition: 'background 0.3s ease',
              }}
            />
          ))}
        </div>

        {currentIndex < awards.length - 1 ? (
          <button
            onClick={handleNext}
            className="btn btn-primary"
            style={{
              background: '#2563eb',
              color: '#ffffff',
              fontWeight: 700,
              padding: '10px 24px',
            }}
          >
            Hạng mục tiếp theo →
          </button>
        ) : (
          <button
            onClick={onExit}
            className="btn btn-primary"
            style={{
              background: '#16a34a',
              color: '#ffffff',
              fontWeight: 700,
              padding: '10px 24px',
            }}
          >
            ✓ Hoàn tất trao giải
          </button>
        )}
      </div>
    </div>
  );
};
