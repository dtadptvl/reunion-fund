import React, { useState, useEffect, useRef } from 'react';
import { AuthShell } from '../components/AuthShell.js';

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

  const footerContent = (
    <div className="auth-footer-text">
      Đã có tài khoản thành viên?{' '}
      <button type="button" onClick={onGoToLogin} className="btn-link-inline">
        Đăng nhập ngay
      </button>
    </div>
  );

  return (
    <AuthShell
      title={isGuestMode ? 'Đóng Quỹ Với Tư Cách Khách' : 'Đăng Ký Tài Khoản'}
      sideDescription="Đăng ký tài khoản thành viên để theo dõi các khoản đóng góp, kiểm tra tỷ lệ quay thưởng may mắn và tham gia biểu quyết các hoạt động họp lớp."
      footerContent={footerContent}
    >
      {error && <div className="alert-box alert-danger">{error}</div>}

      {/* Autocomplete Member Selector */}
      <div className="form-group">
        <label className="form-label">
          Chọn tên của bạn trong danh sách lớp <span className="text-danger">*</span>
        </label>

        {loadingMembers ? (
          <div className="text-muted" style={{ padding: '8px 0', fontSize: '0.9rem' }}>
            Đang tải danh sách thành viên...
          </div>
        ) : (
          <div ref={autocompleteRef} className="autocomplete-container">
            <div className="autocomplete-input-wrapper">
              <input
                type="text"
                className={`form-input ${selectedMemberId ? 'input-selected' : isGuestMode ? 'input-guest' : ''}`}
                placeholder="Gõ để tìm tên..."
                value={searchQuery}
                onFocus={() => setShowSuggestions(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                  if (
                    selectedMemberId &&
                    e.target.value !== getMemberDisplayName(members.find((m) => m.id === selectedMemberId))
                  ) {
                    setSelectedMemberId('');
                  }
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="autocomplete-clear-btn"
                  onClick={() => {
                    setSelectedMemberId('');
                    setIsGuestMode(false);
                    setSearchQuery('');
                    setShowSuggestions(true);
                  }}
                  aria-label="Xóa tìm kiếm"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && (
              <div className="autocomplete-dropdown">
                {filteredMembers.length > 0 ? (
                  filteredMembers.map((m) => (
                    <div
                      key={m.id}
                      className={`autocomplete-item ${selectedMemberId === m.id ? 'active' : ''}`}
                      onClick={() => handleSelectMember(m.id)}
                    >
                      <div className="item-name">{m.full_name}</div>
                      {m.disambiguator && <span className="item-badge">({m.disambiguator})</span>}
                    </div>
                  ))
                ) : (
                  <div className="autocomplete-empty-state">
                    Không tìm thấy thành viên phù hợp
                  </div>
                )}

                {/* "Không có tên trong danh sách" Option */}
                <div className="autocomplete-guest-option" onClick={handleSelectGuestMode}>
                  <span>➕</span>
                  <strong>Không có tên trong danh sách</strong>
                  <span className="guest-tag">(Đóng góp dạng Khách)</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Form Content: Guest Mode VS Member Registration */}
      {isGuestMode ? (
        <form onSubmit={handleGuestSubmit}>
          <div className="alert-box alert-warning">
            Bạn đang chọn đóng góp với tư cách khách. Bạn không cần đăng ký tài khoản hay xác thực email.
          </div>

          <div className="form-group">
            <label className="form-label">
              Tên người đóng góp <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="Nhập họ và tên hoặc tổ chức của bạn..."
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg">
            Đóng quỹ với tư cách khách →
          </button>
        </form>
      ) : (
        <form onSubmit={handleSubmitMember}>
          {/* Username */}
          <div className="form-group">
            <label className="form-label">
              Tên đăng nhập <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="VD: nguyenhoa12"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
            <div className="form-hint">Tối thiểu 3 ký tự, dùng để đăng nhập hệ thống.</div>
          </div>

          {/* Email */}
          <div className="form-group">
            <label className="form-label">
              Địa chỉ Email <span className="text-danger">*</span>
            </label>
            <input
              type="email"
              className="form-input"
              placeholder="VD: yourname@gmail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div className="form-hint">Mã xác thực tài khoản 6 số sẽ được gửi tới email này.</div>
          </div>

          {/* Password */}
          <div className="form-group">
            <label className="form-label">
              Mật khẩu <span className="text-danger">*</span>
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="Tối thiểu 6 ký tự"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {/* Confirm Password */}
          <div className="form-group">
            <label className="form-label">
              Xác nhận mật khẩu <span className="text-danger">*</span>
            </label>
            <input
              type="password"
              className="form-input"
              placeholder="Nhập lại mật khẩu"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block btn-lg"
            disabled={loading || !selectedMemberId}
          >
            {loading ? 'Đang đăng ký...' : 'Hoàn tất đăng ký'}
          </button>
        </form>
      )}
    </AuthShell>
  );
};
