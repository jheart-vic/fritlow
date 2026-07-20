import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { blueprintRouter } from './modules/blueprints/blueprint.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { decisionRouter } from './modules/decisions/decision.routes';
import { discoveryRouter } from './modules/discovery/discovery.routes';
import { exportRouter } from './modules/exports/export.routes';
import { healthScoreRouter } from './modules/health/health.routes';
import { projectRouter } from './modules/projects/project.routes';

// app.ts builds the Express app (middleware + routes) without starting it,
// so tests can import the app without opening a network port.
export const app = express();

// Behind a proxy (Render/Nginx) the real client IP is in X-Forwarded-For, not
// the socket. Tell Express how many hops to trust so req.ip — and therefore the
// rate limiter's per-client buckets — reflect the actual caller. 0 (default,
// local dev) means "trust no proxy, use the socket address".
if (env.TRUST_PROXY_HOPS > 0) {
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
}

// Security headers, cross-origin access for the frontend, JSON body parsing.
// credentials: true lets the browser send the httpOnly refresh cookie, which
// in turn requires an explicit origin allowlist (the '*' wildcard is refused
// by browsers when credentials are involved).
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Interactive API documentation.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/docs.json', (_req, res) => res.json(swaggerSpec));

// Feature modules — every new module gets one line here.
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/projects', projectRouter);
app.use('/api/v1/projects/:projectId/discovery', discoveryRouter);
app.use('/api/v1/projects/:projectId/blueprint', blueprintRouter);
app.use('/api/v1/projects/:projectId/decisions', decisionRouter);
app.use('/api/v1/projects/:projectId/export', exportRouter);
app.use('/api/v1/projects/:projectId/health-score', healthScoreRouter);
app.use('/api/v1/dashboard', dashboardRouter);

app.use(notFoundHandler);
app.use(errorHandler);
