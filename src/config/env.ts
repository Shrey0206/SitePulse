import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: requireEnv('DATABASE_URL'),
  jwtSecret: requireEnv('JWT_SECRET'),
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),

  smtpHost: process.env.SMTP_HOST ?? 'localhost',
  smtpPort: Number(process.env.SMTP_PORT ?? 1025),
  smtpUser: process.env.SMTP_USER,
  smtpPassword: process.env.SMTP_PASSWORD,
  smtpFrom: process.env.SMTP_FROM ?? 'alerts@sitepulse.local',

  // AES-256-GCM key for webhook secrets at rest (DECISIONS.md #23), hex-encoded 32 bytes.
  // Optional so the app still boots without webhooks configured; webhook creation fails
  // loudly rather than silently storing an unencrypted secret if it's missing.
  webhookSecretKey: process.env.WEBHOOK_SECRET_KEY,
};
