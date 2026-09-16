import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/** Projects nest arbitrarily deep; `path` is the materialised ancestor chain. */
export const Project = z.object({
  id: uuid,
  userId: uuid,
  parentId: uuid.nullable().default(null),
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().default(null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  icon: z.string().max(32).nullable().default(null),
  archived: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Project = z.infer<typeof Project>;

export const ProjectInput = Project.pick({
  name: true,
  description: true,
  color: true,
  icon: true,
  parentId: true,
}).partial({ description: true, color: true, icon: true, parentId: true });
export type ProjectInput = z.infer<typeof ProjectInput>;

export const Tag = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().min(1).max(64),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  createdAt: isoDateTime,
});
export type Tag = z.infer<typeof Tag>;

/** Build the ancestor chain for a project id, root first. */
export function projectPath(projects: Project[], id: string): Project[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const chain: Project[] = [];
  const seen = new Set<string>();
  let cursor = byId.get(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return chain;
}
