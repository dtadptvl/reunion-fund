import React from 'react';

interface FooterProps {
  onSelectTab: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onSelectTab }) => {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          © 2026 Kỷ Niệm 10 Năm Ngày Ra Trường — Quỹ Lớp Minh Bạch
        </div>
        <div>
          <button
            onClick={() => onSelectTab('login')}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '0.8rem',
              textDecoration: 'underline',
            }}
          >
            Quản trị thủ quỹ
          </button>
        </div>
      </div>
    </footer>
  );
};
