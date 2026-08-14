import { z } from 'zod';

// Mirrors the ProjectStatus enum in prisma/schema.prisma.
export const projectStatusValues = ['DRAFT', 'DISCOVERY', 'BLUEPRINT_COMPLETE', 'LAUNCHED'] as const;

// The create-project wizard: name → one-line idea → category.
export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Project name is required').max(100),
  oneLineIdea: z.string().trim().min(1, 'One-line idea is required').max(300),
  category: z.string().trim().min(1).max(60).optional(),
  // Omit to use your default workspace (User.defaultWorkspaceId).
  workspaceId: z.uuid().optional(),
});

// Move several projects into one workspace in a single call — the granular
// alternative to converting a whole private workspace to shared. The cap keeps
// one request from locking a large slice of the projects table; it is generous
// next to any realistic selection in the UI.
export const moveProjectsSchema = z.object({
  projectIds: z
    .array(z.uuid())
    .min(1, 'Select at least one project to move')
    .max(50, 'You can move at most 50 projects at a time'),
  targetWorkspaceId: z.uuid(),
});

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    oneLineIdea: z.string().trim().min(1).max(300),
    category: z.string().trim().min(1).max(60).nullable(),
    status: z.enum(projectStatusValues),
    // Move the project to another workspace — this CHANGES WHO CAN SEE IT
    // (membership is workspace-wide), so it needs OWNER/ADMIN on both sides.
    workspaceId: z.uuid(),
  })
  .partial() // every field optional — send only what changes
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  });

export const listProjectsQuerySchema = z.object({
  status: z.enum(projectStatusValues).optional(),
  // Scope the list to one workspace. Omit for every project across every
  // workspace you belong to (the previous, and still default, behaviour).
  workspaceId: z.uuid().optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type MoveProjectsInput = z.infer<typeof moveProjectsSchema>;
