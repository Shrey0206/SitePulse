/**
 * Hand-written OpenAPI 3.1 document.
 *
 * Deliberately not generated from Zod via a converter: one more dependency to justify,
 * and the interesting parts of this API (the two auth schemes, why webhook secrets appear
 * exactly once, what a 429 means) are prose that no schema converter would produce. The
 * cost is that it can drift from the code -- a schema test asserts every registered route
 * appears here, so drift fails the build rather than going unnoticed.
 */

const errorResponse = {
  type: 'object',
  properties: {
    success: { type: 'boolean', enum: [false] },
    error: {
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
      },
      required: ['code', 'message'],
    },
  },
  required: ['success', 'error'],
} as const;

function success(dataSchema: object) {
  return {
    type: 'object',
    properties: {
      success: { type: 'boolean', enum: [true] },
      data: dataSchema,
    },
    required: ['success', 'data'],
  };
}

function jsonResponse(description: string, schema: object) {
  return { description, content: { 'application/json': { schema } } };
}

const errorRef = { $ref: '#/components/schemas/Error' };

const commonErrors = {
  400: jsonResponse('Validation failed', errorRef),
  401: jsonResponse('Missing or invalid credentials', errorRef),
  404: jsonResponse('Not found, or belongs to another organization', errorRef),
  429: jsonResponse('Rate limit exceeded', errorRef),
};

const monitorSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    organizationId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    url: { type: 'string', format: 'uri' },
    intervalSeconds: { type: 'integer', minimum: 10, maximum: 86400 },
    timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
    expectedStatus: { type: 'integer', minimum: 100, maximum: 599 },
    failureThreshold: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: 'Consecutive failed checks required before the monitor is declared down.',
    },
    recoveryThreshold: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: 'Consecutive successful checks required before a down monitor is declared up again.',
    },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

const incidentSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    monitorId: { type: 'string', format: 'uuid', nullable: true },
    source: {
      type: 'string',
      enum: ['auto', 'manual'],
      description:
        'auto incidents are opened and resolved by the checker and cannot be edited; manual incidents are operator-declared and never fire alerts.',
    },
    title: { type: 'string' },
    description: { type: 'string', nullable: true },
    startedAt: { type: 'string', format: 'date-time' },
    resolvedAt: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'SitePulse API',
    version: '1.0.0',
    description: [
      'Uptime monitoring and incident management API.',
      '',
      '## Authentication',
      '',
      'Two schemes, for two different callers:',
      '',
      '- **bearerAuth** — a short-lived (~15 min) JWT access token for interactive dashboard',
      '  sessions. Obtained from `/auth/login` or `/auth/signup` and refreshed via',
      '  `/auth/refresh`, which reads an httpOnly cookie.',
      '- **apiKeyAuth** — a long-lived `sp_live_...` key for programmatic access, sent as',
      '  `X-API-Key`. Full-access within its organization and non-expiring until revoked.',
      '',
      'They are kept in separate headers so the two credential types can never be confused.',
      'Key management endpoints accept only a session token, so a leaked key cannot mint',
      'further keys.',
      '',
      '## Multi-tenancy',
      '',
      'Every request is scoped to the caller\'s organization. A resource belonging to another',
      'organization returns 404, not 403 — the API never confirms that an id it cannot show',
      'you exists.',
      '',
      '## Rate limits',
      '',
      'Session traffic is limited per IP, programmatic traffic per API key. Responses carry',
      '`RateLimit-*` headers; exceeding a limit returns 429.',
    ].join('\n'),
  },
  servers: [{ url: '/api/v1', description: 'Version 1' }],
  tags: [
    { name: 'Auth', description: 'Signup, login, token refresh and logout' },
    { name: 'Monitors', description: 'CRUD for monitored endpoints' },
    { name: 'Incidents', description: 'Auto-detected and manually declared incidents' },
    { name: 'Alerts', description: 'Notification channels and delivery log' },
    { name: 'API Keys', description: 'Programmatic access credentials' },
    { name: 'Status', description: 'Public, unauthenticated status pages' },
    { name: 'Realtime', description: 'Server-Sent Events for live dashboard updates' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Error: errorResponse,
      Monitor: monitorSchema,
      Incident: incidentSchema,
    },
  },
  security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
  paths: {
    '/auth/signup': {
      post: {
        tags: ['Auth'],
        summary: 'Create a user and their organization',
        description:
          'Creates the user and a new organization in one transaction. The organization slug is derived from its name and determines the public status page URL.',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'organizationName'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8, maxLength: 72 },
                  organizationName: { type: 'string', minLength: 1, maxLength: 120 },
                },
              },
            },
          },
        },
        responses: {
          201: jsonResponse(
            'Created. Sets an httpOnly refresh-token cookie scoped to /api/v1/auth.',
            success({ type: 'object' }),
          ),
          409: jsonResponse('Email already in use', errorRef),
          ...commonErrors,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Exchange credentials for an access token',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          200: jsonResponse('Authenticated', success({ type: 'object' })),
          ...commonErrors,
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh token and issue a new access token',
        description:
          'Reads the httpOnly refresh cookie; no request body. The presented token is rotated on use. Presenting an already-rotated token is treated as theft and revokes the entire token family, forcing re-login on every session descended from that login.',
        security: [],
        responses: {
          200: jsonResponse('Rotated', success({ type: 'object' })),
          401: jsonResponse('Missing, expired, revoked, or reused refresh token', errorRef),
        },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Revoke the current refresh token',
        description: 'Idempotent: succeeds whether or not a valid cookie was sent.',
        security: [],
        responses: { 200: jsonResponse('Logged out', success({ type: 'null' })) },
      },
    },
    '/organizations/me': {
      get: {
        tags: ['Auth'],
        summary: "Fetch the authenticated user's organization",
        responses: { 200: jsonResponse('The organization', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/monitors': {
      get: {
        tags: ['Monitors'],
        summary: 'List monitors',
        responses: {
          200: jsonResponse(
            'Monitors in the caller organization',
            success({
              type: 'object',
              properties: { monitors: { type: 'array', items: { $ref: '#/components/schemas/Monitor' } } },
            }),
          ),
          ...commonErrors,
        },
      },
      post: {
        tags: ['Monitors'],
        summary: 'Create a monitor',
        description: 'timeoutSeconds must not exceed intervalSeconds.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'url', 'intervalSeconds', 'timeoutSeconds'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 120 },
                  url: { type: 'string', format: 'uri', description: 'Must be http or https.' },
                  intervalSeconds: { type: 'integer', minimum: 10, maximum: 86400 },
                  timeoutSeconds: { type: 'integer', minimum: 1, maximum: 300 },
                  expectedStatus: { type: 'integer', default: 200 },
                  failureThreshold: { type: 'integer', default: 3 },
                  recoveryThreshold: { type: 'integer', default: 3 },
                },
              },
            },
          },
        },
        responses: {
          201: jsonResponse('Created', success({ type: 'object' })),
          ...commonErrors,
        },
      },
    },
    '/monitors/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Monitors'],
        summary: 'Fetch a monitor',
        responses: { 200: jsonResponse('The monitor', success({ type: 'object' })), ...commonErrors },
      },
      patch: {
        tags: ['Monitors'],
        summary: 'Update a monitor',
        description:
          'Partial update. A change that would make timeoutSeconds exceed the stored intervalSeconds is rejected with 400.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { 200: jsonResponse('Updated', success({ type: 'object' })), ...commonErrors },
      },
      delete: {
        tags: ['Monitors'],
        summary: 'Delete a monitor',
        responses: { 204: { description: 'Deleted' }, ...commonErrors },
      },
    },
    '/incidents': {
      get: {
        tags: ['Incidents'],
        summary: 'List incidents',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'resolved'] } },
          { name: 'monitorId', in: 'query', schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: jsonResponse(
            'Incidents, newest first',
            success({
              type: 'object',
              properties: { incidents: { type: 'array', items: { $ref: '#/components/schemas/Incident' } } },
            }),
          ),
          ...commonErrors,
        },
      },
      post: {
        tags: ['Incidents'],
        summary: 'Declare a manual incident',
        description:
          'Manual incidents are visible on the status page and timeline but never fire alerts. monitorId is optional -- omit it for an organization-wide event such as planned maintenance.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string', minLength: 1, maxLength: 200 },
                  description: { type: 'string', maxLength: 5000 },
                  monitorId: { type: 'string', format: 'uuid' },
                },
              },
            },
          },
        },
        responses: { 201: jsonResponse('Created', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/incidents/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      get: {
        tags: ['Incidents'],
        summary: 'Fetch an incident',
        responses: { 200: jsonResponse('The incident', success({ type: 'object' })), ...commonErrors },
      },
      patch: {
        tags: ['Incidents'],
        summary: 'Edit a manual incident',
        description:
          'Manual incidents only. Auto incidents are owned by the checker and return 404 here, since any hand edit would be overwritten on the next check.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: { 200: jsonResponse('Updated', success({ type: 'object' })), ...commonErrors },
      },
      delete: {
        tags: ['Incidents'],
        summary: 'Delete a manual incident',
        responses: { 204: { description: 'Deleted' }, ...commonErrors },
      },
    },
    '/incidents/{id}/resolve': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      post: {
        tags: ['Incidents'],
        summary: 'Resolve an incident',
        description:
          'Works on both auto and manual incidents. Resolving an auto incident whose monitor is still down is allowed, but the checker reopens a fresh incident on its next check -- monitor state, not this endpoint, is the source of truth.',
        responses: {
          200: jsonResponse('Resolved', success({ type: 'object' })),
          409: jsonResponse('Already resolved', errorRef),
          ...commonErrors,
        },
      },
    },
    '/alerts/channels': {
      get: {
        tags: ['Alerts'],
        summary: 'List notification channels',
        description: 'Webhook signing secrets are never returned here.',
        responses: { 200: jsonResponse('Channels', success({ type: 'object' })), ...commonErrors },
      },
      post: {
        tags: ['Alerts'],
        summary: 'Add a notification channel',
        description:
          'For type=webhook the response includes a one-time signing secret. It is stored encrypted and cannot be retrieved again.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'target'],
                properties: {
                  type: { type: 'string', enum: ['email', 'webhook'] },
                  target: { type: 'string', description: 'Email address, or webhook URL.' },
                  enabled: { type: 'boolean', default: true },
                },
              },
            },
          },
        },
        responses: { 201: jsonResponse('Created', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/alerts/channels/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      patch: {
        tags: ['Alerts'],
        summary: 'Enable or disable a channel',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { type: 'object', properties: { enabled: { type: 'boolean' } } } },
          },
        },
        responses: { 200: jsonResponse('Updated', success({ type: 'object' })), ...commonErrors },
      },
      delete: {
        tags: ['Alerts'],
        summary: 'Delete a channel',
        responses: { 204: { description: 'Deleted' }, ...commonErrors },
      },
    },
    '/alerts/deliveries': {
      get: {
        tags: ['Alerts'],
        summary: 'Alert delivery log',
        description:
          'Every attempted notification on both channels, successful or not, with the failure reason where applicable.',
        parameters: [
          { name: 'incidentId', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: { 200: jsonResponse('Deliveries', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/keys': {
      get: {
        tags: ['API Keys'],
        summary: 'List API keys',
        description: 'Returns key prefixes only; the keys themselves are stored hashed.',
        security: [{ bearerAuth: [] }],
        responses: { 200: jsonResponse('Keys', success({ type: 'object' })), ...commonErrors },
      },
      post: {
        tags: ['API Keys'],
        summary: 'Create an API key',
        description:
          'Session-authenticated only, so a leaked key cannot mint further keys. The plaintext key is returned exactly once.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
            },
          },
        },
        responses: { 201: jsonResponse('Created', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/keys/{id}': {
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      delete: {
        tags: ['API Keys'],
        summary: 'Revoke an API key',
        description: 'Revoked rather than deleted, so a key seen in logs stays identifiable.',
        security: [{ bearerAuth: [] }],
        responses: { 200: jsonResponse('Revoked', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/status/{slug}': {
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } }],
      get: {
        tags: ['Status'],
        summary: 'Public status page',
        description:
          'No authentication -- readable during an outage by people without accounts. Deliberately excludes monitor URLs, thresholds and internal identifiers, and reports the coarser operational/degraded/down rather than internal state-machine names.',
        security: [],
        responses: {
          200: jsonResponse('Current status', success({ type: 'object' })),
          404: jsonResponse('No organization with that slug', errorRef),
        },
      },
    },
    '/sse/ticket': {
      post: {
        tags: ['Realtime'],
        summary: 'Mint a single-use SSE ticket',
        description:
          "EventSource cannot send an Authorization header, so the stream is authenticated by a short-lived single-use ticket obtained here. Session tokens only -- API keys cannot open dashboard streams.",
        security: [{ bearerAuth: [] }],
        responses: { 201: jsonResponse('Ticket, valid ~30s', success({ type: 'object' })), ...commonErrors },
      },
    },
    '/sse': {
      get: {
        tags: ['Realtime'],
        summary: 'Live monitor status stream',
        description:
          'text/event-stream of monitor_status_changed, incident_opened and incident_resolved events for the caller organization. The server closes the connection after ~15 minutes and emits a reconnect event first; clients must mint a fresh ticket to reconnect, which is what stops a stream outliving a logout.',
        security: [],
        parameters: [{ name: 'ticket', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Event stream opened', content: { 'text/event-stream': {} } },
          401: jsonResponse('Missing, expired, or already-used ticket', errorRef),
        },
      },
    },
  },
} as const;
