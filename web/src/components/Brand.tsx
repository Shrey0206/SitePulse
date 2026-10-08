/** The SitePulse wordmark with its pulsing status dot, for pages outside the dashboard shell. */
export function Brand({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <span className={`brand brand--${size}`}>
      <span className="brand__pulse" aria-hidden="true" />
      SitePulse
    </span>
  );
}
