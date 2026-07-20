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
            emailVerified: { type: 'boolean' },
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
            createdBy: {
              type: 'object',
              description: 'The user who created the project',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        DiscoveryProgress: {
          type: 'object',
          properties: {
            session: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                projectId: { type: 'string', format: 'uuid' },
                status: { type: 'string', enum: ['ACTIVE', 'COMPLETED', 'ABANDONED'] },
                startedAt: { type: 'string', format: 'date-time' },
                completedAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
            answered: { type: 'integer', example: 3 },
            total: { type: 'integer', example: 10 },
            nextQuestion: {
              type: 'object',
              nullable: true,
              description: 'null once every question is answered',
              properties: {
                id: { type: 'string', example: 'customer.who' },
                module: { type: 'string', example: 'customer' },
                text: { type: 'string' },
                hint: { type: 'string' },
              },
            },
          },
        },
        BlueprintSection: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            key: { type: 'string', example: 'problem_statement' },
            title: { type: 'string', example: 'Problem Statement' },
            order: { type: 'integer' },
            content: {
              type: 'object',
              properties: { markdown: { type: 'string' } },
            },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        Blueprint: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['GENERATING', 'READY', 'FAILED'] },
            generatedAt: { type: 'string', format: 'date-time', nullable: true },
            sections: {
              type: 'array',
              items: { $ref: '#/components/schemas/BlueprintSection' },
            },
          },
        },
        Decision: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            reasoning: { type: 'string' },
            status: { type: 'string', enum: ['ACTIVE', 'REVISED', 'REVERSED'] },
            decidedAt: { type: 'string', format: 'date-time' },
            projectId: { type: 'string', format: 'uuid' },
            createdById: { type: 'string', format: 'uuid' },
          },
        },
        HealthScore: {
          type: 'object',
          properties: {
            overall: { type: 'integer', minimum: 0, maximum: 100 },
            summary: { type: 'string', nullable: true },
            dimensions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string', example: 'problem_clarity' },
                  label: { type: 'string', example: 'Problem Clarity' },
                  score: { type: 'integer', minimum: 0, maximum: 100 },
                  feedback: { type: 'string' },
                },
              },
            },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        NextAction: {
          type: 'object',
          nullable: true,
          properties: {
            type: {
              type: 'string',
              enum: [
                'START_DISCOVERY',
                'CONTINUE_DISCOVERY',
                'COMPLETE_DISCOVERY',
                'GENERATE_BLUEPRINT',
                'REVIEW_BLUEPRINT',
                'CELEBRATE',
              ],
            },
            label: { type: 'string', example: 'Continue the interview (4/10 answered)' },
            projectId: { type: 'string', format: 'uuid' },
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
        RateLimited: {
          description:
            'Too many requests — rate limit exceeded. The `Retry-After` header ' +
            '(seconds) and the `RateLimit-*` headers tell the client when to try again.',
          headers: {
            'Retry-After': {
              description: 'Seconds to wait before retrying',
              schema: { type: 'integer' },
            },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
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
