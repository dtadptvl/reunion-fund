import React, { useState, useEffect } from 'react';
import { formatVND } from '../utils/format.js';

interface ContributePageProps {
  currentUser?: any;
  initialGuestName?: string;
  onGoToLogin?: () => void;
  onGoToRegister?: () => void;
}

export const ContributePage: React.FC<ContributePageProps> = ({
  currentUser,
  onGoToLogin,
  onGoToRegister,
}) => {
  // Suggested amount from server (loaded dynamically from public config)
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [customAmountInput, setCustomAmountInput] = useState<string>('');
  const [isCustomAmount, setIsCustomAmount] = useState(false);

  const [loading, setLoading] = useState(false);
  const [intentData, setIntentData] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch suggested config
  useEffect(() => {
    fetch('/api/v1/public/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.suggestedAmount && typeof data.suggestedAmount === 'number' && data.suggestedAmount > 0) {
          setSuggestedAmount(data.suggestedAmount);
        }
        setLoadingConfig(false);
      })
      .catch((err) => {
        console.error('Lỗi tải cấu hình:', err);
        setLoadingConfig(false);
      });
  }, []);

  // Poll for payment confirmation once intent created
  useEffect(() => {
    if (!intentData?.paymentCode || isPaid) return;

    const interval = setInterval(() => {
      fetch(`/api/v1/public/intent/${intentData.paymentCode}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.isPaid) {
            setIsPaid(true);
            clearInterval(interval);
          }
        })
        .catch((err) => console.error(err));
    }, 3000);

    return () => clearInterval(interval);
  }, [intentData, isPaid]);

  const handleCreateQR = async () => {
    setErrorMessage('');
    const finalAmount = isCustomAmount ? Number(customAmountInput) : (suggestedAmount || 0);

    if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0 || !Number.isInteger(finalAmount)) {
      setErrorMessage('Vui lòng chọn hoặc nhập số tiền đóng góp hợp lệ (số nguyên dương VNĐ)');
      return;
    }

    if (!currentUser) {
      setErrorMessage('Vui lòng đăng nhập tài khoản thành viên để đóng quỹ.');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        memberId: currentUser.memberId,
        amount: finalAmount,
      };

      const res = await fetch('/api/v1/public/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Có lỗi xảy ra khi tạo mã đóng quỹ');
      } else {
        setIntentData(data);
      }
    } catch {
      setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">Đóng Quỹ Hoạt Động</h1>
        </div>

        {errorMessage && (
          <div style={{ padding: '12px 16px', background: 'var(--danger-bg)', color: 'var(--danger-text)', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontWeight: 500 }}>
            {errorMessage}
          </div>
        )}

        {!currentUser ? (
          /* Unauthenticated State: Clear guidance to Log in / Register */
          <div style={{ padding: '24px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>🔐</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '8px' }}>
              Yêu Cầu Đăng Nhập Thành Viên
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', lineHeight: 1.5, marginBottom: '24px' }}>
              Đóng quỹ họp lớp được liên kết tự động và trực tiếp với tài khoản thành viên của bạn để tính điểm và quyền lợi quay số may mắn.
            </p>

            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {onGoToLogin && (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={onGoToLogin}
                  style={{ minWidth: '160px' }}
                >
                  Đăng Nhập
                </button>
              )}
              {onGoToRegister && (
                <button
                  type="button"
                  className="btn btn-outline btn-lg"
                  onClick={onGoToRegister}
                  style={{ minWidth: '160px' }}
                >
                  Đăng Ký Tài Khoản
                </button>
              )}
            </div>

            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              * Nếu bạn muốn đóng góp ủng hộ với tư cách khách (không có tên trong danh sách lớp), vui lòng chọn <strong>Đăng Ký Tài Khoản</strong> và chọn <em>"Không có tên trong danh sách"</em>.
            </div>
          </div>
        ) : !intentData ? (
          /* Authenticated Member / Admin Flow */
          <div>
            {/* Account Identity Badge */}
            <div
              style={{
                padding: '16px 20px',
                background: 'var(--bg-card-subtle)',
                borderRadius: 'var(--radius-md)',
                border: '1.5px solid var(--primary)',
                marginBottom: '24px',
              }}
            >
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '4px' }}>
                Tài khoản thành viên lớp đã xác thực
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--primary)' }}>
                👤 {currentUser.fullName} {currentUser.role === 'ADMIN' ? '(Admin)' : ''}
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Khoản đóng sẽ tự động cập nhật vào danh sách đóng góp và hồ sơ của bạn ngay khi chuyển khoản.
              </div>
            </div>

            {/* Choose Amount */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '10px' }}>
                Chọn số tiền đóng góp
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                {/* Option 1: Configured Suggested Amount */}
                <button
                  type="button"
                  className={`btn ${!isCustomAmount ? 'btn-primary' : 'btn-outline'}`}
                  disabled={loadingConfig || suggestedAmount === null}
                  onClick={() => {
                    setIsCustomAmount(false);
                    setCustomAmountInput('');
                  }}
                  style={{
                    padding: '14px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: 'auto',
                    borderWidth: '2px',
                    opacity: loadingConfig ? 0.7 : 1,
                  }}
                >
                  {suggestedAmount !== null ? (
                    <>
                      <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{formatVND(suggestedAmount)}</span>
                      <span style={{ fontSize: '0.85rem', marginTop: '2px', opacity: 0.9 }}>Mức đề xuất</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '1rem', fontWeight: 600 }}>Đang tải...</span>
                      <span style={{ fontSize: '0.85rem', marginTop: '2px', opacity: 0.7 }}>Mức đề xuất</span>
                    </>
                  )}
                </button>

                {/* Option 2: Custom Amount */}
                <div
                  onClick={() => setIsCustomAmount(true)}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: `2px solid ${isCustomAmount ? 'var(--primary)' : 'var(--border-color)'}`,
                    background: isCustomAmount ? 'var(--card-bg)' : '#ffffff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px', color: isCustomAmount ? 'var(--primary)' : 'var(--text-main)' }}>
                    Số tiền khác
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="number"
                      placeholder="0"
                      value={customAmountInput}
                      onFocus={() => setIsCustomAmount(true)}
                      onChange={(e) => {
                        setIsCustomAmount(true);
                        setCustomAmountInput(e.target.value);
                      }}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-color)',
                        fontSize: '1rem',
                        fontWeight: 700,
                      }}
                    />
                    <span style={{ marginLeft: '6px', fontWeight: 700, color: 'var(--text-muted)' }}>₫</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Generate VietQR Button */}
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={handleCreateQR}
              disabled={loading || (loadingConfig && suggestedAmount === null)}
            >
              {loading ? 'Đang tạo mã QR...' : 'Tạo Mã QR Đóng Quỹ'}
            </button>
          </div>
        ) : (
          /* Step 2: VietQR Display & Payment Status */
          <div style={{ textAlign: 'center' }}>
            {isPaid ? (
              <div style={{ padding: '32px 16px' }}>
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🎉</div>
                <h2 style={{ color: 'var(--primary)', marginBottom: '8px' }}>Đóng Quỹ Thành Công!</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '24px' }}>
                  Cảm ơn <strong>{currentUser.fullName}</strong> đã đóng góp <strong>{formatVND(intentData.expectedAmount)}</strong> vào quỹ lớp.
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setIntentData(null);
                    setIsPaid(false);
                    setCustomAmountInput('');
                    setIsCustomAmount(false);
                  }}
                >
                  Đóng khoản khác
                </button>
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Mã thanh toán của bạn</div>
                  <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary)', letterSpacing: '1px' }}>
                    {intentData.paymentCode}
                  </div>
                </div>

                {/* QR Code Container */}
                <div
                  style={{
                    display: 'inline-block',
                    padding: '16px',
                    background: 'white',
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    marginBottom: '20px',
                  }}
                >
                  <img
                    src={intentData.qrUrl}
                    alt="VietQR Đóng Quỹ Họp Lớp"
                    style={{ width: '100%', maxWidth: '280px', height: 'auto', display: 'block' }}
                  />
                </div>

                {/* Transfer Info Details */}
                <div
                  style={{
                    background: 'var(--bg-card-subtle)',
                    padding: '16px',
                    borderRadius: 'var(--radius-md)',
                    textAlign: 'left',
                    marginBottom: '24px',
                    fontSize: '0.9rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Số tiền:</span>
                    <strong>{formatVND(intentData.expectedAmount)}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Nội dung chuyển khoản:</span>
                    <strong style={{ color: 'var(--primary)', userSelect: 'all' }}>{intentData.transferContent}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Trạng thái:</span>
                    <span style={{ color: '#d97706', fontWeight: 600 }}>⏳ Đang chờ nhận tiền...</span>
                  </div>
                </div>

                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Hệ thống sẽ tự động xác nhận ngay khi nhận được biến động số dư. Bạn không cần làm gì thêm.
                </div>

                <button
                  className="btn btn-outline"
                  onClick={() => {
                    setIntentData(null);
                    setIsPaid(false);
                  }}
                >
                  Quay lại
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
