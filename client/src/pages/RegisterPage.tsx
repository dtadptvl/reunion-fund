import React, { useState, useEffect } from 'react';

interface RegisterPageProps {
  onRegisterSuccess: (email: string) => void;
  onGoToLogin: () => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({ onRegisterSuccess, onGoToLogin }) => {
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [searchMember, setSearchMember] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/v1/public/members')
      .then((res) => res.json())
      .then((data) => {
        setMembers(data.members || []);
        setLoadingMembers(false);
      })
      .catch((err) => {
        console.error('Lỗi tải danh sách thành viên:', err);
        setLoadingMembers(false);
      });
  }, []);

  const filteredMembers = members.filter((m) => {
    if (!searchMember.trim()) return true;
    const q = searchMember.toLowerCase();
    return (
      m.full_name.toLowerCase().includes(q) ||
      m.normalized_name.toLowerCase().includes(q) ||
      (m.disambiguator && m.disambiguator.toLowerCase().includes(q))
    );
  });

  const selectedMember = members.find((m) => m.id === selectedMemberId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedMemberId) {
      setError('Vui lòng chọn tên của bạn trong danh sách lớp.');
      return;
    }

    if (!username.trim() || username.trim().length < 3) {
      setError('Tên đăng nhập phải có ít nhất 3 ký tự.');
      return;
    }

    if (!email.trim() || !email.includes('@')) {
      setError('Vui lòng nhập địa chỉ email hợp lệ.');
      return;
    }

    if (password.length < 6) {
      setError('Mật khẩu phải có độ dài tối thiểu 6 ký tự.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: selectedMemberId,
          username: username.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Đăng ký thất bại. Vui lòng thử lại.');
      } else {
        onRegisterSuccess(email.trim().toLowerCase());
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ. Vui lòng kiểm tra lại đường truyền.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '520px', margin: '40px auto' }}>
      <div className="card">
        <div className="card-header" style={{ textAlign: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '1px' }}>
            KỶ NIỆM 10 NĂM RA TRƯỜNG
          </div>
          <h1 className="card-title" style={{ fontSize: '1.4rem', margin: '6px 0 2px 0' }}>
            Đăng Ký Tài Khoản Thành Viên
          </h1>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Lớp A1 — Khóa 48 (2013–2016) — Trường THPT Văn Lâm
          </div>
        </div>

        <div style={{ padding: '24px 0 0 0' }}>
          {error && (
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--danger-bg)',
                color: 'var(--danger-text)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '20px',
                fontSize: '0.9rem',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Step 1: Member Selection */}
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                1. Chọn tên của bạn trong danh sách lớp <span style={{ color: 'var(--danger)' }}>*</span>
              </label>

              {loadingMembers ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                  Đang tải danh sách thành viên...
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    placeholder="🔍 Gõ tên để tìm nhanh..."
                    value={searchMember}
                    onChange={(e) => setSearchMember(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      marginBottom: '8px',
                      fontSize: '0.85rem',
                    }}
                  />

                  <select
                    required
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '0.95rem',
                      background: 'var(--bg-card)',
                      color: 'var(--text-main)',
                    }}
                  >
                    <option value="">-- Bấm vào đây để chọn tên bạn --</option>
                    {filteredMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} {m.disambiguator ? `(${m.disambiguator})` : ''}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {selectedMember && (
                <div
                  style={{
                    marginTop: '8px',
                    padding: '8px 12px',
                    background: 'var(--primary-light, #eff6ff)',
                    color: 'var(--primary, #1e40af)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                  }}
                >
                  ✓ Bạn đang đăng ký tài khoản cho: {selectedMember.full_name} {selectedMember.disambiguator ? `(${selectedMember.disambiguator})` : ''}
                </div>
              )}
            </div>

            {/* Step 2: Username */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                2. Tên đăng nhập <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="text"
                required
                placeholder="VD: tuananh, nhanhoang..."
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Từ 3–30 ký tự (chữ cái, chữ số, gạch dưới).
              </div>
            </div>

            {/* Step 3: Email */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                3. Địa chỉ Email <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <input
                type="email"
                required
                placeholder="VD: emailcuaban@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Mã xác thực tài khoản sẽ được gửi đến email này.
              </div>
            </div>

            {/* Step 4: Password & Confirm Password */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  4. Mật khẩu <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Tối thiểu 6 ký tự"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Xác nhận mật khẩu <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="password"
                  required
                  placeholder="Nhập lại mật khẩu"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                />
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: 700, fontSize: '1rem' }}
              disabled={loading}
            >
              {loading ? 'Đang tạo tài khoản...' : '✨ ĐĂNG KÝ VÀ NHẬN MÃ XÁC THỰC'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Đã có tài khoản?{' '}
            <button
              type="button"
              onClick={onGoToLogin}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--primary)',
                fontWeight: 600,
                cursor: 'pointer',
                padding: '0 4px',
                textDecoration: 'underline',
              }}
            >
              Đăng nhập ngay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
