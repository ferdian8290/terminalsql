import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAppStore } from './store/appStore';
import { api } from './utils/api';
import { LoginPage } from './components/Auth/LoginPage';
import { AppShell } from './components/Layout/AppShell';

export default function App() {
  const { user, setUser } = useAppStore();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => {
        localStorage.removeItem('terminalsql_token');
        setUser(null);
      })
      .finally(() => setLoading(false));

    // Native Desktop App Guard: Prevent mouse side buttons (Mouse 4/5 - Back/Forward)
    // and trackpad swipe back gestures from accidentally navigating away
    const handleMouseNavButtons = (e: MouseEvent) => {
      if (e.button === 3 || e.button === 4) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleKeyNav = (e: KeyboardEvent) => {
      // Prevent Alt + Left / Right browser history navigation
      if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
      }
    };

    // Lock history state
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
    };

    window.history.pushState(null, '', window.location.href);
    window.addEventListener('mouseup', handleMouseNavButtons, { capture: true });
    window.addEventListener('auxclick', handleMouseNavButtons, { capture: true });
    window.addEventListener('pointerdown', handleMouseNavButtons, { capture: true });
    window.addEventListener('keydown', handleKeyNav, { capture: true });
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('mouseup', handleMouseNavButtons, { capture: true });
      window.removeEventListener('auxclick', handleMouseNavButtons, { capture: true });
      window.removeEventListener('pointerdown', handleMouseNavButtons, { capture: true });
      window.removeEventListener('keydown', handleKeyNav, { capture: true });
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--color-bg)' }}>
        <div className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <LoginPage />}
      />
      <Route
        path="/*"
        element={user ? <AppShell /> : <Navigate to="/login" replace />}
      />
    </Routes>
  );
}
