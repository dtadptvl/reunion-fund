import React from 'react';

interface FooterProps {
  onSelectTab: (tab: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onSelectTab }) => {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          © 2026 Lớp A1 — Khóa 48 (Niên khóa 2013–2016) — Kỷ Niệm 10 Năm Ra Trường
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
