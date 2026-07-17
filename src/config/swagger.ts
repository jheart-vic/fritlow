import swaggerJsdoc from 'swagger-jsdoc';
import { env } from './env';

// swagger-jsdoc scans the route files for @openapi JSDoc blocks and merges
// them with the shared definitions below into one OpenAPI document.
// This document is the contract the frontend dev builds against.
export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Fritlow API',
      version: '0.1.0',
      description:
        'Backend API for Fritlow — the AI Product Operating System. ' +
        'Authenticate via `POST /api/v1/auth/login`, then click **Authorize** and paste the access token.',
    },
    servers: [{ url: `http://localhost:${env.PORT}`, description: 'Local development' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        AuthResult: {
          type: 'object',
          description:
            'The refresh token is NOT in the body — it is set as an httpOnly cookie ' +
            '(`fritlow_rt`, path=/api/v1/auth). Browsers send it automatically on ' +
            'refresh/logout; call those endpoints with credentials included.',
          properties: {
            user: { $ref: '#/components/schemas/User' },
            accessToken: {
              type: 'string',
              description:
                'Short-lived JWT (15m). Send as `Authorization: Bearer <token>`. ' +
                'Keep in memory (not localStorage); get a new one via POST /auth/refresh.',
            },
          },
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            oneLineIdea: { type: 'string' },
            category: { type: 'string', nullable: true },
            status: {
              type: 'string',
              enum: ['DRAFT', 'DISCOVERY', 'BLUEPRINT_COMPLETE', 'LAUNCHED'],
            },
            workspaceId: { type: 'string', format: 'uuid' },
            createdById: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' },
          },
        },
      },
      responses: {
        ValidationError: {
          description: 'Request body failed validation',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string', example: 'Validation failed' },
                  details: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        field: { type: 'string' },
                        message: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  // Where to look for @openapi JSDoc blocks.
  apis: ['./src/modules/**/*.routes.ts'],
});
