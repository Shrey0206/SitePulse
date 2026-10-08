import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Brand } from '../components/Brand';
import { useAuth } from '../state/hooks';

export function SignupPage() {
  const { signup } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signup(email, password, organizationName);
      navigate('/dashboard/monitors');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create account');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <Brand />
      <div className="auth-card">
        <h1>Create an account</h1>
        <p className="auth-card__sub">Your organization gets its own public status page.</p>

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="organizationName">Organization name</label>
            <input
              id="organizationName"
              required
              maxLength={120}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
              aria-describedby="org-hint"
            />
            {/* The slug determines the public status page URL, so it's worth saying up
                front rather than letting it be discovered later. */}
            <span className="field__hint" id="org-hint">
              Used for your status page address.
            </span>
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby="password-hint"
            />
            <span className="field__hint" id="password-hint">
              At least 8 characters.
            </span>
          </div>

          {error && (
            <p className="field__error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--lg" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-card__footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
