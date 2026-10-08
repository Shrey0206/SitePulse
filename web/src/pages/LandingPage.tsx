import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { StatusBadge } from '../components/StatusBadge';
import { StatusHeroIcon } from '../components/StatusHeroIcon';
import { useAuth } from '../state/hooks';
import './landing.css';

/**
 * Everything on this page describes behaviour the codebase actually has. The product
 * visuals are built from the real components and labelled as sample data; there are no
 * customer logos, statistics or testimonials, because there are no customers or statistics
 * to put there.
 */

const FEATURES: { title: string; body: string; icon: React.ReactNode }[] = [
  {
    title: 'Checks on your schedule',
    body: 'Watch any HTTP or HTTPS endpoint as often as every 10 seconds, with your own timeout and the status code you expect back.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    title: 'No false alarms',
    body: 'An outage is only declared after the number of failures in a row that you choose, and only cleared after the same for recovery. One slow response never wakes anyone.',
    icon: (
      <>
        <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6l-7-3Z" />
        <path d="m9 12 2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Incidents that run themselves',
    body: 'An incident opens when a monitor goes down and resolves when it recovers, with a timeline of exactly when each happened.',
    icon: (
      <>
        <path d="M12 3 2.5 20h19L12 3Z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
  },
  {
    title: 'Alerts where you already are',
    body: 'Send alerts to Discord, Slack or any endpoint as a signed webhook. One message when an incident opens and one when it resolves, never one per failed check.',
    icon: (
      <>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2Z" />
        <path d="M10 21h4" />
      </>
    ),
  },
  {
    title: 'A public status page',
    body: 'Every organization gets its own status page with live status, 24-hour uptime for each service and the last two weeks of incidents.',
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" />
      </>
    ),
  },
  {
    title: 'Built to be scripted',
    body: 'A REST API with API keys and a full OpenAPI 3.1 spec with Swagger UI. The dashboard updates live over server-sent events, no refresh needed.',
    icon: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />,
  },
];

const STEPS = [
  {
    title: 'Add an endpoint',
    body: 'Paste a URL, pick how often to check it and how many failures in a row mean it is really down.',
  },
  {
    title: 'Get told when it breaks',
    body: 'Connect Discord, Slack or a webhook. You are alerted when the incident opens, and again when it resolves.',
  },
  {
    title: 'Share your status page',
    body: 'Send customers to your public page instead of answering "is it down?" one message at a time.',
  },
];

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function LandingPage() {
  const { status } = useAuth();
  const signedIn = status === 'authenticated';

  useEffect(() => {
    document.title = 'SitePulse: uptime monitoring and public status pages';
    return () => {
      document.title = 'SitePulse';
    };
  }, []);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-container lp-nav__inner">
          <Link to="/" aria-label="SitePulse home">
            <Brand />
          </Link>

          <nav className="lp-nav__links" aria-label="Page sections">
            <a href="#features">Features</a>
            <a href="#alerts">Alerts</a>
            <a href="#how">How it works</a>
            <a href="/api/v1/docs">API docs</a>
          </nav>

          <div className="lp-nav__actions">
            {signedIn ? (
              <Link to="/dashboard/monitors" className="btn btn--primary">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="lp-nav__signin">
                  Sign in
                </Link>
                <Link to="/signup" className="btn btn--primary">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Hero ---------- */}
        <section className="lp-hero">
          <div className="lp-container">
            <p className="lp-eyebrow">Uptime monitoring and public status pages</p>
            <h1>
              Know when your site goes down.
              <span>Before your users do.</span>
            </h1>
            <p className="lp-hero__sub">
              SitePulse checks your endpoints on a schedule, opens an incident when they fail, and
              alerts you on Discord, Slack or a signed webhook. Your public status page keeps itself
              up to date.
            </p>
            <div className="lp-cta">
              {signedIn ? (
                <Link to="/dashboard/monitors" className="btn btn--primary btn--lg">
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link to="/signup" className="btn btn--primary btn--lg">
                    Get started
                  </Link>
                  <Link to="/login" className="btn btn--lg">
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="lp-container">
            <figure className="lp-figure">
              <div
                className="lp-window"
                role="img"
                aria-label="Example SitePulse dashboard: three monitors, one of them down, with an open incident"
              >
                <div className="lp-window__bar" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="lp-window__body" aria-hidden="true">
                  <div className="lp-side">
                    <div className="lp-side__brand">
                      <Brand size="sm" />
                    </div>
                    <span className="lp-side__item lp-side__item--active">Monitors</span>
                    <span className="lp-side__item">Incidents</span>
                    <span className="lp-side__item">Alerts</span>
                    <span className="lp-side__item">Settings</span>
                  </div>

                  <div className="lp-pane">
                    <div className="lp-pane__head">
                      <div>
                        <div className="lp-pane__title">Monitors</div>
                        <div className="lp-pane__sub">
                          Endpoints checked on a schedule. Status updates live.
                        </div>
                      </div>
                    </div>

                    <div className="lp-table">
                      {[
                        {
                          name: 'Marketing site',
                          url: 'https://example.com',
                          status: 'up',
                          every: '30s',
                          seen: '12s ago',
                        },
                        {
                          name: 'Checkout API',
                          url: 'https://api.example.com/health',
                          status: 'down',
                          every: '10s',
                          seen: '4s ago',
                        },
                        {
                          name: 'Documentation',
                          url: 'https://docs.example.com',
                          status: 'up',
                          every: '1m',
                          seen: '38s ago',
                        },
                      ].map((row) => (
                        <div key={row.name} className="lp-table__row">
                          <div className="lp-table__name">
                            <strong>{row.name}</strong>
                            <span>{row.url}</span>
                          </div>
                          <StatusBadge status={row.status === 'down' ? 'down' : 'up'} />
                          <span className="lp-table__cell">{row.every}</span>
                          <span className="lp-table__cell lp-table__cell--seen">{row.seen}</span>
                        </div>
                      ))}
                    </div>

                    <div className="lp-incident">
                      <span className="incident__dot incident__dot--ongoing" />
                      <div>
                        <strong>Checkout API is down</strong>
                        <span>Ongoing for 4m · alert sent to Discord</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <figcaption>
                Sample data, built from SitePulse&rsquo;s own dashboard components.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* ---------- Features ---------- */}
        <section className="lp-section" id="features" aria-labelledby="features-title">
          <div className="lp-container">
            <h2 id="features-title" className="lp-h2">
              Everything you need to stay on top of an outage
            </h2>
            <p className="lp-lede">Small enough to understand, complete enough to rely on.</p>

            <div className="lp-grid">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="lp-feature">
                  <span className="lp-feature__icon">
                    <Icon>{feature.icon}</Icon>
                  </span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Alerts spotlight ---------- */}
        <section className="lp-section lp-section--tint" id="alerts" aria-labelledby="alerts-title">
          <div className="lp-container lp-split">
            <div>
              <h2 id="alerts-title" className="lp-h2 lp-h2--left">
                Alerts that say something, once
              </h2>
              <p className="lp-lede lp-lede--left">
                You get a message when an incident opens and another when it resolves. Not one for
                every failed check.
              </p>
              <ul className="lp-checks">
                <li>Native Discord and Slack messages, with colour and the details you need.</li>
                <li>
                  Signed webhooks (HMAC-SHA256) for anything else, so you can verify they came from
                  you.
                </li>
                <li>Discord and Slack webhook URLs are stored encrypted and never shown again.</li>
                <li>Every attempt is logged, including the reason when one fails.</li>
              </ul>
            </div>

            <div
              className="lp-discord"
              role="img"
              aria-label="Example Discord alerts: Checkout API is DOWN, then Checkout API has RECOVERED"
            >
              <div aria-hidden="true">
                {[
                  {
                    tone: 'down',
                    title: '🔴 Checkout API is DOWN',
                    desc: 'Not responding as expected.',
                    time: '11:40 PM',
                  },
                  {
                    tone: 'up',
                    title: '🟢 Checkout API has RECOVERED',
                    desc: 'Responding normally again.',
                    time: '11:52 PM',
                  },
                ].map((message) => (
                  <div key={message.title} className="lp-discord__msg">
                    <span className="lp-discord__avatar">S</span>
                    <div className="lp-discord__content">
                      <div className="lp-discord__who">
                        <strong>SitePulse</strong>
                        <span className="lp-discord__tag">APP</span>
                        <span className="lp-discord__time">Today at {message.time}</span>
                      </div>
                      <div className={`lp-discord__embed lp-discord__embed--${message.tone}`}>
                        <div className="lp-discord__title">{message.title}</div>
                        <div className="lp-discord__desc">{message.desc}</div>
                        <div className="lp-discord__fields">
                          <div>
                            <b>URL</b>
                            <span>https://api.example.com/health</span>
                          </div>
                          <div>
                            <b>Incident</b>
                            <span>3f9c2a1e-…</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Status page spotlight ---------- */}
        <section className="lp-section" aria-labelledby="status-title">
          <div className="lp-container lp-split lp-split--reverse">
            <div
              className="lp-statusmock"
              role="img"
              aria-label="Example public status page showing a degraded overall status and one service down"
            >
              <div aria-hidden="true">
                <div className="lp-statusmock__org">Acme Cloud</div>
                <div className="status-hero status-hero--degraded">
                  <StatusHeroIcon status="degraded" />
                  <div>
                    <h3>Degraded performance</h3>
                    <p>Some services are not responding as expected.</p>
                  </div>
                </div>
                <div className="card">
                  {[
                    { name: 'Marketing site', up: 100, status: 'up' },
                    { name: 'Checkout API', up: 98.4, status: 'down' },
                  ].map((service) => (
                    <div key={service.name} className="service-row">
                      <div>
                        <div className="service-row__name">{service.name}</div>
                      </div>
                      <div className="service-row__right">
                        <span className="uptime-meter">
                          <span
                            className="uptime-meter__fill"
                            style={{
                              width: `${service.up}%`,
                              background: service.up >= 99 ? 'var(--success)' : 'var(--warning)',
                            }}
                          />
                        </span>
                        <span className="service-row__uptime">{service.up}%</span>
                        <span className="service-row__status">
                          <StatusBadge status={service.status === 'down' ? 'down' : 'up'} />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <h2 id="status-title" className="lp-h2 lp-h2--left">
                A status page your customers can trust
              </h2>
              <p className="lp-lede lp-lede--left">
                Every account comes with a public page at{' '}
                <span className="mono">/status/your-organization</span>. It reads the same checks
                that drive your alerts, so it can&rsquo;t drift out of date.
              </p>
              <ul className="lp-checks">
                <li>Overall status at a glance, with an icon as well as a colour.</li>
                <li>24-hour uptime and last-checked time for every service.</li>
                <li>The last two weeks of incidents, ongoing or resolved.</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- How it works ---------- */}
        <section className="lp-section lp-section--tint" id="how" aria-labelledby="how-title">
          <div className="lp-container">
            <h2 id="how-title" className="lp-h2">
              Up and running in a few minutes
            </h2>
            <ol className="lp-steps">
              {STEPS.map((step, index) => (
                <li key={step.title}>
                  <span className="lp-steps__num" aria-hidden="true">
                    {index + 1}
                  </span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Final call to action ---------- */}
        <section className="lp-final" aria-labelledby="final-title">
          <div className="lp-container">
            <h2 id="final-title" className="lp-h2">
              Find out first
            </h2>
            <p className="lp-lede">
              Create an account, add your first endpoint, and have a status page live today.
            </p>
            <div className="lp-cta">
              {signedIn ? (
                <Link to="/dashboard/monitors" className="btn btn--primary btn--lg">
                  Open dashboard
                </Link>
              ) : (
                <Link to="/signup" className="btn btn--primary btn--lg">
                  Create your account
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer__inner">
          <Brand size="sm" />
          <nav aria-label="Footer">
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <a href="/api/v1/docs">API docs</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
