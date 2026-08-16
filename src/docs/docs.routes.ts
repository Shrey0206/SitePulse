import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

export const docsRouter = Router();

// The raw document, so clients can generate SDKs or import it into Postman/Insomnia
// without scraping the UI.
docsRouter.get('/openapi.json', (_req, res) => {
  res.json(openApiDocument);
});

docsRouter.use('/', swaggerUi.serve);
docsRouter.get(
  '/',
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: 'SitePulse API',
    swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
  }),
);
