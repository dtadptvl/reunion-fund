import React from 'react';

interface NavbarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onSelectTab }) => {
  return (
    <header className="navbar">
      <div className="navbar-inner">
        <a href="#home" onClick={() => onSelectTab('home')} className="brand-logo">
          🎓 Quỹ Kỷ Niệm 10 Năm
        </a>
        <nav className="nav-links">
          <button
            className={`btn-link nav-link ${currentTab === 'home' ? 'active' : ''}`}
            onClick={() => onSelectTab('home')}
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Trang chủ
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
        </nav>
      </div>
    </header>
  );
};
