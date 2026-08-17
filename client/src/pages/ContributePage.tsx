import React, { useState, useEffect, useRef } from 'react';
import { formatVND } from '../utils/format.js';

export const ContributePage: React.FC = () => {
  const [members, setMembers] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string>('');
  const [isCustomName, setIsCustomName] = useState(false);
  const [customName, setCustomName] = useState('');

  // Suggested amount from server (default 500,000 VND)
  const [suggestedAmount, setSuggestedAmount] = useState<number>(500000);
  const [customAmountInput, setCustomAmountInput] = useState<string>('');
  const [isCustomAmount, setIsCustomAmount] = useState(false);

  const [loading, setLoading] = useState(false);
  const [intentData, setIntentData] = useState<any>(null);
  const [isPaid, setIsPaid] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Name correction modal state
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [correctingName, setCorrectingName] = useState('');
  const [correctionSuccessMsg, setCorrectionSuccessMsg] = useState('');
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);

  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Fetch roster and suggested config
  const loadData = () => {
    fetch('/api/v1/public/members')
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []))
      .catch((err) => console.error(err));

    fetch('/api/v1/public/config')
      .then((res) => res.json())
      .then((data) => {
        if (data.suggestedAmount && typeof data.suggestedAmount === 'number') {
          setSuggestedAmount(data.suggestedAmount);
        }
      })
      .catch((err) => console.error(err));
  };

  useEffect(() => {
    loadData();
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
    setCorrectionSuccessMsg('');
    setShowSuggestions(false);
    const m = members.find((x) => x.id === memberId);
    if (m) {
      setSearchQuery(getMemberDisplayName(m));
    } else if (!memberId) {
      setSearchQuery('');
    }
  };

  const handleCreateQR = async () => {
    setErrorMessage('');
    const finalAmount = isCustomAmount ? Number(customAmountInput) : suggestedAmount;

    if (!finalAmount || isNaN(finalAmount) || finalAmount < 10000) {
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

  const handleSendNameCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMemberId || !correctingName.trim()) return;

    setCorrectionSubmitting(true);
    try {
      const res = await fetch(`/api/v1/public/members/${selectedMemberId}/correction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestedName: correctingName.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCorrectionModal(false);
        setCorrectionSuccessMsg(
          data.message || 'Đã gửi yêu cầu sửa tên. Thủ quỹ sẽ kiểm tra và cập nhật. Bạn vẫn có thể tiếp tục đóng quỹ.'
        );
      } else {
        alert(data.error || 'Có lỗi xảy ra khi gửi yêu cầu');
      }
    } catch (err) {
      alert('Không thể kết nối máy chủ');
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const selectedMember = members.find((m) => m.id === selectedMemberId);

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
                  {/* Live Autocomplete Search Input */}
                  <div ref={autocompleteRef} style={{ position: 'relative', marginBottom: '10px' }}>
                    <input
                      type="text"
                      placeholder="Gõ để tìm tên trong danh sách 40 thành viên..."
                      value={searchQuery}
                      onFocus={() => setShowSuggestions(true)}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setShowSuggestions(true);
                        // If user completely cleared the search query, clear selection
                        if (!e.target.value.trim()) {
                          setSelectedMemberId('');
                        }
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)',
                      }}
                    />

                    {/* Autocomplete Suggestion Dropdown */}
                    {showSuggestions && (
                      <div
                        style={{
                          position: 'absolute',
                          top: '100%',
                          left: 0,
                          right: 0,
                          maxHeight: '220px',
                          overflowY: 'auto',
                          background: '#ffffff',
                          border: '1px solid var(--border-color)',
                          borderRadius: 'var(--radius-md)',
                          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
                          zIndex: 50,
                          marginTop: '4px',
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
                                background: m.id === selectedMemberId ? 'var(--primary-bg)' : '#ffffff',
                                color: m.id === selectedMemberId ? 'var(--primary)' : 'var(--text-main)',
                                fontWeight: m.id === selectedMemberId ? 700 : 500,
                              }}
                              onMouseEnter={(e) => {
                                if (m.id !== selectedMemberId) e.currentTarget.style.background = 'var(--bg-card-subtle)';
                              }}
                              onMouseLeave={(e) => {
                                if (m.id !== selectedMemberId) e.currentTarget.style.background = '#ffffff';
                              }}
                            >
                              {m.full_name} {m.disambiguator ? `(${m.disambiguator})` : ''}
                            </div>
                          ))
                        ) : (
                          <div style={{ padding: '12px 14px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            Không tìm thấy thành viên phù hợp
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Synchronized Dropdown Select */}
                  <select
                    value={selectedMemberId}
                    onChange={(e) => handleSelectMember(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-color)',
                      marginBottom: '8px',
                    }}
                  >
                    <option value="">-- Chọn thành viên lớp --</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} {m.disambiguator ? `(${m.disambiguator})` : ''}
                      </option>
                    ))}
                  </select>

                  {/* Name correction link when member selected */}
                  {selectedMemberId && selectedMember && (
                    <div style={{ marginBottom: '12px' }}>
                      {correctionSuccessMsg ? (
                        <div style={{ padding: '10px', background: 'var(--primary-bg)', color: 'var(--primary-text)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                          ✓ {correctionSuccessMsg}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setCorrectingName(selectedMember.full_name + (selectedMember.disambiguator ? ` (${selectedMember.disambiguator})` : ''));
                            setShowCorrectionModal(true);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            textDecoration: 'underline',
                          }}
                        >
                          Tên của bạn bị sai? Nhấn vào đây để sửa
                        </button>
                      )}
                    </div>
                  )}

                  <div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsCustomName(true);
                        setSelectedMemberId('');
                        setSearchQuery('');
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
                    onClick={() => {
                      setIsCustomName(false);
                      setCustomName('');
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
                    ← Chọn từ danh sách thành viên lớp
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Choose Contribution Amount (ONLY TWO CHOICES) */}
            <div style={{ marginBottom: '28px' }}>
              <label style={{ display: 'block', fontWeight: 700, marginBottom: '10px' }}>
                2. Chọn số tiền đóng góp
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                {/* Option 1: Configured Suggested Amount */}
                <button
                  type="button"
                  className={`btn ${!isCustomAmount ? 'btn-primary' : 'btn-outline'}`}
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
                  }}
                >
                  <span style={{ fontSize: '1.2rem', fontWeight: 800 }}>{formatVND(suggestedAmount)}</span>
                  <span style={{ fontSize: '0.85rem', marginTop: '2px', opacity: 0.9 }}>Mức đề xuất</span>
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

      {/* Modal: Yêu cầu sửa tên (Chỉ duy nhất 1 ô nhập: Tên đúng của bạn) */}
      {showCorrectionModal && selectedMember && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}>
          <div className="card" style={{ maxWidth: '440px', width: '100%' }}>
            <div className="card-header">
              <h2 className="card-title">Sửa tên thành viên</h2>
              <button
                type="button"
                onClick={() => setShowCorrectionModal(false)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSendNameCorrection}>
              <div style={{ marginBottom: '16px', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                Tên đang chọn:{' '}
                <strong style={{ color: 'var(--text-main)' }}>
                  {selectedMember.full_name}
                  {selectedMember.disambiguator ? ` (${selectedMember.disambiguator})` : ''}
                </strong>
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  Tên đúng của bạn
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={correctingName}
                  onChange={(e) => setCorrectingName(e.target.value)}
                  placeholder="Nhập tên chính xác của bạn..."
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '1rem',
                  }}
                />
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowCorrectionModal(false)}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={correctionSubmitting}
                >
                  {correctionSubmitting ? 'Đang gửi...' : 'Gửi yêu cầu sửa tên'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
