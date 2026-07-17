import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { swaggerSpec } from './config/swagger';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { discoveryRouter } from './modules/discovery/discovery.routes';
import { projectRouter } from './modules/projects/project.routes';

// app.ts builds the Express app (middleware + routes) without starting it,
// so tests can import the app without opening a network port.
export const app = express();

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

app.use(notFoundHandler);
app.use(errorHandler);
