import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AlertsPage } from './pages/AlertsPage';
import { IncidentsPage } from './pages/IncidentsPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { MonitorsPage } from './pages/MonitorsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SignupPage } from './pages/SignupPage';
import { StatusPage } from './pages/StatusPage';
import { AuthProvider } from './state/AuthContext';
import { LiveProvider } from './state/LiveContext';
import { useAuth } from './state/hooks';

/**
 * Blocks rendering only while the silent refresh on page load is still in flight.
 * Redirecting immediately would bounce an authenticated user to /login on every hard
 * refresh, since the access token is memory-only and starts empty.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  if (status === 'restoring') {
    return (
      <div className="state" aria-busy="true">
        <span className="sr-only">Restoring your session…</span>
      </div>
    );
  }

  if (status === 'anonymous') return <Navigate to="/login" replace />;

  return <>{children}</>;
}

function DashboardRoutes() {
  const { status } = useAuth();

  return (
    // The SSE connection is only opened once authenticated -- minting a ticket requires a
    // valid access token, so connecting earlier would just fail and back off.
    <LiveProvider enabled={status === 'authenticated'}>
      <AppShell />
    </LiveProvider>
  );
}

function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  if (status === 'restoring') return null;
  if (status === 'authenticated') return <Navigate to="/dashboard/monitors" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public: no auth, and outside the dashboard shell entirely. The landing page is
            shown to everyone, signed in or not; it adapts its buttons rather than redirecting. */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/status/:slug" element={<StatusPage />} />

        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <LoginPage />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/signup"
          element={
            <RedirectIfAuthenticated>
              <SignupPage />
            </RedirectIfAuthenticated>
          }
        />

        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardRoutes />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard/monitors" replace />} />
          <Route path="monitors" element={<MonitorsPage />} />
          <Route path="incidents" element={<IncidentsPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard/monitors" replace />} />
      </Routes>
    </AuthProvider>
  );
}
