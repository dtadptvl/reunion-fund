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
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải danh sách đóng góp...</div>;
  }

  const allContributors = [
    ...data.members.map((m) => ({ ...m, type: 'Thành viên lớp' })),
    ...data.external.map((e) => ({ ...e, type: 'Khách / Người ngoài' })),
  ];

  return (
    <div>
      <div className="card">
        <div className="card-header">
          <div>
            <h1 className="card-title">Danh Sách Đóng Góp Quỹ</h1>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '4px' }}>
              Danh sách được sắp xếp theo bảng chữ cái. Không xếp hạng, không phân biệt mức đóng góp.
            </div>
          </div>
          <div>
            <a href="/api/v1/public/export/xlsx" className="btn btn-outline" download>
              📥 Xuất Excel (XLSX)
            </a>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Họ và tên</th>
              <th>Phân loại</th>
              <th style={{ textAlign: 'center' }}>Số lần đóng</th>
              <th style={{ textAlign: 'right' }}>Tổng đã đóng</th>
            </tr>
          </thead>
          <tbody>
            {allContributors.map((person) => (
              <tr
                key={person.id}
                onClick={() => person.contribution_count > 0 && openHistory(person.id, person.full_name)}
                style={{ cursor: person.contribution_count > 0 ? 'pointer' : 'default' }}
              >
                <td>
                  <strong style={{ color: 'var(--text-main)' }}>{person.full_name}</strong>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal for Multiple Contributions History */}
      {selectedPerson && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '16px' }}>
          <div className="card" style={{ maxWidth: '500px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
            <div className="card-header">
              <h2 className="card-title">Lịch sử đóng góp: {selectedPerson.name}</h2>
              <button
                onClick={() => setSelectedPerson(null)}
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            {personHistory.length === 0 ? (
              <p>Đang tải chi tiết...</p>
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
