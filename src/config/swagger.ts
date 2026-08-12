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
            avatarUrl: {
              type: 'string',
              nullable: true,
              description: 'Profile photo URL (Cloudinary). null → render initials.',
            },
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
        Workspace: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WorkspaceMembership: {
          type: 'object',
          description: "A workspace plus the caller's role in it.",
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        WorkspaceMember: {
          type: 'object',
          description: 'A member of a workspace (the user + their role).',
          properties: {
            userId: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] },
            createdAt: { type: 'string', format: 'date-time' },
            user: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                email: { type: 'string', format: 'email' },
                avatarUrl: { type: 'string', nullable: true },
              },
            },
          },
        },
        AdminStats: {
          type: 'object',
          description: 'Platform-wide aggregate metrics (Fritlow staff view).',
          properties: {
            users: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                verified: { type: 'integer' },
                newLast7Days: { type: 'integer' },
                newLast30Days: { type: 'integer' },
              },
            },
            workspaces: { type: 'object', properties: { total: { type: 'integer' } } },
            projects: {
              type: 'object',
              properties: {
                total: { type: 'integer' },
                byStatus: {
                  type: 'object',
                  properties: {
                    DRAFT: { type: 'integer' },
                    DISCOVERY: { type: 'integer' },
                    BLUEPRINT_COMPLETE: { type: 'integer' },
                    LAUNCHED: { type: 'integer' },
                  },
                },
                activeLast7Days: { type: 'integer' },
              },
            },
            discovery: {
              type: 'object',
              properties: {
                sessions: { type: 'integer' },
                completed: { type: 'integer' },
                completionRate: { type: 'integer', description: 'Percent 0-100' },
              },
            },
            blueprints: { type: 'object', properties: { generated: { type: 'integer' } } },
            recommendations: { type: 'object', properties: { total: { type: 'integer' } } },
            exports: { type: 'object', properties: { total: { type: 'integer' } } },
            generatedAt: { type: 'string', format: 'date-time' },
          },
        },
        AdminUserSummary: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            emailVerified: { type: 'boolean' },
            platformRole: { type: 'string', enum: ['USER', 'SUPPORT', 'SUPERADMIN'] },
            createdAt: { type: 'string', format: 'date-time' },
            projectCount: { type: 'integer' },
            workspaceCount: { type: 'integer' },
          },
        },
        AdminUserDetail: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            fullName: { type: 'string' },
            emailVerified: { type: 'boolean' },
            platformRole: { type: 'string', enum: ['USER', 'SUPPORT', 'SUPERADMIN'] },
            createdAt: { type: 'string', format: 'date-time' },
            workspaces: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['OWNER', 'ADMIN', 'MEMBER'] },
                  joinedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            projects: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  status: { type: 'string' },
                  workspaceId: { type: 'string', format: 'uuid' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            },
            activity: {
              type: 'object',
              properties: {
                projectCount: { type: 'integer' },
                lastProjectActivityAt: { type: 'string', format: 'date-time', nullable: true },
              },
            },
          },
        },
        GroupChannel: {
          type: 'object',
          description: 'A workspace team-chat channel. `hasUnread` is per requesting member.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string', nullable: true },
            workspaceId: { type: 'string', format: 'uuid' },
            createdById: { type: 'string', format: 'uuid', nullable: true },
            lastMessageAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            hasUnread: { type: 'boolean' },
          },
        },
        GroupMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            body: { type: 'string' },
            channelId: { type: 'string', format: 'uuid' },
            senderId: { type: 'string', format: 'uuid' },
            sender: {
              type: 'object',
              properties: { id: { type: 'string', format: 'uuid' }, fullName: { type: 'string' } },
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ChatMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            role: { type: 'string', enum: ['USER', 'ASSISTANT'] },
            content: { type: 'string' },
            conversationId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        ChatConversation: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string', nullable: true },
            lastMessageAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            messages: { type: 'array', items: { $ref: '#/components/schemas/ChatMessage' } },
          },
        },
        Notification: {
          type: 'object',
          description:
            'An in-app notification. Use `type` + `data` to build the click-through link. `readAt` null = unread.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: [
                'SUPPORT_REPLY',
                'WORKSPACE_INVITE',
                'COMMENT_REPLY',
                'COMMENT_ADDED',
                'RECOMMENDATION_CREATED',
              ],
            },
            title: { type: 'string' },
            body: { type: 'string', nullable: true },
            data: {
              type: 'object',
              nullable: true,
              description: 'Navigation context, e.g. { conversationId } or { projectId, sectionKey, commentId }',
              additionalProperties: true,
            },
            readAt: { type: 'string', format: 'date-time', nullable: true },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportMessage: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            body: { type: 'string' },
            senderType: { type: 'string', enum: ['USER', 'STAFF'] },
            senderId: { type: 'string', format: 'uuid' },
            sender: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
        SupportConversation: {
          type: 'object',
          description:
            'A support thread. `hasUnread` is computed for the requesting side (user vs staff). `customer` appears only on staff responses.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            subject: { type: 'string', nullable: true },
            status: { type: 'string', enum: ['OPEN', 'CLOSED'] },
            lastMessageAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            assignedAdminId: { type: 'string', format: 'uuid', nullable: true },
            hasUnread: { type: 'boolean' },
            customer: {
              type: 'object',
              nullable: true,
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                email: { type: 'string', format: 'email' },
              },
            },
          },
        },
        SupportConversationDetail: {
          allOf: [
            { $ref: '#/components/schemas/SupportConversation' },
            {
              type: 'object',
              properties: {
                messages: { type: 'array', items: { $ref: '#/components/schemas/SupportMessage' } },
              },
            },
          ],
        },
        Comment: {
          type: 'object',
          description: 'A comment on a blueprint section. `replies` holds nested thread replies.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            body: { type: 'string' },
            projectId: { type: 'string', format: 'uuid' },
            sectionKey: { type: 'string', example: 'business_model' },
            parentId: {
              type: 'string',
              format: 'uuid',
              nullable: true,
              description: 'The comment this one replies to; null for a top-level comment',
            },
            author: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
            replies: {
              type: 'array',
              description: 'Nested replies (present on list responses; empty for a fresh comment)',
              items: { $ref: '#/components/schemas/Comment' },
            },
          },
        },
        SearchResult: {
          type: 'object',
          description: 'One search hit. `type` tells the UI how to render/route it.',
          properties: {
            type: {
              type: 'string',
              enum: ['project', 'blueprint_section', 'decision', 'recommendation'],
            },
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            snippet: { type: 'string', description: 'Text window around the match' },
            projectId: { type: 'string', format: 'uuid' },
            projectName: { type: 'string' },
            sectionKey: {
              type: 'string',
              description: 'Only on blueprint_section results — for deep-linking',
            },
          },
        },
        SearchResults: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            counts: {
              type: 'object',
              properties: {
                project: { type: 'integer' },
                blueprint_section: { type: 'integer' },
                decision: { type: 'integer' },
                recommendation: { type: 'integer' },
                total: { type: 'integer' },
              },
            },
            results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } },
          },
        },
        WorkspaceInvitation: {
          type: 'object',
          description:
            'A pending invitation to an email with no Fritlow account yet. Consumed (→ membership) when that email registers.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['ADMIN', 'MEMBER'] },
            status: { type: 'string', enum: ['PENDING', 'ACCEPTED', 'REVOKED'] },
            workspaceId: { type: 'string', format: 'uuid' },
            invitedById: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            acceptedAt: { type: 'string', format: 'date-time', nullable: true },
          },
        },
        Template: {
          type: 'object',
          description: 'A create-project starting point for a product category.',
          properties: {
            id: { type: 'string', example: 'saas' },
            category: { type: 'string', example: 'SaaS' },
            name: { type: 'string', example: 'SaaS Starter' },
            description: { type: 'string' },
            prefillDiscoveryHints: {
              type: 'object',
              description: 'Map of discovery question id → category-specific hint',
              additionalProperties: { type: 'string' },
              example: { 'customer.who': 'Name the role and company size, not just an industry.' },
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
                avatarUrl: { type: 'string', nullable: true },
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
                answers: {
                  type: 'array',
                  description: 'Included on GET /discovery (absent on start). Each answer is a stored row; the JSONB `answer` holds the text and any AI follow-up.',
                  items: {
                    type: 'object',
                    properties: {
                      questionId: { type: 'string', example: 'problem.core' },
                      questionText: { type: 'string' },
                      module: { type: 'string', example: 'problem' },
                      answeredAt: { type: 'string', format: 'date-time' },
                      answer: {
                        type: 'object',
                        description: 'JSONB payload for this answer',
                        properties: {
                          text: { type: 'string', description: "The founder's main answer" },
                          confidence: {
                            type: 'integer',
                            nullable: true,
                            minimum: 0,
                            maximum: 100,
                            description: 'AI confidence meter (null if AI not configured)',
                          },
                          confidenceLabel: {
                            type: 'string',
                            nullable: true,
                            enum: ['LOW', 'MEDIUM', 'HIGH'],
                          },
                          followUp: {
                            type: 'object',
                            nullable: true,
                            description: 'Present only after a follow-up is generated',
                            properties: {
                              question: { type: 'string', description: 'The AI-generated follow-up question' },
                              answer: { type: 'string', nullable: true, description: "The founder's reply (null until sent via followUpAnswer)" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            answered: { type: 'integer', example: 3 },
            total: {
              type: 'integer',
              example: 12,
              description:
                'Number of questions in THIS project\'s tailored plan — varies per project (no longer a fixed 10).',
            },
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
            questions: {
              type: 'array',
              description:
                'The full tailored interview plan for this project (ordered). Generated by AI at session start from the founder\'s idea + category, then frozen. Render the whole interview from this. Falls back to a fixed base plan if AI was unavailable.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'problem.core' },
                  module: { type: 'string', example: 'problem' },
                  text: { type: 'string' },
                  hint: { type: 'string' },
                },
              },
            },
            modules: {
              type: 'array',
              description: 'Module breakdown of the plan (for the "Resume Interview" card): label, question count, and a rough time estimate per module, in order.',
              items: {
                type: 'object',
                properties: {
                  module: { type: 'string', example: 'business_model' },
                  label: { type: 'string', example: 'Business Model' },
                  questionCount: { type: 'integer', example: 3 },
                  estimatedMinutes: { type: 'integer', example: 8 },
                },
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
            updatedBy: {
              type: 'object',
              nullable: true,
              description: 'Who last edited this section (null for AI-generated content never hand-edited)',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                avatarUrl: { type: 'string', nullable: true },
              },
            },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        BlueprintSectionVersion: {
          type: 'object',
          description: 'A historical snapshot of a blueprint section (the content before an edit replaced it).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            versionNumber: { type: 'integer', example: 3 },
            sectionKey: { type: 'string', example: 'mvp_scope' },
            content: {
              type: 'object',
              properties: { markdown: { type: 'string' } },
            },
            editedBy: {
              type: 'object',
              nullable: true,
              description: 'The user whose edit replaced this content (null for AI-generated content never hand-edited)',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                avatarUrl: { type: 'string', nullable: true },
              },
            },
            isCurrent: {
              type: 'boolean',
              description: 'true for the FIRST item — the live current content, synthesized so the UI can show "Version N (Current)". false for past snapshots.',
            },
            createdAt: { type: 'string', format: 'date-time' },
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
            createdBy: {
              type: 'object',
              description: 'The user who logged this decision',
              properties: {
                id: { type: 'string', format: 'uuid' },
                fullName: { type: 'string' },
                email: { type: 'string', format: 'email' },
                avatarUrl: { type: 'string', nullable: true },
              },
            },
          },
        },
        Recommendation: {
          type: 'object',
          description: 'A durable, actionable insight from the AI Product Strategist.',
          properties: {
            id: { type: 'string', format: 'uuid' },
            type: {
              type: 'string',
              enum: ['PRICING', 'SCOPE', 'AUDIENCE', 'ONBOARDING', 'GENERAL'],
            },
            title: { type: 'string', example: "Pricing doesn't match target audience" },
            body: {
              type: 'string',
              description: 'Markdown: why it matters + what to do',
              example: '"Free, figure it out later" leaves value unvalidated. Charge early with a simple team plan and pre-sell a pilot.',
            },
            severity: { type: 'string', enum: ['INFO', 'WARNING', 'CRITICAL'] },
            status: { type: 'string', enum: ['OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'RESOLVED'] },
            sourceContext: {
              type: 'string',
              nullable: true,
              description: 'What triggered it, e.g. "blueprint.business_model" or "health.differentiation"',
              example: 'blueprint.business_model',
            },
            statusChangedAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'When the status last changed — use for "Dismissed on …" / "Resolved on …". null if never changed from OPEN.',
            },
            projectId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },
        HealthScore: {
          type: 'object',
          properties: {
            overall: { type: 'integer', minimum: 0, maximum: 100 },
            previousOverall: {
              type: 'integer',
              nullable: true,
              description: 'The overall score before this one (from history). null if this is the first score.',
            },
            delta: {
              type: 'integer',
              nullable: true,
              description: 'overall − previousOverall — drives the "+4.2% since last week" trend. null if no prior score.',
            },
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
        HealthScoreSnapshot: {
          type: 'object',
          description: 'One historical health-score computation (for the trend chart).',
          properties: {
            id: { type: 'string', format: 'uuid' },
            overall: { type: 'integer', minimum: 0, maximum: 100 },
            summary: { type: 'string', nullable: true },
            dimensions: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  label: { type: 'string' },
                  score: { type: 'integer' },
                  feedback: { type: 'string' },
                },
              },
            },
            createdAt: { type: 'string', format: 'date-time' },
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
