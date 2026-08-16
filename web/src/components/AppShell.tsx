import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../state/hooks';
import { ConnectionBanner } from './ConnectionBanner';

const NAV = [
  { to: '/dashboard/monitors', label: 'Monitors' },
  { to: '/dashboard/incidents', label: 'Incidents' },
  { to: '/dashboard/alerts', label: 'Alerts' },
  { to: '/dashboard/settings', label: 'Settings' },
];

export function AppShell() {
  const { organization, logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main">
        <div className="sidebar__brand">
          <span className="sidebar__pulse" aria-hidden="true" />
          SitePulse
        </div>

        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} className="sidebar__link">
            {item.label}
          </NavLink>
        ))}

        <div className="sidebar__footer">
          {organization && (
            <>
              <div style={{ color: 'var(--text-muted)' }}>{organization.name}</div>
              {/* The public status page URL is worth surfacing -- it's the org's
                  customer-facing artifact and otherwise undiscoverable. */}
              <a href={`/status/${organization.slug}`} target="_blank" rel="noreferrer">
                View status page ↗
              </a>
            </>
          )}
        </div>
      </nav>

      <div className="main">
        <ConnectionBanner />
        <header className="topbar">
          <span className="faint" style={{ fontSize: 12 }}>
            {organization ? `/status/${organization.slug}` : ''}
          </span>
          <button type="button" className="btn btn--sm" onClick={() => void logout()}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
