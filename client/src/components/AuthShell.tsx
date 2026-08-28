import React from 'react';
import schoolLogo from '../assets/school-logo.jpg';

export interface AuthShellProps {
  title: string;
  subtitle?: string;
  badgeText?: string;
  children: React.ReactNode;
  footerContent?: React.ReactNode;
  sideDescription?: string;
}

export const AuthShell: React.FC<AuthShellProps> = ({
  title,
  subtitle = 'Lớp A1 — Khóa 48 (2013–2016) — Trường THPT Văn Lâm',
  badgeText = 'KỶ NIỆM 10 NĂM RA TRƯỜNG',
  children,
  footerContent,
  sideDescription = 'Cổng thông tin đóng quỹ, quản lý thu chi và tham gia chương trình quay số may mắn kỷ niệm 10 năm ngày ra trường.',
}) => {
  return (
    <div className="auth-shell-wrapper">
      <div className="auth-shell-card">
        {/* Left / Top Branding & Context Panel */}
        <div className="auth-shell-brand-panel">
          <img src={schoolLogo} alt="Logo Trường THPT Văn Lâm" className="auth-shell-logo" />
          <div className="auth-shell-badge">{badgeText}</div>
          <h2 className="auth-shell-brand-title">LỚP A1 — KHÓA 48</h2>
          <div className="auth-shell-school">Trường THPT Văn Lâm (2013–2016)</div>
          
          <p className="auth-shell-desc">{sideDescription}</p>

          <div className="auth-shell-highlights">
            <div className="auth-highlight-item">
              <span className="auth-highlight-icon">✨</span>
              <span>100% Minh bạch thu chi</span>
            </div>
            <div className="auth-highlight-item">
              <span className="auth-highlight-icon">🎡</span>
              <span>Quay số may mắn Gala</span>
            </div>
            <div className="auth-highlight-item">
              <span className="auth-highlight-icon">🤝</span>
              <span>Hội ngộ bạn bè 10 năm</span>
            </div>
          </div>
        </div>

        {/* Right / Main Functional Form Panel */}
        <div className="auth-shell-form-panel">
          <div className="auth-form-header">
            <h1 className="auth-form-title">{title}</h1>
            <div className="auth-form-subtitle">{subtitle}</div>
          </div>

          <div className="auth-form-body">{children}</div>

          {footerContent && <div className="auth-form-footer">{footerContent}</div>}
        </div>
      </div>
    </div>
  );
};
