import React, { useState } from 'react';
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavClick = (tab: string) => {
    onSelectTab(tab);
    setMobileMenuOpen(false);
  };

  const handleLogoutClick = () => {
    onLogout();
    setMobileMenuOpen(false);
  };

  // Authoritative Navigation Order & Vietnamese Labels
  const primaryNavItems = [
    { id: 'home', label: 'Trang chủ' },
    { id: 'activities', label: 'Kế hoạch và hoạt động' },
    { id: 'contribute', label: 'Đóng quỹ hoạt động' },
    { id: 'contributors', label: 'Danh sách đóng góp' },
    { id: 'expenses', label: 'Danh sách chi tiêu' },
    { id: 'lucky-wheel', label: 'Quay số may mắn' },
    { id: 'settlement', label: 'Quyết toán' },
  ];

  return (
    <header className="navbar">
      {/* DESKTOP PERSONALIZED BAR (Visible on wide screens >= 1150px when logged in) */}
      {currentUser && (
        <div className="desktop-member-bar">
          <div className="desktop-member-bar-content">
            <div className="member-identity-group">
              <span className="member-name-badge">
                👤 {currentUser.fullName} {currentUser.role === 'ADMIN' ? '(Admin)' : ''}
              </span>
              <span className="member-bar-divider">•</span>
              <span className="member-metric">
                Đã đóng: <strong>{formatVND(currentUser.totalContributed || 0)}</strong>
              </span>
              <span className="member-bar-divider">•</span>
              <span className="member-metric">
                Tỷ lệ quay thưởng: <strong className="lottery-pct">{currentUser.lotteryProbabilityDisplay || '0%'}</strong>
              </span>
            </div>
            <div className="member-notice-text">
              * 6.000.000 ₫ quỹ lớp nền không tham gia quay thưởng
            </div>
          </div>
        </div>
      )}

      {/* PRIMARY NAVBAR ROW */}
      <div className="navbar-inner">
        {/* Brand Identity */}
        <a
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            handleNavClick('home');
          }}
          className="brand-logo"
        >
          <span className="brand-icon" aria-hidden="true">🎓</span>
          <div className="brand-text-group">
            <span className="brand-main-title">Lớp A1 — Khóa 48</span>
            <span className="brand-sub-title">2013–2016 • THPT Văn Lâm</span>
          </div>
        </a>

        {/* DESKTOP NAVIGATION LINKS (Visible on wide screens >= 1150px) */}
        <nav className="desktop-nav-links" aria-label="Menu chính">
          {primaryNavItems.map((item) => (
            <button
              key={item.id}
              className={`nav-link ${currentTab === item.id ? 'active' : ''} ${item.id === 'lucky-wheel' ? 'nav-link-wheel' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              {item.label}
            </button>
          ))}

          {/* ADMIN ONLY BUTTON */}
          {currentUser && currentUser.role === 'ADMIN' && (
            <button
              className={`nav-link ${currentTab === 'admin' ? 'active' : ''}`}
              onClick={() => handleNavClick('admin')}
              style={{ fontWeight: 700, color: 'var(--primary)' }}
            >
              Quản trị
            </button>
          )}

          {/* Desktop Auth Controls */}
          {currentUser ? (
            <button className="nav-link nav-link-logout" onClick={handleLogoutClick}>
              Đăng xuất
            </button>
          ) : (
            <div className="desktop-auth-buttons">
              <button
                className={`nav-link ${currentTab === 'register' ? 'active' : ''}`}
                onClick={() => handleNavClick('register')}
              >
                Đăng ký
              </button>
              <button
                className={`btn btn-primary btn-sm ${currentTab === 'login' ? 'active' : ''}`}
                onClick={() => handleNavClick('login')}
              >
                Đăng nhập
              </button>
            </div>
          )}
        </nav>

        {/* MOBILE / RESPONSIVE HAMBURGER TOGGLE BUTTON */}
        <button
          className={`navbar-toggle ${mobileMenuOpen ? 'open' : ''}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu điều hướng'}
          aria-expanded={mobileMenuOpen}
        >
          <svg
            className="navbar-toggle-icon"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {mobileMenuOpen ? (
              <>
                <line x1="5" y1="5" x2="19" y2="19" />
                <line x1="19" y1="5" x2="5" y2="19" />
              </>
            ) : (
              <>
                <line x1="3" y1="5" x2="21" y2="5" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="19" x2="21" y2="19" />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* MOBILE DROPDOWN / DRAWER */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer" role="dialog" aria-modal="true">
          {/* 1. Primary Navigation List (Order matches Section 2 exactly) */}
          <nav className="mobile-nav-list">
            {primaryNavItems.map((item) => (
              <button
                key={item.id}
                className={`mobile-nav-item ${currentTab === item.id ? 'active' : ''} ${item.id === 'lucky-wheel' ? 'wheel-highlight' : ''}`}
                onClick={() => handleNavClick(item.id)}
              >
                <span>{item.label}</span>
                <span className="mobile-nav-arrow">›</span>
              </button>
            ))}
          </nav>

          {/* 2. Admin Control (ADMIN only) */}
          {currentUser && currentUser.role === 'ADMIN' && (
            <div className="mobile-admin-section">
              <button
                className={`mobile-nav-item admin-highlight ${currentTab === 'admin' ? 'active' : ''}`}
                onClick={() => handleNavClick('admin')}
              >
                <span>⚙️ Quản trị hệ thống</span>
                <span className="mobile-nav-arrow">›</span>
              </button>
            </div>
          )}

          <div className="mobile-nav-divider" />

          {/* 3. Separated User/Account Area */}
          {currentUser ? (
            <div className="mobile-account-area">
              <div className="mobile-member-card">
                <div className="mobile-member-header">
                  <span className="mobile-member-avatar">👤</span>
                  <div className="mobile-member-info">
                    <div className="mobile-member-name">
                      {currentUser.fullName}
                      {currentUser.role === 'ADMIN' && <span className="admin-badge">Admin</span>}
                    </div>
                    <div className="mobile-member-username">@{currentUser.username}</div>
                  </div>
                </div>

                <div className="mobile-member-metrics">
                  <div className="mobile-metric-box">
                    <div className="mobile-metric-label">Đã đóng</div>
                    <div className="mobile-metric-value text-primary">
                      {formatVND(currentUser.totalContributed || 0)}
                    </div>
                  </div>
                  <div className="mobile-metric-box">
                    <div className="mobile-metric-label">Tỷ lệ quay thưởng</div>
                    <div className="mobile-metric-value text-success">
                      {currentUser.lotteryProbabilityDisplay || '0%'}
                    </div>
                  </div>
                </div>
              </div>

              <button className="btn btn-danger btn-block" onClick={handleLogoutClick}>
                🚪 Đăng xuất
              </button>
            </div>
          ) : (
            <div className="mobile-auth-guest-grid">
              <button
                className="btn btn-outline btn-block"
                onClick={() => handleNavClick('register')}
              >
                Đăng ký tài khoản
              </button>
              <button
                className="btn btn-primary btn-block"
                onClick={() => handleNavClick('login')}
              >
                Đăng nhập
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
