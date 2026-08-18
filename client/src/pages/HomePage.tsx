import React, { useEffect, useState } from 'react';
import { formatVND, formatDateVN, getCategoryLabelVN } from '../utils/format.js';
import { FundGoalProgress } from '../components/FundGoalProgress.js';

interface HomePageProps {
  onGoToContribute: () => void;
  onGoToActivities?: () => void;
}

export const HomePage: React.FC<HomePageProps> = ({ onGoToContribute, onGoToActivities }) => {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/public/overview')
      .then((res) => res.json())
      .then((data) => {
        setOverview(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Lỗi tải dữ liệu:', err);
        setLoading(false);
      });
  }, []);

  if (loading || !overview) {
    return <div style={{ textAlign: 'center', padding: '60px' }}>Đang tải dữ liệu quỹ lớp...</div>;
  }

  return (
    <div>
      {/* Hero Section */}
      <section className="hero-card">
        <div className="hero-subtitle">KỶ NIỆM 10 NĂM RA TRƯỜNG</div>
        <h1 className="hero-title">{overview.eventTitle || 'LỚP A1 — KHÓA 48'}</h1>
        <div style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '16px' }}>
          Niên khóa 2013–2016 — Trường THPT Văn Lâm
        </div>

        <div style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>SỐ DƯ QUỸ HIỆN TẠI</div>
        <div className="hero-balance">{formatVND(overview.balance)}</div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '24px' }}>
          <button className="btn btn-primary btn-lg" onClick={onGoToContribute}>
            💳 ĐÓNG QUỸ NGAY
          </button>
          {onGoToActivities && (
            <button className="btn btn-outline btn-lg" onClick={onGoToActivities}>
              📋 KẾ HOẠCH & ĐĂNG KÝ
            </button>
          )}
        </div>

        <div className="stats-grid">
          <div className="stat-box">
            <div className="stat-label">Tổng đã thu</div>
            <div className="stat-value income">{formatVND(overview.totalIncome)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Tổng đã chi</div>
            <div className="stat-value expense">{formatVND(overview.totalExpense)}</div>
          </div>
          <div className="stat-box">
            <div className="stat-label">Người đã đóng góp</div>
            <div className="stat-value">{overview.contributorCount} thành viên</div>
          </div>
        </div>

        {/* Fund Goal Progress Section */}
        <FundGoalProgress
          totalIncome={overview.totalIncome}
          suggestedAmount={overview.suggestedAmount}
          targetAmount={overview.fundGoal?.targetAmount}
        />
      </section>

      {/* Grid: Recent Contributions & Recent Expenses */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        {/* Recent Contributions */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Đóng góp gần đây</h2>
          </div>
          {overview.recentContributions?.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Chưa có khoản đóng góp nào.</div>
          ) : (
            <table className="data-table">
              <tbody>
                {overview.recentContributions.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.contributor_name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{formatDateVN(item.created_at)}</div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--primary)' }}>
                      +{formatVND(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Recent Expenses */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Chi tiêu gần đây</h2>
          </div>
          {overview.recentExpenses?.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Chưa có khoản chi tiêu nào.</div>
          ) : (
            <table className="data-table">
              <tbody>
                {overview.recentExpenses.map((item: any) => (
                  <tr key={item.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.title}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <span className="badge badge-neutral" style={{ marginRight: '6px' }}>
                          {getCategoryLabelVN(item.category)}
                        </span>
                        {formatDateVN(item.created_at)}
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>
                      -{formatVND(item.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
