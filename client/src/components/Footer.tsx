import React from 'react';

interface FooterProps {
  currentUser?: any;
  onSelectTab: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ currentUser, onSelectTab }) => {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          © 2026 Lớp A1 — Khóa 48 (Niên khóa 2013–2016) — Trường THPT Văn Lâm — Kỷ Niệm 10 Năm Ra Trường
        </div>
        <div>
          {currentUser?.role === 'ADMIN' ? (
            <button onClick={() => onSelectTab('admin')} className="footer-link-btn">
              Bảng điều khiển Quản trị
            </button>
          ) : !currentUser ? (
            <button onClick={() => onSelectTab('login')} className="footer-link-btn">
              Đăng nhập
            </button>
          ) : null}
        </div>
      </div>
    </footer>
  );
};
