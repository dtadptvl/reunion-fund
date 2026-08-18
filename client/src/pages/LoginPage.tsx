import React, { useState } from 'react';
import { AuthShell } from '../components/AuthShell.js';

interface LoginPageProps {
  onLoginSuccess: (user: any) => void;
  onGoToRegister: () => void;
  onGoToVerify: (email?: string) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  onLoginSuccess,
  onGoToRegister,
  onGoToVerify,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setUnverifiedEmail(null);
    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Đăng nhập thất bại');
        if (data.requiresVerification && data.email) {
          setUnverifiedEmail(data.email);
        }
      } else {
        onLoginSuccess(data.user);
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ. Vui lòng thử lại sau.');
    } finally {
      setLoading(false);
    }
  };

  const footerContent = (
    <div className="auth-footer-text">
      Chưa có tài khoản thành viên?{' '}
      <button type="button" onClick={onGoToRegister} className="btn-link-inline">
        Đăng ký ngay
      </button>
    </div>
  );

  return (
    <AuthShell
      title="Đăng Nhập Thành Viên"
      sideDescription="Đăng nhập để xem thông tin đóng quỹ cá nhân, lịch sử đóng góp và tỷ lệ quay thưởng may mắn tại đêm Gala kỷ niệm 10 năm."
      footerContent={footerContent}
    >
      {error && (
        <div className="alert-box alert-danger">
          <div>{error}</div>
          {unverifiedEmail && (
            <button
              type="button"
              onClick={() => onGoToVerify(unverifiedEmail)}
              className="btn btn-primary btn-sm"
              style={{ marginTop: '8px' }}
            >
              👉 Nhập mã xác thực email ngay
            </button>
          )}
        </div>
      )}

      <form onSubmit={handleLogin}>
        <div className="form-group">
          <label className="form-label">
            Tên đăng nhập hoặc Email <span className="text-danger">*</span>
          </label>
          <input
            type="text"
            className="form-input"
            required
            placeholder="VD: nguyenhoa12 hoặc email@gmail.com"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
        </div>

        <div className="form-group">
          <label className="form-label">
            Mật khẩu <span className="text-danger">*</span>
          </label>
          <input
            type="password"
            className="form-input"
            required
            placeholder="Nhập mật khẩu của bạn"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary btn-block btn-lg"
          disabled={loading}
        >
          {loading ? 'Đang xác thực...' : 'Đăng nhập'}
        </button>
      </form>
    </AuthShell>
  );
};
