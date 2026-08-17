import React from 'react';
import { formatVND } from '../utils/format.js';

interface NavbarProps {
  currentTab: string;
  currentUser: any;
  onSelectTab: (tab: string) => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  currentUser,
  onSelectTab,
  onLogout,
}) => {
  return (
    <header className="navbar">
      {/* PERSONALIZED TOP BAR FOR LOGGED-IN MEMBERS/ADMINS */}
      {currentUser && (
        <div
          style={{
            background: 'linear-gradient(90deg, #1e3a8a 0%, #2563eb 100%)',
            color: '#ffffff',
            padding: '6px 16px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '8px',
            borderBottom: '1px solid rgba(255,255,255,0.15)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600 }}>
              👤 {currentUser.fullName} {currentUser.role === 'ADMIN' ? '(Admin)' : ''}
            </span>
            <span style={{ opacity: 0.6 }}>|</span>
            <span>
              Đã đóng: <strong style={{ color: '#fef08a' }}>{formatVND(currentUser.totalContributed || 0)}</strong>
            </span>
            <span style={{ opacity: 0.6 }}>|</span>
            <span>
              Tỷ lệ quay thưởng: <strong style={{ color: '#86efac' }}>{currentUser.lotteryProbabilityDisplay || '0%'}</strong>
            </span>
          </div>
          <div style={{ fontSize: '0.78rem', opacity: 0.85 }}>
            * 6.000.000 ₫ quỹ lớp nền không tham gia quay thưởng
          </div>
        </div>
      )}

      <div className="navbar-inner">
        <a href="#home" onClick={() => onSelectTab('home')} className="brand-logo">
          🎓 Lớp A1 — Khóa 48 (2013–2016)
        </a>
        <nav className="nav-links" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <button
            className={`btn-link nav-link ${currentTab === 'home' ? 'active' : ''}`}
            onClick={() => onSelectTab('home')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Trang chủ
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'activities' ? 'active' : ''}`}
            onClick={() => onSelectTab('activities')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
          >
            Kế hoạch & Hoạt động
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'voting' ? 'active' : ''}`}
            onClick={() => onSelectTab('voting')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: '#f59e0b' }}
          >
            🏆 Bình chọn
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'lucky-wheel' ? 'active' : ''}`}
            onClick={() => onSelectTab('lucky-wheel')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, color: '#ec4899' }}
          >
            🎡 Quay số
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'contribute' ? 'active' : ''}`}
            onClick={() => onSelectTab('contribute')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Đóng quỹ
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'contributors' ? 'active' : ''}`}
            onClick={() => onSelectTab('contributors')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Đóng góp
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'expenses' ? 'active' : ''}`}
            onClick={() => onSelectTab('expenses')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Chi tiêu
          </button>
          <button
            className={`btn-link nav-link ${currentTab === 'settlement' ? 'active' : ''}`}
            onClick={() => onSelectTab('settlement')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Quyết toán
          </button>

          {/* ADMIN-ONLY NAVIGATION */}
          {currentUser && currentUser.role === 'ADMIN' && (
            <button
              className={`btn-link nav-link ${currentTab === 'admin' ? 'active' : ''}`}
              onClick={() => onSelectTab('admin')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: 'var(--primary)' }}
            >
              Quản trị
            </button>
          )}

          {/* AUTH STATUS BUTTONS */}
          {currentUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '6px' }}>
              <button
                className="btn-link nav-link"
                onClick={onLogout}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                }}
              >
                Đăng xuất
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}>
              <button
                className={`btn-link nav-link ${currentTab === 'register' ? 'active' : ''}`}
                onClick={() => onSelectTab('register')}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Đăng ký
              </button>
              <button
                className={`btn-link nav-link ${currentTab === 'login' ? 'active' : ''}`}
                onClick={() => onSelectTab('login')}
                style={{
                  background: 'none',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  padding: '4px 12px',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Đăng nhập
              </button>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};
