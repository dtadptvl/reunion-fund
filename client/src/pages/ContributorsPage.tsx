import React, { useEffect, useState } from 'react';
import { formatVND, formatDateVN } from '../utils/format.js';

export const ContributorsPage: React.FC = () => {
  const [data, setData] = useState<{ members: any[]; external: any[] }>({ members: [], external: [] });
  const [loading, setLoading] = useState(true);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const [personHistory, setPersonHistory] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/v1/public/contributors')
      .then((res) => res.json())
      .then((resData) => {
        setData(resData);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const openHistory = (personId: string, personName: string) => {
    setSelectedPerson({ id: personId, name: personName });
    fetch(`/api/v1/public/contributors/${personId}`)
      .then((res) => res.json())
      .then((resData) => setPersonHistory(resData.contributions || []))
      .catch((err) => console.error(err));
  };

  if (loading) {
    return (
      <div className="page-loading">
        <div className="spinner" aria-hidden="true" />
        <span>Đang tải danh sách đóng góp...</span>
      </div>
    );
  }

  const getDisplayName = (p: any) =>
    `${p.full_name}${p.disambiguator ? ` (${p.disambiguator})` : ''}`;

  const allContributors = [
    ...data.members.map((m) => ({ ...m, type: 'Thành viên lớp', displayName: getDisplayName(m) })),
    ...data.external.map((e) => ({ ...e, type: 'Khách / Người ngoài', displayName: getDisplayName(e) })),
  ];

  return (
    <div>
      {/* LOTTERY FORMULA & INFO BANNER */}
      <div
        className="card"
        style={{
          background: 'linear-gradient(135deg, var(--brand-50) 0%, var(--primary-bg) 100%)',
          borderColor: 'var(--brand-200)',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>🎁</span>
          <div>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '1.05rem', color: 'var(--primary-text)', fontWeight: 700 }}>
              Công Thức Tính Tỷ Lệ Quay Thưởng
            </h3>
            <p style={{ margin: '0 0 6px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--primary)' }}>
              Tỷ lệ quay thưởng = Tổng đóng góp của bạn / Tổng đóng góp hợp lệ của các thành viên
            </p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              * <strong>6.000.000 ₫</strong> quỹ lớp nền không tham gia quay thưởng. Chỉ các khoản đóng góp tự nguyện hợp lệ của thành viên lớp mới được tính vào trọng số quay thưởng.
            </p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header" style={{ flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 className="card-title">Danh Sách Đóng Góp Quỹ & Tỷ Lệ Quay Thưởng</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Danh sách được sắp xếp theo bảng chữ cái. Không xếp hạng, không phân biệt mức đóng góp.
            </div>
          </div>
          <div>
            <a href="/api/v1/public/export/xlsx" className="btn btn-outline btn-sm" download>
              📥 Xuất Excel (XLSX)
            </a>
          </div>
        </div>

        {/* DESKTOP TABLE VIEW (>= 768px) */}
        <div className="responsive-table-desktop">
          <table className="data-table">
            <thead>
              <tr>
                <th>Họ và tên</th>
                <th>Phân loại</th>
                <th style={{ textAlign: 'center' }}>Số lần đóng</th>
                <th style={{ textAlign: 'right' }}>Tổng đã đóng</th>
                <th style={{ textAlign: 'right' }}>Tỷ lệ quay thưởng</th>
              </tr>
            </thead>
            <tbody>
              {allContributors.map((person) => (
                <tr
                  key={person.id}
                  onClick={() => person.contribution_count > 0 && openHistory(person.id, person.displayName)}
                  style={{ cursor: person.contribution_count > 0 ? 'pointer' : 'default' }}
                >
                  <td>
                    <strong style={{ color: 'var(--text-main)' }}>{person.displayName}</strong>
                  </td>
                  <td>
                    <span className={`badge ${person.type === 'Thành viên lớp' ? 'badge-neutral' : 'badge-warning'}`}>
                      {person.type}
                    </span>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {person.contribution_count > 0 ? (
                      <span className="badge badge-success">{person.contribution_count} lần</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Chưa đóng</span>
                    )}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: person.total_contributed > 0 ? 'var(--primary)' : 'var(--text-muted)' }}>
                    {person.total_contributed > 0 ? formatVND(person.total_contributed) : '0 ₫'}
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: person.lottery_probability > 0 ? 'var(--income)' : 'var(--text-muted)' }}>
                    {person.type === 'Thành viên lớp' ? (person.lottery_probability_display || '0%') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* MOBILE STACKED CARDS VIEW (< 768px) */}
        <div className="responsive-cards-mobile">
          {allContributors.map((person) => (
            <div
              key={person.id}
              className="contributor-mobile-card"
              onClick={() => person.contribution_count > 0 && openHistory(person.id, person.displayName)}
              style={{ cursor: person.contribution_count > 0 ? 'pointer' : 'default' }}
            >
              <div className="contributor-card-header">
                <div className="contributor-card-name">{person.displayName}</div>
                <span className={`badge badge-sm ${person.type === 'Thành viên lớp' ? 'badge-neutral' : 'badge-warning'}`}>
                  {person.type}
                </span>
              </div>

              <div className="contributor-card-metrics">
                <div className="card-metric-col">
                  <div className="metric-sublabel">Đã đóng</div>
                  <div className="metric-main-val text-primary">
                    {person.total_contributed > 0 ? formatVND(person.total_contributed) : '0 ₫'}
                  </div>
                </div>

                <div className="card-metric-col" style={{ textAlign: 'right' }}>
                  <div className="metric-sublabel">Tỷ lệ quay thưởng</div>
                  <div className="metric-main-val text-success">
                    {person.type === 'Thành viên lớp' ? (person.lottery_probability_display || '0%') : '—'}
                  </div>
                </div>
              </div>

              <div className="contributor-card-footer">
                {person.contribution_count > 0 ? (
                  <span className="badge badge-success badge-sm">
                    ✓ {person.contribution_count} lần đóng (chạm xem chi tiết)
                  </span>
                ) : (
                  <span className="badge badge-neutral badge-sm">Chưa đóng</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modal for Multiple Contributions History */}
      {selectedPerson && (
        <div className="modal-backdrop" onClick={() => setSelectedPerson(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h2 className="card-title" style={{ fontSize: '1.15rem' }}>Lịch sử đóng góp: {selectedPerson.name}</h2>
              <button
                onClick={() => setSelectedPerson(null)}
                className="btn-icon"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            {personHistory.length === 0 ? (
              <p style={{ padding: '16px 0', color: 'var(--text-muted)' }}>Đang tải chi tiết...</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th style={{ textAlign: 'right' }}>Số tiền</th>
                  </tr>
                </thead>
                <tbody>
                  {personHistory.map((item) => (
                    <tr key={item.id}>
                      <td>{formatDateVN(item.created_at)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                        +{formatVND(item.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
