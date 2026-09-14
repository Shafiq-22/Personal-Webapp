import { z } from 'zod';

/** Every row in Cortex is owned by exactly one user; RLS enforces it in Postgres. */
export const uuid = z.string().uuid();
export const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'expected an ISO-8601 timestamp' });
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
export const url = z.string().url();

export const Priority = z.enum(['p1', 'p2', 'p3', 'p4']);
export type Priority = z.infer<typeof Priority>;

/** Numeric weight for ranking/sorting. p1 is the most urgent. */
export const PRIORITY_WEIGHT: Record<Priority, number> = { p1: 1, p2: 0.75, p3: 0.5, p4: 0.25 };

export const TaskStatus = z.enum(['todo', 'in_progress', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const EnergyLevel = z.enum(['low', 'medium', 'high']);
export type EnergyLevel = z.infer<typeof EnergyLevel>;

/** Where a record came from. Used for provenance in the UI and in Obsidian notes. */
export const Origin = z.enum(['manual', 'nl_capture', 'calendar', 'obsidian', 'feed', 'clipper', 'ios', 'system']);
export type Origin = z.infer<typeof Origin>;

/**
 * Which engine produced an AI artefact. `afm` means Apple Foundation Models ran
 * on the user's device; `heuristic` means the deterministic core fallback ran.
 * No other value is ever written - there is no cloud LLM in this system.
 */
export const AiEngine = z.enum(['afm', 'heuristic', 'none']);
export type AiEngine = z.infer<typeof AiEngine>;
