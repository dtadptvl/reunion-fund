import React, { useState, useEffect } from 'react';
import { formatVND } from '../utils/format.js';

export const ContributePage: React.FC = () => {
  const [members, setMembers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [isCustomName, setIsCustomName] = useState(false);
  const [customName, setCustomName] = useState('');

  const [selectedAmount, setSelectedAmount] = useState<number>(500000);
  const [customAmountInput, setCustomAmountInput] = useState<string>('');
  const [isCustomAmount, setIsCustomAmount] = useState(false);

  const [loading, setLoading] = useState(false);
  const [intentData, setIntentData] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Fetch roster
  useEffect(() => {
    fetch('/api/v1/public/members')
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []))
      .catch((err) => console.error(err));
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
    const finalAmount = isCustomAmount ? Number(customAmountInput) : selectedAmount;

    if (!finalAmount || finalAmount < 10000) {
      setErrorMessage('Vui lòng nhập số tiền đóng góp hợp lệ (tối thiểu 10.000 ₫)');
      return;
    }

    if (!selectedMemberId && (!isCustomName || !customName.trim())) {
      setErrorMessage('Vui lòng chọn tên trong danh sách hoặc nhập họ tên của bạn');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/v1/public/intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId: isCustomName ? undefined : selectedMemberId,
          customName: isCustomName ? customName.trim() : undefined,
          amount: finalAmount,
        }),
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

  const filteredMembers = members.filter((m) =>
    m.full_name.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            {/* Step 1: Choose Contributor Name */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '8px' }}>
                1. Bạn đang đóng quỹ dưới tên ai?
              </label>

              {!isCustomName ? (
                <div>
                  <input
                    type="text"
                    placeholder="Tìm tên trong danh sách lớp..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      marginBottom: '10px',
                    }}
                  />
                  <select
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      marginBottom: '10px',
                    }}
                  >
                    <option value="">-- Chọn thành viên lớp --</option>
                    {filteredMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomName(true);
                      setSelectedMemberId('');
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--primary)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                    }}
                  >
                    + Không có tên trong danh sách lớp
                  </button>
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    placeholder="Nhập họ và tên của bạn..."
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      marginBottom: '8px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setIsCustomName(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--primary)',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 600,
                    }}
                  >
                    ← Chọn từ danh sách thành viên lớp
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Choose Contribution Amount */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '8px' }}>
                2. Chọn số tiền đóng góp
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '12px' }}>
                {[500000, 1000000, 2000000].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    className={`btn ${!isCustomAmount && selectedAmount === amt ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => {
                      setSelectedAmount(amt);
                      setIsCustomAmount(false);
                    }}
                  >
                    {formatVND(amt)}
                  </button>
                ))}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="number"
                  placeholder="Hoặc nhập số tiền khác (VNĐ)..."
                  value={customAmountInput}
                  onChange={(e) => {
                    setCustomAmountInput(e.target.value);
                    setIsCustomAmount(true);
                  }}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                  }}
                />
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
                  ← Đổi số tiền hoặc người đóng khác
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
