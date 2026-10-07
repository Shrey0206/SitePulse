import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { openApiDocument } from '../src/docs/openapi.js';

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
const METHODS: Method[] = ['get', 'post', 'patch', 'put', 'delete'];

interface DocumentedOperation {
  method: Method;
  path: string;
}

function documentedOperations(): DocumentedOperation[] {
  return Object.entries(openApiDocument.paths).flatMap(([path, operations]) =>
    METHODS.filter((method) => method in operations).map((method) => ({ method, path })),
  );
}

/** Substitutes a syntactically valid but nonexistent value for each path parameter. */
function toRequestPath(path: string): string {
  return `/api/v1${path
    .replace(/\{id\}/g, '00000000-0000-0000-0000-000000000000')
    .replace(/\{slug\}/g, 'no-such-org-slug')}`;
}

describe('OpenAPI document', () => {
  it('is served as raw JSON for SDK generation and Postman import', async () => {
    const res = await request(app).get('/api/v1/docs/openapi.json').expect(200);
    expect(res.body.openapi).toBe('3.1.0');
    expect(res.body.info.title).toBe('SitePulse API');
  });

  it('serves the Swagger UI without authentication', async () => {
    const res = await request(app).get('/api/v1/docs/').expect(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('declares both authentication schemes', () => {
    expect(Object.keys(openApiDocument.components.securitySchemes)).toEqual(['bearerAuth', 'apiKeyAuth']);
    expect(openApiDocument.components.securitySchemes.apiKeyAuth.name).toBe('X-API-Key');
  });

  /**
   * The check that makes a hand-written spec trustworthy: every documented operation is
   * actually called, and must not come back as an unrouted path.
   *
   * The app's 404 handler returns code NOT_FOUND, while a real handler that can't find a
   * row returns a specific code (MONITOR_NOT_FOUND, INCIDENT_NOT_FOUND, ...). That
   * distinction is what separates "this route doesn't exist" from "the route exists and
   * correctly reported a missing resource" -- so documenting a route that was renamed or
   * removed fails here.
   *
   * Probing real routes beats walking Express's router internals, which changed shape in
   * Express 5 and would tie this test to a private API.
   */
  it('documents only operations the app actually routes', async () => {
    const unrouted: string[] = [];

    for (const { method, path } of documentedOperations()) {
      const res = await request(app)[method](toRequestPath(path)).send({});

      if (res.status === 404 && res.body?.error?.code === 'NOT_FOUND') {
        unrouted.push(`${method.toUpperCase()} ${path}`);
      }
    }

    expect(unrouted).toEqual([]);
  });

  it('documents an auth requirement for every non-public operation', () => {
    // Endpoints reachable without credentials, each deliberately so.
    const publicOperations = new Set([
      'post /auth/signup',
      'post /auth/login',
      'post /auth/refresh',
      'post /auth/logout',
      'get /status/{slug}',
      'get /sse',
    ]);

    const missingAuth = documentedOperations()
      .filter(({ method, path }) => !publicOperations.has(`${method} ${path}`))
      .filter(({ method, path }) => {
        const operation = openApiDocument.paths[path as keyof typeof openApiDocument.paths] as Record<
          string,
          { security?: unknown[] }
        >;
        // Inherits the document-level default when absent, which requires auth.
        const security = operation[method]?.security;
        return security !== undefined && security.length === 0;
      })
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

    expect(missingAuth).toEqual([]);
  });

  it('marks genuinely public endpoints as requiring no authentication', () => {
    // security: [] overrides the document-level default.
    expect(openApiDocument.paths['/status/{slug}'].get.security).toEqual([]);
    expect(openApiDocument.paths['/auth/login'].post.security).toEqual([]);
  });

  it('restricts key management to session auth only', () => {
    // A leaked API key must not be able to mint further keys.
    expect(openApiDocument.paths['/keys'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/keys/{id}'].delete.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.paths['/sse/ticket'].post.security).toEqual([{ bearerAuth: [] }]);
  });

  it('gives every operation a summary and a tag, so the UI is navigable', () => {
    const incomplete = documentedOperations()
      .filter(({ method, path }) => {
        const operation = (
          openApiDocument.paths[path as keyof typeof openApiDocument.paths] as Record<
            string,
            { summary?: string; tags?: readonly string[] }
          >
        )[method];
        return !operation?.summary || !operation.tags?.length;
      })
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);

    expect(incomplete).toEqual([]);
  });
});
