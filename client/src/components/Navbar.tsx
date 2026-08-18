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

  const navItems = [
    { id: 'home', label: 'Trang chủ' },
    { id: 'activities', label: 'Kế hoạch & Hoạt động' },
    { id: 'lucky-wheel', label: '🎡 Quay số may mắn' },
    { id: 'contribute', label: 'Đóng quỹ' },
    { id: 'contributors', label: 'Đóng góp' },
    { id: 'expenses', label: 'Chi tiêu' },
    { id: 'settlement', label: 'Quyết toán' },
  ];

  if (currentUser && currentUser.role === 'ADMIN') {
    navItems.push({ id: 'admin', label: 'Quản trị' });
  }

  return (
    <header className="navbar">
      {/* DESKTOP PERSONALIZED BAR (Visible only on desktop >= 768px when logged in) */}
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
          <span className="brand-icon">🎓</span>
          <div className="brand-text-group">
            <span className="brand-main-title">Lớp A1 — Khóa 48</span>
            <span className="brand-sub-title">2013–2016 • THPT Văn Lâm</span>
          </div>
        </a>

        {/* DESKTOP NAVIGATION LINKS */}
        <nav className="desktop-nav-links" aria-label="Menu chính">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`nav-link ${currentTab === item.id ? 'active' : ''} ${item.id === 'lucky-wheel' ? 'nav-link-wheel' : ''}`}
              onClick={() => handleNavClick(item.id)}
            >
              {item.label}
            </button>
          ))}

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

        {/* MOBILE HAMBURGER TOGGLE BUTTON */}
        <button
          className={`navbar-toggle ${mobileMenuOpen ? 'open' : ''}`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label={mobileMenuOpen ? 'Đóng menu' : 'Mở menu điều hướng'}
          aria-expanded={mobileMenuOpen}
        >
          <span className="hamburger-box">
            <span className="hamburger-inner" />
          </span>
        </button>
      </div>

      {/* MOBILE DROPDOWN / DRAWER */}
      {mobileMenuOpen && (
        <div className="mobile-nav-drawer" role="dialog" aria-modal="true">
          {/* Logged in member status card on mobile */}
          {currentUser && (
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
          )}

          {/* Navigation Links list */}
          <nav className="mobile-nav-list">
            {navItems.map((item) => (
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

          {/* Mobile Auth Actions */}
          <div className="mobile-auth-actions">
            {currentUser ? (
              <button className="btn btn-danger btn-block" onClick={handleLogoutClick}>
                🚪 Đăng xuất
              </button>
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
        </div>
      )}
    </header>
  );
};
