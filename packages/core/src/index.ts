/**
 * @cortex/core
 *
 * Everything that is not a UI and not a database call: the domain model, the
 * scheduling maths, the monitoring pipeline, the Obsidian format and the
 * exporters. It has exactly one runtime dependency (zod) and no I/O, so the
 * same code runs in the Next.js app, in Supabase edge functions and in tests.
 *
 * On-device AI lives on the iPhone (see `ios/`). Where this package touches an
 * AI-shaped problem - prioritising, ranking, summarising - it implements the
 * deterministic fallback that keeps the product usable when Apple Foundation
 * Models is not available.
 */
export * from './util/index.js';
export * from './domain/index.js';
export * from './text/index.js';
export * from './nl/index.js';
export * from './schedule/index.js';
export * from './monitor/index.js';
export * from './obsidian/index.js';
export * from './export/index.js';
export * from './summarize.js';
export * from './analytics.js';
