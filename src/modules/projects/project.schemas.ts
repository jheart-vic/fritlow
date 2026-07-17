import { z } from 'zod';

// Mirrors the ProjectStatus enum in prisma/schema.prisma.
export const projectStatusValues = ['DRAFT', 'DISCOVERY', 'BLUEPRINT_COMPLETE', 'LAUNCHED'] as const;

// The create-project wizard: name → one-line idea → category.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100),
  oneLineIdea: z.string().trim().min(1, 'One-line idea is required').max(300),
  category: z.string().trim().min(1).max(60).optional(),
  // Omit to use your personal workspace.
  workspaceId: z.uuid().optional(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    oneLineIdea: z.string().trim().min(1).max(300),
    category: z.string().trim().min(1).max(60).nullable(),
    status: z.enum(projectStatusValues),
  })
  .partial() // every field optional — send only what changes
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listProjectsQuerySchema = z.object({
  status: z.enum(projectStatusValues).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
