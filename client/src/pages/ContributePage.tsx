import React, { useState, useEffect } from 'react';
import { formatVND } from '../utils/format.js';

interface ContributePageProps {
  currentUser?: any;
  initialGuestName?: string;
  onGoToLogin?: () => void;
}

export const ContributePage: React.FC<ContributePageProps> = ({
  currentUser,
  initialGuestName = '',
  onGoToLogin,
}) => {
  // Guest contributor state
  const [guestName, setGuestName] = useState<string>(initialGuestName);

  // Suggested amount from server (loaded dynamically from public config, no stale hardcoded flash)
  const [suggestedAmount, setSuggestedAmount] = useState<number | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [customAmountInput, setCustomAmountInput] = useState<string>('');
  const [isCustomAmount, setIsCustomAmount] = useState(false);

  const [loading, setLoading] = useState(false);
  const [intentData, setIntentData] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Update guest name if initialGuestName prop changes
  useEffect(() => {
    if (initialGuestName) {
      setGuestName(initialGuestName);
    }
  }, [initialGuestName]);

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
        console.error(err);
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

    if (!finalAmount || isNaN(finalAmount) || finalAmount <= 0) {
      setErrorMessage('Vui lòng chọn hoặc nhập số tiền đóng góp hợp lệ (số nguyên dương VNĐ)');
      return;
    }

    if (!currentUser && !guestName.trim()) {
      setErrorMessage('Vui lòng nhập họ và tên của bạn để đóng góp với tư cách khách');
      return;
    }

    setLoading(true);
    try {
      const payload = currentUser
        ? {
            memberId: currentUser.memberId,
            amount: finalAmount,
          }
        : {
            customName: guestName.trim(),
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
    } catch (err: any) {
      setErrorMessage('Không thể kết nối đến máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '640px', margin: '0 auto' }}>
      <div className="card">
        <div className="card-header">
          <h1 className="card-title">Đóng Quỹ Họp Lớp</h1>
        </div>

        {errorMessage && (
          <div style={{ padding: '12px', background: 'var(--danger-bg)', color: 'var(--danger-text)', borderRadius: 'var(--radius-md)', marginBottom: '16px' }}>
            {errorMessage}
          </div>
        )}

        {!intentData ? (
          <div>
            {/* Step 1: Contributor Identity */}
            {currentUser ? (
              /* Authenticated Member / Admin Flow: Immutable Identity */
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
                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--primary)' }}>
                  👤 Bạn đang đóng quỹ với tên: <strong>{currentUser.fullName}</strong>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Khoản đóng sẽ tự động cập nhật vào thông tin cá nhân và tính tỷ lệ quay số may mắn của bạn.
                </div>
              </div>
            ) : (
              /* Unauthenticated / Guest Flow */
              <div style={{ marginBottom: '24px' }}>
                {/* Member Login Callout */}
                <div
                  style={{
                    padding: '14px 16px',
                    background: 'var(--bg-card-subtle)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px dashed var(--border-color)',
                    marginBottom: '18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>Bạn là thành viên trong danh sách lớp A1?</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                      Đăng nhập để tự động liên kết đóng góp và nhận quyền lợi thành viên.
                    </div>
                  </div>
                  {onGoToLogin && (
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={onGoToLogin}
                      style={{ fontWeight: 600, fontSize: '0.85rem' }}
                    >
                      Đăng nhập để đóng quỹ
                    </button>
                  )}
                </div>

                {/* Guest Contributor Name Input */}
                <div>
                  <label style={{ display: 'block', fontWeight: 700, marginBottom: '8px' }}>
                    1. Đóng góp với tư cách khách
                  </label>
                  <input
                    type="text"
                    placeholder="Nhập họ và tên hoặc tổ chức của bạn..."
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      fontSize: '1rem',
                    }}
                  />
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Khách đóng góp sẽ được ghi nhận và vinh danh công khai trên bảng đóng góp.
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Choose Contribution Amount */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '10px' }}>
                {currentUser ? '1.' : '2.'} Chọn số tiền đóng góp
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

            {/* Step 3: Generate VietQR Button */}
            <button
              className="btn btn-primary btn-lg"
              style={{ width: '100%' }}
              onClick={handleCreateQR}
              disabled={loading}
            >
              {loading ? 'Đang tạo mã QR...' : 'Tạo mã chuyển khoản VietQR'}
            </button>
          </div>
        ) : (
          /* VietQR Display & Live Polling Status */
          <div style={{ textAlign: 'center' }}>
            {!isPaid ? (
              <div>
                <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Quét mã QR bằng ứng dụng ngân hàng bất kỳ
                </div>

                <div style={{ margin: '16px auto', maxWidth: '300px', padding: '12px', background: '#fff', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-lg)' }}>
                  <img
                    src={intentData.qrUrl}
                    alt="VietQR Chuyển Khoản"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                </div>

                <div style={{ background: 'var(--bg-card-subtle)', padding: '16px', borderRadius: 'var(--radius-md)', textAlign: 'left', marginBottom: '20px' }}>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Người đóng góp: </span>
                    <strong>{intentData.contributorName || currentUser?.fullName || guestName}</strong>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Số tiền: </span>
                    <strong style={{ fontSize: '1.2rem', color: 'var(--primary)' }}>
                      {formatVND(intentData.expectedAmount)}
                    </strong>
                  </div>
                  <div style={{ marginBottom: '8px' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Nội dung chuyển khoản (bắt buộc giữ nguyên): </span>
                    <strong style={{ display: 'block', fontSize: '1.1rem', letterSpacing: '0.05em', color: 'var(--text-main)', marginTop: '4px', background: '#fff', padding: '8px', border: '1px dashed var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
                      {intentData.transferContent}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Ngân hàng thụ hưởng: </span>
                    <strong>{intentData.bankName} - {intentData.bankAccount}</strong> ({intentData.accountName})
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  <span className="pulse-dot" style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--primary)' }}></span>
                  Đang chờ hệ thống ngân hàng xác nhận giao dịch...
                </div>

                <button
                  className="btn btn-outline"
                  style={{ marginTop: '20px' }}
                  onClick={() => setIntentData(null)}
                >
                  ← Đổi số tiền hoặc thông tin đóng góp
                </button>
              </div>
            ) : (
              /* Success State */
              <div style={{ padding: '30px 10px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🎉</div>
                <h2 style={{ color: 'var(--primary)', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>
                  ĐÃ NHẬN ĐÓNG GÓP THÀNH CÔNG!
                </h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Hệ thống đã tự động ghi nhận khoản tiền đóng góp vào quỹ họp lớp. Cảm ơn bạn rất nhiều!
                </p>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setIntentData(null);
                    setIsPaid(false);
                  }}
                >
                  Đóng góp thêm khoản khác
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
