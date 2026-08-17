import React, { useEffect, useState } from 'react';

interface VotingCategory {
  id: string;
  title: string;
  description: string | null;
  display_order: number;
}

interface Member {
  id: string;
  full_name: string;
  disambiguator: string | null;
}

interface VotingPageProps {
  currentUser: any;
  onGoToLogin: () => void;
  onGoToRegister: () => void;
}

export const VotingPage: React.FC<VotingPageProps> = ({
  currentUser,
  onGoToLogin,
  onGoToRegister,
}) => {
  const [categories, setCategories] = useState<VotingCategory[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [userVotes, setUserVotes] = useState<Record<string, string>>({});
  const [isLocked, setIsLocked] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    // 1. Fetch canonical members
    fetch('/api/v1/public/members')
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []))
      .catch((err) => console.error(err));

    // 2. Fetch voting data if logged in
    if (currentUser) {
      fetch('/api/v1/auth/votes')
        .then((res) => res.json())
        .then((data) => {
          if (data.categories) setCategories(data.categories);
          if (data.userVotes) setUserVotes(data.userVotes);
          if (typeof data.isLocked === 'boolean') setIsLocked(data.isLocked);
          setLoading(false);
        })
        .catch((err) => {
          console.error(err);
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [currentUser]);

  const handleSelectCandidate = (categoryId: string, candidateMemberId: string) => {
    if (isLocked) return;
    setUserVotes((prev) => ({
      ...prev,
      [categoryId]: candidateMemberId,
    }));
  };

  const handleSaveVotes = async () => {
    if (isLocked || saving) return;
    setSaving(true);
    setMessage(null);

    const votePayload = Object.entries(userVotes)
      .filter(([_, candidateId]) => Boolean(candidateId))
      .map(([categoryId, candidateMemberId]) => ({
        categoryId,
        candidateMemberId,
      }));

    if (votePayload.length === 0) {
      setMessage({ text: 'Vui lòng chọn ít nhất một thành viên để bình chọn.', type: 'error' });
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/votes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ votes: votePayload }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Không thể lưu bình chọn.');
      }

      setUserVotes(data.votes || userVotes);
      setMessage({ text: 'Đã lưu phiếu bình chọn của bạn thành công!', type: 'success' });
    } catch (err: any) {
      setMessage({ text: err.message || 'Lỗi khi lưu bình chọn.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const getMemberDisplayName = (m: Member) =>
    `${m.full_name}${m.disambiguator ? ` (${m.disambiguator})` : ''}`;

  if (loading) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '60px' }}>
        <p>Đang tải thông tin bình chọn...</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* HEADER BANNER */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, #1e3a8a 0%, #1e1b4b 100%)',
          color: '#ffffff',
          padding: '24px',
          borderRadius: '12px',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
        }}
      >
        <div style={{ display: 'inline-block', background: 'rgba(255, 255, 255, 0.15)', padding: '4px 12px', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.5px', marginBottom: '8px' }}>
          🏆 BÌNH CHỌN TRAO GIẢI KỶ NIỆM 10 NĂM
        </div>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '1.6rem', fontWeight: 800, color: '#fef08a' }}>
          Bình Chọn Các Hạng Mục Danh Dự
        </h1>
        <p style={{ margin: 0, fontSize: '0.95rem', opacity: 0.9, lineHeight: 1.5 }}>
          Mỗi thành viên lớp được bình chọn <strong>1 phiếu cho mỗi hạng mục</strong>. Bạn có thể thay đổi lựa chọn trước khi Ban Quản trị khóa cổng bình chọn.
        </p>
      </div>

      {/* LOCK STATUS BANNER */}
      {isLocked ? (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '14px 18px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontWeight: 600,
          }}
        >
          <span>🔒</span>
          <span>Ban Quản trị đã khóa cổng bình chọn để tổng kết kết quả. Các lựa chọn hiện tại đã được chốt.</span>
        </div>
      ) : (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#166534',
            padding: '12px 18px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '0.9rem',
          }}
        >
          <span>✨</span>
          <span>Cổng bình chọn đang mở. Vui lòng chọn thành viên bạn muốn vinh danh ở 3 hạng mục bên dưới.</span>
        </div>
      )}

      {/* FEEDBACK MESSAGE */}
      {message && (
        <div
          style={{
            padding: '12px 16px',
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

      {/* UNAUTHENTICATED CALL TO ACTION */}
      {!currentUser ? (
        <div className="card" style={{ textAlign: 'center', padding: '32px 20px' }}>
          <h2 style={{ fontSize: '1.2rem', margin: '0 0 10px 0', color: 'var(--text-main)' }}>
            Đăng nhập để tham gia bình chọn
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '20px' }}>
            Chỉ thành viên có tài khoản liên kết với danh sách lớp A1 mới có quyền bình chọn.
          </p>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={onGoToLogin}>
              Đăng nhập ngay
            </button>
            <button className="btn btn-outline" onClick={onGoToRegister}>
              Đăng ký tài khoản
            </button>
          </div>
        </div>
      ) : (
        /* VOTING FORM FOR LOGGED-IN USERS */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {categories.map((cat, index) => {
            const selectedMemberId = userVotes[cat.id] || '';
            const selectedMember = members.find((m) => m.id === selectedMemberId);

            return (
              <div key={cat.id} className="card" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                  <div>
                    <span
                      style={{
                        background: 'var(--primary-light, #eff6ff)',
                        color: 'var(--primary, #1e40af)',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        display: 'inline-block',
                        marginBottom: '4px',
                      }}
                    >
                      Hạng mục {index + 1}
                    </span>
                    <h2 style={{ margin: '0 0 4px 0', fontSize: '1.2rem', color: 'var(--text-main)' }}>
                      {cat.title}
                    </h2>
                    {cat.description && (
                      <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                        {cat.description}
                      </p>
                    )}
                  </div>

                  {selectedMember && (
                    <span className="badge badge-success" style={{ fontSize: '0.85rem', padding: '6px 12px' }}>
                      ✓ Đã chọn: {getMemberDisplayName(selectedMember)}
                    </span>
                  )}
                </div>

                {/* Candidate Selection */}
                <div style={{ marginTop: '14px' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '6px' }}>
                    Chọn 1 thành viên từ danh sách lớp:
                  </label>

                  <select
                    className="form-input"
                    value={selectedMemberId}
                    disabled={isLocked}
                    onChange={(e) => handleSelectCandidate(cat.id, e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: selectedMemberId ? '2px solid var(--primary, #2563eb)' : '1px solid var(--border-color)',
                      fontSize: '0.95rem',
                      fontWeight: selectedMemberId ? 600 : 400,
                      background: isLocked ? '#f8fafc' : '#ffffff',
                    }}
                  >
                    <option value="">-- Chọn thành viên lớp A1 --</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {getMemberDisplayName(m)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}

          {/* SAVE BUTTON */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={handleSaveVotes}
              disabled={isLocked || saving}
              style={{
                padding: '12px 32px',
                fontSize: '1rem',
                fontWeight: 700,
                borderRadius: '8px',
                cursor: isLocked ? 'not-allowed' : 'pointer',
                opacity: isLocked ? 0.6 : 1,
              }}
            >
              {saving ? 'Đang lưu...' : '💾 Lưu Phiếu Bình Chọn'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
