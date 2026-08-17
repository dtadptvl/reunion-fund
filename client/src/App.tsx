import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { Footer } from './components/Footer.js';
import { HomePage } from './pages/HomePage.js';
import { ContributePage } from './pages/ContributePage.js';
import { ContributorsPage } from './pages/ContributorsPage.js';
import { ExpensesPage } from './pages/ExpensesPage.js';
import { SettlementPage } from './pages/SettlementPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { AdminDashboardPage } from './pages/AdminDashboardPage.js';

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<string>('home');
  const [currentUser, setCurrentUser] = useState<any>(null);

  useEffect(() => {
    // Check existing session
    fetch('/api/v1/admin/me')
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
    await fetch('/api/v1/admin/logout', { method: 'POST' });
    setCurrentUser(null);
    setCurrentTab('home');
  };

  return (
    <div className="app-container">
      <Navbar currentTab={currentTab} onSelectTab={setCurrentTab} />

      <main className="main-content">
        {currentTab === 'home' && <HomePage onGoToContribute={() => setCurrentTab('contribute')} />}
        {currentTab === 'contribute' && <ContributePage />}
        {currentTab === 'contributors' && <ContributorsPage />}
        {currentTab === 'expenses' && <ExpensesPage />}
        {currentTab === 'settlement' && <SettlementPage />}
        {currentTab === 'login' && (
          currentUser ? (
            <AdminDashboardPage user={currentUser} onLogout={handleLogout} />
          ) : (
            <LoginPage
              onLoginSuccess={(user) => {
                setCurrentUser(user);
                setCurrentTab('admin');
              }}
            />
          )
        )}
        {currentTab === 'admin' && (
          currentUser ? (
            <AdminDashboardPage user={currentUser} onLogout={handleLogout} />
          ) : (
            <LoginPage
              onLoginSuccess={(user) => {
                setCurrentUser(user);
                setCurrentTab('admin');
              }}
            />
          )
        )}
      </main>

      <Footer onSelectTab={setCurrentTab} />
    </div>
  );
};
