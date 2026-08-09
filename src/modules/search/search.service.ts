import { prisma } from '../../lib/prisma';
import type { SearchQuery } from './search.schemas';

// Cross-project search over the "source of truth" content a founder accumulates:
// their projects, the Living Blueprint sections, the Decision Log, and the AI
// Strategist's recommendations. Everything here is TENANCY-SCOPED — results are
// limited to workspaces the caller is a member of, exactly like project access.
//
// Postgres note: we match with ILIKE ('%term%'), the case-INsensitive LIKE.
// Prisma's `contains` with `mode: 'insensitive'` compiles to ILIKE for plain
// text columns; for the blueprint section body — which lives inside a JSONB
// column ({ "markdown": "..." }) — we drop to a small raw SQL query and pull
// the text out with `content->>'markdown'` before matching.

export type SearchResultType = 'project' | 'blueprint_section' | 'decision' | 'recommendation';

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  snippet: string;
  projectId: string;
  projectName: string;
  // Only on blueprint_section results — lets the UI deep-link to the section.
  sectionKey?: string;
}

// A short window of text around the first match, so the UI can show WHY a row
// matched instead of the whole field. Falls back to the head of the text when
// the term only appeared in another field.
function makeSnippet(text: string, term: string, radius = 90): string {
  if (!text) return '';
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2).trim()}…` : text.trim();
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + term.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

interface SectionRow {
  id: string;
  key: string;
  title: string;
  markdown: string | null;
  projectId: string;
  projectName: string;
}

export async function search(userId: string, query: SearchQuery) {
  const { q, limit } = query;
  const like = { contains: q, mode: 'insensitive' as const };
  const pattern = `%${q}%`;

  // All four searches run in parallel. Each is independently scoped to the
  // caller's workspaces via a nested relation filter (Prisma turns these into
  // SQL joins), except the raw section query which joins to WorkspaceMember
  // explicitly.
  const [projects, sections, decisions, recommendations] = await Promise.all([
    prisma.project.findMany({
      where: {
        workspace: { members: { some: { userId } } },
        OR: [{ name: like }, { oneLineIdea: like }, { category: like }],
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),

    // Raw + parameterized (Prisma.$queryRaw tags interpolations as bind params,
    // so this is injection-safe). `content->>'markdown'` reads the markdown
    // string out of the JSONB column; the WorkspaceMember join is the tenancy gate.
    prisma.$queryRaw<SectionRow[]>`
      SELECT bs.id,
             bs.key,
             bs.title,
             bs.content->>'markdown' AS markdown,
             p.id   AS "projectId",
             p.name AS "projectName"
      FROM "BlueprintSection" bs
      JOIN "Blueprint" b ON b.id = bs."blueprintId"
      JOIN "Project"   p ON p.id = b."projectId"
      JOIN "WorkspaceMember" wm ON wm."workspaceId" = p."workspaceId" AND wm."userId" = ${userId}
      WHERE bs.title ILIKE ${pattern} OR bs.content->>'markdown' ILIKE ${pattern}
      ORDER BY bs."updatedAt" DESC
      LIMIT ${limit}
    `,

    prisma.decisionLog.findMany({
      where: {
        project: { workspace: { members: { some: { userId } } } },
        OR: [{ title: like }, { reasoning: like }],
      },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: limit,
    }),

    prisma.recommendation.findMany({
      where: {
        project: { workspace: { members: { some: { userId } } } },
        OR: [{ title: like }, { body: like }],
      },
      include: { project: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
  ]);

  const results: SearchResult[] = [
    ...projects.map((p) => ({
      type: 'project' as const,
      id: p.id,
      title: p.name,
      snippet: makeSnippet(p.oneLineIdea, q),
      projectId: p.id,
      projectName: p.name,
    })),
    ...sections.map((s) => ({
      type: 'blueprint_section' as const,
      id: s.id,
      title: s.title,
      snippet: makeSnippet(s.markdown ?? '', q),
      projectId: s.projectId,
      projectName: s.projectName,
      sectionKey: s.key,
    })),
    ...decisions.map((d) => ({
      type: 'decision' as const,
      id: d.id,
      title: d.title,
      snippet: makeSnippet(d.reasoning, q),
      projectId: d.project.id,
      projectName: d.project.name,
    })),
    ...recommendations.map((r) => ({
      type: 'recommendation' as const,
      id: r.id,
      title: r.title,
      snippet: makeSnippet(r.body, q),
      projectId: r.project.id,
      projectName: r.project.name,
    })),
  ];

  return {
    query: q,
    counts: {
      project: projects.length,
      blueprint_section: sections.length,
      decision: decisions.length,
      recommendation: recommendations.length,
      total: results.length,
    },
    results,
  };
}
