import React, { useState, useEffect, useRef } from 'react';

interface RegisterPageProps {
  onRegisterSuccess: (email: string) => void;
  onGoToLogin: () => void;
  onGoToGuestContribute?: (guestName: string) => void;
}

export const RegisterPage: React.FC<RegisterPageProps> = ({
  onRegisterSuccess,
  onGoToLogin,
  onGoToGuestContribute,
}) => {
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Guest flow when "Không có tên trong danh sách" is selected
  const [isGuestMode, setIsGuestMode] = useState(false);
  const [guestName, setGuestName] = useState('');

  // Member Registration fields
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [error, setError] = useState('');

  const autocompleteRef = useRef<HTMLDivElement>(null);

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

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const removeDiacritics = (str: string) =>
    str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase();

  const getMemberDisplayName = (m: any) =>
    m ? `${m.full_name}${m.disambiguator ? ` (${m.disambiguator})` : ''}` : '';

  const filteredMembers = members.filter((m) => {
    if (!searchQuery.trim()) return true;
    const displayName = getMemberDisplayName(m);
    const q = searchQuery.trim();
    return (
      displayName.toLowerCase().includes(q.toLowerCase()) ||
      removeDiacritics(displayName).includes(removeDiacritics(q))
    );
  });

  const handleSelectMember = (memberId: string) => {
    setSelectedMemberId(memberId);
    setIsGuestMode(false);
    setShowSuggestions(false);
    setError('');
    const m = members.find((x) => x.id === memberId);
    if (m) {
      setSearchQuery(getMemberDisplayName(m));
    }
  };

  const handleSelectGuestMode = () => {
    setIsGuestMode(true);
    setSelectedMemberId('');
    setShowSuggestions(false);
    setError('');
    setSearchQuery('Không có tên trong danh sách');
  };

  const handleGuestSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guestName.trim()) {
      setError('Vui lòng nhập tên người đóng góp.');
      return;
    }
    if (onGoToGuestContribute) {
      onGoToGuestContribute(guestName.trim());
    }
  };

  const handleSubmitMember = async (e: React.FormEvent) => {
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
            {isGuestMode ? 'Đóng Quỹ Với Tư Cách Khách' : 'Đăng Ký Tài Khoản Thành Viên'}
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

          {/* Autocomplete Member Selector (Single Input) */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
              Chọn tên của bạn trong danh sách lớp <span style={{ color: 'var(--danger)' }}>*</span>
            </label>

            {loadingMembers ? (
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '8px 0' }}>
                Đang tải danh sách thành viên...
              </div>
            ) : (
              <div ref={autocompleteRef} style={{ position: 'relative' }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Gõ để tìm tên..."
                    value={searchQuery}
                    onFocus={() => setShowSuggestions(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setShowSuggestions(true);
                      if (selectedMemberId && e.target.value !== getMemberDisplayName(members.find((m) => m.id === selectedMemberId))) {
                        setSelectedMemberId('');
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 38px 10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: `1.5px solid ${selectedMemberId ? 'var(--primary)' : isGuestMode ? '#eab308' : 'var(--border-color)'}`,
                      fontWeight: selectedMemberId || isGuestMode ? 600 : 400,
                      background: selectedMemberId || isGuestMode ? 'var(--bg-card-subtle)' : '#ffffff',
                    }}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedMemberId('');
                        setIsGuestMode(false);
                        setSearchQuery('');
                        setShowSuggestions(true);
                      }}
                      style={{
                        position: 'absolute',
                        right: '10px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '1.1rem',
                        lineHeight: 1,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Autocomplete Suggestions Dropdown */}
                {showSuggestions && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      marginTop: '4px',
                      background: '#ffffff',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      boxShadow: 'var(--shadow-lg)',
                      maxHeight: '260px',
                      overflowY: 'auto',
                      zIndex: 50,
                    }}
                  >
                    {filteredMembers.length > 0 ? (
                      filteredMembers.map((m) => (
                        <div
                          key={m.id}
                          onClick={() => handleSelectMember(m.id)}
                          style={{
                            padding: '10px 14px',
                            cursor: 'pointer',
                            borderBottom: '1px solid var(--border-color)',
                            fontSize: '0.95rem',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: selectedMemberId === m.id ? 'var(--bg-card-subtle)' : 'transparent',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-subtle)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = selectedMemberId === m.id ? 'var(--bg-card-subtle)' : 'transparent')}
                        >
                          <span style={{ fontWeight: selectedMemberId === m.id ? 700 : 500 }}>
                            {getMemberDisplayName(m)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                        Không tìm thấy thành viên phù hợp
                      </div>
                    )}

                    {/* "Không có tên trong danh sách" Option */}
                    <div
                      onClick={handleSelectGuestMode}
                      style={{
                        padding: '12px 14px',
                        cursor: 'pointer',
                        borderTop: '1px solid var(--border-color)',
                        color: 'var(--primary)',
                        fontWeight: 700,
                        background: '#f8fafc',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    >
                      <span>➕</span> Không có tên trong danh sách
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Form Content: Guest Mode VS Member Registration */}
          {isGuestMode ? (
            /* Guest Flow: Direct to Guest Donation */
            <form onSubmit={handleGuestSubmit}>
              <div
                style={{
                  padding: '14px 16px',
                  background: '#fefce8',
                  border: '1px solid #fef08a',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '20px',
                  fontSize: '0.88rem',
                  color: '#854d0e',
                  lineHeight: 1.5,
                }}
              >
                Bạn đang chọn đóng góp với tư cách khách. Bạn không cần đăng ký tài khoản hay xác thực email.
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Tên người đóng góp <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="Nhập họ và tên hoặc tổ chức của bạn..."
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '1rem',
                  }}
                  required
                  autoFocus
                />
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 700 }}
              >
                Đóng quỹ với tư cách khách →
              </button>
            </form>
          ) : (
            /* Standard Member Registration Form */
            <form onSubmit={handleSubmitMember}>
              {/* Username */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Tên đăng nhập <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="text"
                  placeholder="VD: nguyenhoa12"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '1rem',
                  }}
                  required
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Tối thiểu 3 ký tự, dùng để đăng nhập hệ thống.
                </div>
              </div>

              {/* Email */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Địa chỉ Email <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="email"
                  placeholder="VD: yourname@gmail.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '1rem',
                  }}
                  required
                />
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Mã xác thực tài khoản 6 số sẽ được gửi tới email này.
                </div>
              </div>

              {/* Password */}
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Mật khẩu <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="password"
                  placeholder="Tối thiểu 6 ký tự"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '1rem',
                  }}
                  required
                />
              </div>

              {/* Confirm Password */}
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                  Xác nhận mật khẩu <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  type="password"
                  placeholder="Nhập lại mật khẩu"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    fontSize: '1rem',
                  }}
                  required
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !selectedMemberId}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 700 }}
              >
                {loading ? 'Đang tạo tài khoản...' : 'Đăng Ký Tài Khoản'}
              </button>
            </form>
          )}

          {/* Login Link */}
          <div style={{ textAlign: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', fontSize: '0.9rem' }}>
            <span style={{ color: 'var(--text-muted)' }}>Bạn đã có tài khoản? </span>
            <button
              type="button"
              className="btn-link"
              onClick={onGoToLogin}
              style={{ fontWeight: 700, color: 'var(--primary)' }}
            >
              Đăng nhập ngay
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
