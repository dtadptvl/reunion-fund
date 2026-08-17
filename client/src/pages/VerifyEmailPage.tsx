import React, { useState } from 'react';

interface VerifyEmailPageProps {
  initialEmail?: string;
  onVerificationSuccess: () => void;
  onGoToLogin: () => void;
}

export const VerifyEmailPage: React.FC<VerifyEmailPageProps> = ({
  initialEmail = '',
  onVerificationSuccess,
  onGoToLogin,
}) => {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMessage('');

    if (!email.trim()) {
      setError('Vui lòng nhập địa chỉ email của bạn.');
      return;
    }

    if (!code.trim() || code.trim().length !== 6) {
      setError('Vui lòng nhập đầy đủ mã xác thực 6 chữ số.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: code.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Mã xác thực không hợp lệ.');
      } else {
        setInfoMessage('Xác thực email thành công! Đang chuyển đến trang đăng nhập...');
        setTimeout(() => {
          onVerificationSuccess();
        }, 1500);
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setInfoMessage('');

    if (!email.trim()) {
      setError('Vui lòng nhập địa chỉ email để gửi lại mã.');
      return;
    }

    setResending(true);

    try {
      const res = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: email.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Không thể gửi lại mã xác thực.');
      } else {
        setInfoMessage('Đã gửi lại mã xác thực mới tới email của bạn. Vui lòng kiểm tra hộp thư.');
      }
    } catch (err) {
      setError('Lỗi kết nối máy chủ.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div style={{ maxWidth: '440px', margin: '40px auto' }}>
      <div className="card">
        <div className="card-header" style={{ textAlign: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '1px' }}>
            KỶ NIỆM 10 NĂM RA TRƯỜNG
          </div>
          <h1 className="card-title" style={{ fontSize: '1.4rem', margin: '6px 0 2px 0' }}>
            Xác Thực Email
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
                marginBottom: '16px',
                fontSize: '0.9rem',
              }}
            >
              {error}
            </div>
          )}

          {infoMessage && (
            <div
              style={{
                padding: '12px 16px',
                background: 'var(--primary-light, #eff6ff)',
                color: 'var(--primary, #1e40af)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              {infoMessage}
            </div>
          )}

          <form onSubmit={handleVerify}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                Email đăng ký của bạn
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px', fontSize: '0.9rem' }}>
                Mã xác thực 6 chữ số
              </label>
              <input
                type="text"
                required
                maxLength={6}
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  border: '2px solid var(--primary)',
                  fontSize: '1.4rem',
                  letterSpacing: '8px',
                  textAlign: 'center',
                  fontWeight: 700,
                }}
              />
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '6px', textAlign: 'center' }}>
                Vui lòng kiểm tra hộp thư đến (hoặc thư mục Spam/Rác)
              </div>
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '12px', fontWeight: 700, fontSize: '1rem', marginBottom: '12px' }}
              disabled={loading}
            >
              {loading ? 'Đang xác thực...' : '✅ KÍCH HOẠT TÀI KHOẢN'}
            </button>

            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: '100%', padding: '10px' }}
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? 'Đang gửi lại...' : '📩 Gửi Lại Mã Xác Thực'}
            </button>
          </form>

          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Đã kích hoạt tài khoản?{' '}
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
              Đăng nhập
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
