import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { Footer } from './components/Footer.js';
import { HomePage } from './pages/HomePage.js';
import { ContributePage } from './pages/ContributePage.js';
import { ContributorsPage } from './pages/ContributorsPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { SettlementPage } from './pages/SettlementPage.js';
import { ActivitiesPage } from './pages/ActivitiesPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegisterPage } from './pages/RegisterPage.js';
import { VerifyEmailPage } from './pages/VerifyEmailPage.js';
import { AdminDashboardPage } from './pages/AdminDashboardPage.js';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [pendingVerifyEmail, setPendingVerifyEmail] = useState<string>('');

  useEffect(() => {
    // Check existing session on load
    fetch('/api/v1/auth/me')
      .then((res) => {
        if (res.ok) return res.json();
        return null;
      })
      .then((data) => {
        if (data?.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout error:', err);
    }
    setCurrentUser(null);
    setCurrentTab('home');
  };

  const handleRegisterSuccess = (email: string) => {
    setPendingVerifyEmail(email);
    setCurrentTab('verify-email');
  };

  const handleLoginSuccess = (user: any) => {
    setCurrentUser(user);
    if (user.role === 'ADMIN') {
      setCurrentTab('admin');
    } else {
      setCurrentTab('activities');
    }
  };

  return (
    <div className="app-container">
      <Navbar
        currentTab={currentTab}
        currentUser={currentUser}
        onSelectTab={setCurrentTab}
        onLogout={handleLogout}
      />

      <main className="main-content">
        {currentTab === 'home' && (
          <HomePage
            onGoToContribute={() => setCurrentTab('contribute')}
            onGoToActivities={() => setCurrentTab('activities')}
          />
        )}
        {currentTab === 'activities' && (
          <ActivitiesPage
            currentUser={currentUser}
            onGoToLogin={() => setCurrentTab('login')}
            onGoToRegister={() => setCurrentTab('register')}
          />
        )}
        {currentTab === 'contribute' && <ContributePage />}
        {currentTab === 'contributors' && <ContributorsPage />}
        {currentTab === 'expenses' && <ExpensesPage />}
        {currentTab === 'settlement' && <SettlementPage />}

        {currentTab === 'register' && (
          <RegisterPage
            onRegisterSuccess={handleRegisterSuccess}
            onGoToLogin={() => setCurrentTab('login')}
          />
        )}

        {currentTab === 'verify-email' && (
          <VerifyEmailPage
            initialEmail={pendingVerifyEmail}
            onVerificationSuccess={() => setCurrentTab('login')}
            onGoToLogin={() => setCurrentTab('login')}
          />
        )}

        {currentTab === 'login' && (
          currentUser ? (
            currentUser.role === 'ADMIN' ? (
              <AdminDashboardPage user={currentUser} onLogout={handleLogout} />
            ) : (
              <div style={{ maxWidth: '500px', margin: '60px auto', textAlign: 'center' }} className="card">
                <h2 style={{ color: 'var(--primary)', marginTop: 0 }}>Đã Đăng Nhập Thành Công</h2>
                <p>Xin chào <strong>{currentUser.fullName}</strong>!</p>
                <button className="btn btn-primary" onClick={() => setCurrentTab('home')}>
                  Về Trang Chủ
                </button>
              </div>
            )
          ) : (
            <LoginPage
              onLoginSuccess={handleLoginSuccess}
              onGoToRegister={() => setCurrentTab('register')}
              onGoToVerify={(email) => {
                if (email) setPendingVerifyEmail(email);
                setCurrentTab('verify-email');
              }}
            />
          )
        )}

        {currentTab === 'admin' && (
          currentUser ? (
            currentUser.role === 'ADMIN' ? (
              <AdminDashboardPage user={currentUser} onLogout={handleLogout} />
            ) : (
              <div style={{ maxWidth: '500px', margin: '60px auto', textAlign: 'center' }} className="card">
                <h2 style={{ color: 'var(--danger)', marginTop: 0 }}>Không Có Quyền Truy Cập</h2>
                <p>Bạn đang đăng nhập với vai trò thành viên ({currentUser.fullName}). Trang Quản trị chỉ dành cho Ban Quản trị lớp.</p>
                <button className="btn btn-primary" onClick={() => setCurrentTab('home')}>
                  Về Trang Chủ
                </button>
              </div>
            )
          ) : (
            <LoginPage
              onLoginSuccess={handleLoginSuccess}
              onGoToRegister={() => setCurrentTab('register')}
              onGoToVerify={(email) => {
                if (email) setPendingVerifyEmail(email);
                setCurrentTab('verify-email');
              }}
            />
          )
        )}
      </main>

      <Footer currentUser={currentUser} onSelectTab={setCurrentTab} />
    </div>
  );
};
