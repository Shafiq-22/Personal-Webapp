import { z } from 'zod';
import { isoDateTime, uuid } from './primitives.js';

/**
 * Transport the vault lives on. Cortex writes plain Markdown either way; the
 * transport only decides *where* the bytes land and who does the moving.
 */
export const VaultTransport = z.enum([
  'icloud_drive',
  'obsidian_sync',
  'webdav',
  'remotely_save',
  'livesync',
  'google_drive',
  'local_rest_api',
  'manual_export',
]);
export type VaultTransport = z.infer<typeof VaultTransport>;

export const ObsidianEntityType = z.enum(['task', 'item', 'digest', 'event', 'project', 'daily_note']);
export type ObsidianEntityType = z.infer<typeof ObsidianEntityType>;

export const SyncDirection = z.enum(['push', 'pull', 'two_way']);
export type SyncDirection = z.infer<typeof SyncDirection>;

export const VaultConfig = z.object({
  id: uuid,
  userId: uuid,
  name: z.string().min(1).max(200).default('Vault'),
  transport: VaultTransport.default('icloud_drive'),
  /** Folder layout inside the vault. Every path is vault-relative. */
  folders: z
    .object({
      tasks: z.string().default('Cortex/Tasks'),
      items: z.string().default('Cortex/Research'),
      digests: z.string().default('Cortex/Digests'),
      events: z.string().default('Cortex/Calendar'),
      projects: z.string().default('Cortex/Projects'),
      dailyNotes: z.string().default('Daily Notes'),
    })
    .default({}),
  direction: SyncDirection.default('two_way'),
  /** Scanning the vault for monitoring topics is opt-in and revocable. */
  allowTopicScan: z.boolean().default(false),
  scanFolders: z.array(z.string()).default([]),
  /** Client-side E2EE for anything Cortex stores in the cloud about the vault. */
  encryptionEnabled: z.boolean().default(false),
  /** Only ever a public key / wrapped key reference - never the passphrase. */
  encryptionKeyRef: z.string().max(500).nullable().default(null),
  restApiBaseUrl: z.string().url().nullable().default(null),
  lastSyncedAt: isoDateTime.nullable().default(null),
  createdAt: isoDateTime,
});
export type VaultConfig = z.infer<typeof VaultConfig>;

/**
 * The mapping row that makes bi-directional sync possible: it remembers the
 * hash of the last content Cortex agreed on, so a three-way merge can tell an
 * edit made in Obsidian apart from an edit made in Cortex.
 */
export const ObsidianFile = z.object({
  id: uuid,
  userId: uuid,
  vaultId: uuid,
  entityType: ObsidianEntityType,
  entityId: z.string().min(1),
  vaultPath: z.string().min(1).max(1000),
  /** Hash of the note the last time both sides agreed. */
  baseHash: z.string().length(16).nullable().default(null),
  localHash: z.string().length(16).nullable().default(null),
  remoteHash: z.string().length(16).nullable().default(null),
  lastPushedAt: isoDateTime.nullable().default(null),
  lastPulledAt: isoDateTime.nullable().default(null),
  conflict: z.boolean().default(false),
  deletedInVault: z.boolean().default(false),
});
export type ObsidianFile = z.infer<typeof ObsidianFile>;
