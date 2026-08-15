import { randomBytes } from 'node:crypto';

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
  return base || 'org';
}

export function randomSlugSuffix(): string {
  return randomBytes(3).toString('hex');
}
