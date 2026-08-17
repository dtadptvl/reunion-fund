import React, { useState, useEffect } from 'react';

interface ActivitySummary {
  id: string;
  title: string;
  description?: string | null;
  display_order: number;
  total_participants: number;
  participants: Array<{
    member_id: string;
    full_name: string;
    disambiguator?: string | null;
    participant_count: number;
    updated_at: string;
  }>;
}

interface UserRsvpItem {
  activityId: string;
  participantCount: number;
  notes?: string;
}

interface ActivitiesPageProps {
  currentUser: any;
  onGoToLogin: () => void;
  onGoToRegister: () => void;
}

export const ActivitiesPage: React.FC<ActivitiesPageProps> = ({
  currentUser,
  onGoToLogin,
  onGoToRegister,
}) => {
  const [publicData, setPublicData] = useState<{
    isLocked: boolean;
    activities: ActivitySummary[];
  } | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Selected RSVP map: activityId -> participantCount
  const [selectedRsvps, setSelectedRsvps] = useState<Record<string, { selected: boolean; count: number }>>({});

  const loadData = async () => {
    try {
      const pubRes = await fetch('/api/v1/public/activities');
      const pubJson = await pubRes.json();
      setPublicData(pubJson);

      // If user is logged in, fetch their own current RSVPs
      if (currentUser) {
        const userRes = await fetch('/api/v1/auth/rsvps');
        if (userRes.ok) {
          const userJson = await userRes.json();
          const rsvpMap: Record<string, { selected: boolean; count: number }> = {};

          // Initialize with default false & count 1 for all activities
          if (pubJson.activities) {
            pubJson.activities.forEach((act: ActivitySummary) => {
              rsvpMap[act.id] = { selected: false, count: 1 };
            });
          }

          // Populate with user's saved RSVPs
          if (userJson.rsvps && Array.isArray(userJson.rsvps)) {
            userJson.rsvps.forEach((r: any) => {
              rsvpMap[r.activity_id] = {
                selected: true,
                count: r.participant_count || 1,
              };
            });
          }

          setSelectedRsvps(rsvpMap);
        }
      } else {
        // Not logged in, initialize default map
        if (pubJson.activities) {
          const rsvpMap: Record<string, { selected: boolean; count: number }> = {};
          pubJson.activities.forEach((act: ActivitySummary) => {
            rsvpMap[act.id] = { selected: false, count: 1 };
          });
          setSelectedRsvps(rsvpMap);
        }
      }
    } catch (err) {
      console.error('Lỗi khi tải danh sách hoạt động:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const handleToggleActivity = (activityId: string) => {
    if (publicData?.isLocked) return;
    setSelectedRsvps((prev) => {
      const current = prev[activityId] || { selected: false, count: 1 };
      return {
        ...prev,
        [activityId]: {
          selected: !current.selected,
          count: current.count || 1,
        },
      };
    });
  };

  const handleCountChange = (activityId: string, value: number) => {
    if (publicData?.isLocked) return;
    const sanitized = Math.max(1, Math.floor(value || 1));
    setSelectedRsvps((prev) => {
      const current = prev[activityId] || { selected: true, count: 1 };
      return {
        ...prev,
        [activityId]: {
          ...current,
          count: sanitized,
        },
      };
    });
  };

  const handleSaveRsvp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSaveSuccessMsg('');

    if (publicData?.isLocked) {
      setErrorMessage('Đăng ký tham gia hoạt động đã bị khóa bởi Ban Quản trị.');
      return;
    }

    const payload: UserRsvpItem[] = [];
    Object.entries(selectedRsvps).forEach(([actId, data]) => {
      if (data.selected) {
        payload.push({
          activityId: actId,
          participantCount: data.count || 1,
        });
      }
    });

    setSaving(true);

    try {
      const res = await fetch('/api/v1/auth/rsvps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvps: payload }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || 'Không thể lưu thông tin đăng ký.');
      } else {
        setSaveSuccessMsg('✓ Đã lưu thông tin đăng ký hoạt động thành công!');
        await loadData();
      }
    } catch (err) {
      setErrorMessage('Lỗi kết nối máy chủ khi lưu đăng ký.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !publicData) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải kế hoạch họp lớp & hoạt động...</div>;
  }

  const { isLocked, activities } = publicData;

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', paddingBottom: '40px' }}>
      {/* 1. Event Invitation & Header */}
      <div className="card" style={{ textAlign: 'center', marginBottom: '24px', padding: '32px 20px' }}>
        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', letterSpacing: '1.5px', marginBottom: '6px' }}>
          LỜI MỜI HỌP MẶT
        </div>
        <h1 className="hero-title" style={{ fontSize: '2rem', margin: '4px 0 8px 0' }}>
          KỶ NIỆM 10 NĂM RA TRƯỜNG
        </h1>
        <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '4px' }}>
          LỚP A1 — KHÓA 48 (Niên khóa 2013–2016)
        </div>
        <div style={{ fontSize: '1rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
          Trường THPT Văn Lâm
        </div>
        <div
          style={{
            display: 'inline-block',
            padding: '6px 16px',
            background: 'var(--primary-light, #eff6ff)',
            color: 'var(--primary, #1e40af)',
            borderRadius: '20px',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          📅 Ngày hội ngộ: Kỷ niệm 10 năm ra trường
        </div>
      </div>

      {/* 2. Reunion Plan Section */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header">
          <h2 className="card-title" style={{ fontSize: '1.3rem' }}>
            📋 Kế hoạch họp lớp 10 năm
          </h2>
        </div>
        <div style={{ fontSize: '0.95rem', lineHeight: '1.7', color: 'var(--text-main)' }}>
          <p style={{ marginTop: 0 }}>
            Thân gửi toàn thể các bạn thành viên <strong>Lớp A1 — Khóa 48 (2013–2016)</strong>,
          </p>
          <p>
            Tròn một thập kỷ kể từ ngày chúng ta cùng nhau rời mái trường THPT Văn Lâm thân yêu để bước vào những chặng đường đời riêng.
            Buổi gặp mặt 10 năm là dịp đặc biệt để tất cả chúng ta hội ngộ, ôn lại kỷ niệm tuổi học trò và tri ân thầy cô giáo kính yêu.
          </p>
          <div style={{ background: 'var(--bg-card-subtle, #f8fafc)', padding: '16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', margin: '16px 0' }}>
            <div style={{ fontWeight: 700, marginBottom: '8px', color: 'var(--primary)' }}>Các chương trình hoạt động chính:</div>
            <ul style={{ margin: 0, paddingLeft: '20px' }}>
              <li><strong>1. Về trường tặng quà:</strong> Tập trung tại Trường THPT Văn Lâm, thăm lại lớp học xưa và trao quà lưu niệm.</li>
              <li><strong>2. Về nhà tặng quà cô giáo:</strong> Đoàn lớp tới thăm gia đình và chúc sức khỏe cô giáo chủ nhiệm.</li>
              <li><strong>3. Ăn uống:</strong> Tiệc trưa liên hoan họp mặt thân mật với toàn thể bạn bè và người thân.</li>
              <li><strong>4. Vui chơi sau ăn:</strong> Giao lưu văn nghệ, chuyện trò, chụp ảnh kỷ niệm và kết nối.</li>
            </ul>
          </div>
          <p style={{ marginBottom: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            💡 <em>Lưu ý: Bạn có thể đăng ký tham gia từng hoạt động cụ thể và điền số lượng người đi cùng (vợ/chồng/con) để Ban Tổ chức chuẩn bị chu đáo nhất.</em>
          </p>
        </div>
      </div>

      {/* 3. Member RSVP Form (Logged-in or Call to Login) */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <div>
            <h2 className="card-title" style={{ fontSize: '1.3rem' }}>
              ✍️ Đăng ký tham gia các hoạt động
            </h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              {isLocked ? '🔒 Ban Quản trị đã khóa đăng ký hoạt động' : 'Tự do lựa chọn các hoạt động bạn sẽ tham gia'}
            </div>
          </div>

          {isLocked && (
            <span
              style={{
                padding: '4px 10px',
                background: '#fef2f2',
                color: '#dc2626',
                borderRadius: '12px',
                fontSize: '0.8rem',
                fontWeight: 700,
                border: '1px solid #fecaca',
              }}
            >
              ĐÃ KHÓA ĐĂNG KÝ
            </span>
          )}
        </div>

        {currentUser ? (
          <div>
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--primary-light, #eff6ff)',
                color: 'var(--primary, #1e40af)',
                borderRadius: 'var(--radius-md)',
                marginBottom: '16px',
                fontSize: '0.9rem',
                fontWeight: 600,
              }}
            >
              👤 Đang đăng ký cho thành viên: <strong>{currentUser.fullName}</strong>
            </div>

            {errorMessage && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--danger-bg)',
                  color: 'var(--danger-text)',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '16px',
                  fontSize: '0.9rem',
                }}
              >
                {errorMessage}
              </div>
            )}

            {saveSuccessMsg && (
              <div
                style={{
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  color: '#16a34a',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '16px',
                  fontSize: '0.9rem',
                  fontWeight: 600,
                  border: '1px solid #bbf7d0',
                }}
              >
                {saveSuccessMsg}
              </div>
            )}

            <form onSubmit={handleSaveRsvp}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                {activities.map((act) => {
                  const state = selectedRsvps[act.id] || { selected: false, count: 1 };
                  return (
                    <div
                      key={act.id}
                      style={{
                        border: state.selected ? '2px solid var(--primary)' : '1px solid var(--border-color)',
                        background: state.selected ? 'var(--bg-card)' : 'var(--bg-card-subtle, #fafafa)',
                        borderRadius: 'var(--radius-md)',
                        padding: '14px 16px',
                        transition: 'all 0.15s ease-in-out',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: isLocked ? 'not-allowed' : 'pointer', flex: 1, minWidth: '220px' }}>
                          <input
                            type="checkbox"
                            checked={state.selected}
                            disabled={isLocked}
                            onChange={() => handleToggleActivity(act.id)}
                            style={{ width: '18px', height: '18px', cursor: isLocked ? 'not-allowed' : 'pointer' }}
                          />
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
                              {act.title}
                            </div>
                            {act.description && (
                              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                {act.description}
                              </div>
                            )}
                          </div>
                        </label>

                        {state.selected && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '170px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                              Số người tham gia:
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              disabled={isLocked}
                              value={state.count}
                              onChange={(e) => handleCountChange(act.id, parseInt(e.target.value, 10))}
                              style={{
                                width: '64px',
                                padding: '6px 8px',
                                borderRadius: 'var(--radius-sm)',
                                border: '1px solid var(--border-color)',
                                textAlign: 'center',
                                fontWeight: 700,
                                fontSize: '0.95rem',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
                * "Số người tham gia" đã bao gồm chính bạn và người thân / gia đình đi cùng.
              </div>

              {!isLocked && (
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', padding: '12px', fontSize: '1rem', fontWeight: 700 }}
                  disabled={saving}
                >
                  {saving ? 'Đang lưu đăng ký...' : '💾 LƯU ĐĂNG KÝ THAM GIA HOẠT ĐỘNG'}
                </button>
              )}
            </form>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>👋</div>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>Bạn chưa đăng nhập</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '16px' }}>
              Vui lòng đăng nhập hoặc đăng ký tài khoản thành viên để đăng ký các hoạt động bạn sẽ tham gia.
            </p>
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={onGoToLogin}>
                Đăng nhập ngay
              </button>
              <button className="btn btn-outline" onClick={onGoToRegister}>
                Đăng ký tài khoản mới
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Public Participation List */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title" style={{ fontSize: '1.3rem' }}>
              👥 Danh sách thành viên tham gia từng hoạt động
            </h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Công khai danh sách và tổng số người tham dự của từng hoạt động
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {activities.map((act) => {
            return (
              <div
                key={act.id}
                style={{
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  padding: '16px',
                  background: 'var(--bg-card)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px', marginBottom: '12px' }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--primary)' }}>
                      {act.title}
                    </h3>
                    {act.description && (
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                        {act.description}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      background: 'var(--primary-light, #eff6ff)',
                      color: 'var(--primary, #1e40af)',
                      padding: '4px 12px',
                      borderRadius: '16px',
                      fontWeight: 700,
                      fontSize: '0.95rem',
                    }}
                  >
                    Tổng cộng: {act.total_participants} người
                  </div>
                </div>

                {act.participants.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
                    {act.participants.map((p, idx) => (
                      <div
                        key={idx}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                          background: 'var(--bg-card-subtle, #f8fafc)',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border-color)',
                          fontSize: '0.9rem',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                          {p.full_name} {p.disambiguator ? `(${p.disambiguator})` : ''}
                        </span>
                        <span
                          style={{
                            fontWeight: 700,
                            color: 'var(--primary)',
                            fontSize: '0.85rem',
                          }}
                        >
                          {p.participant_count} người
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 0' }}>
                    Chưa có thành viên nào đăng ký hoạt động này.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
