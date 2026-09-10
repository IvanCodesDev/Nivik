/** Re-exported so the UI can subscribe to repository queries without depending on Dexie itself. */
export { liveQuery } from 'dexie';
export { DB_NAME, NivikDB } from './db';
export {
  autoSnapshotDue,
  changeSetsToPrune,
  DEFAULT_POLICY,
  resolvePolicy,
  type StoragePolicy,
  versionsToPrune,
} from './policy';
export type {
  ChangeSetRecord,
  DiagramRecord,
  ProviderRecord,
  RunRecord,
  RunStatus,
  SecretRecord,
  SessionRecord,
  SessionTurnRecord,
  SettingRecord,
  SourceRecord,
  StoredRunEvent,
  TemplateRecord,
  VersionReason,
  VersionRecord,
} from './records';
export {
  type AppendTurnOptions,
  type CreateOptions,
  DiagramRepository,
  type DiagramSummary,
  foldTurn,
  type PersistOptions,
  type PersistResult,
  type PersistSuccess,
  type RepositoryDeps,
  type RestoreResult,
  type SaveVersionOptions,
  StorageError,
  type StorageErrorCode,
  type UpdateOptions,
} from './repository';
export {
  DEVICE_KEY_SETTING,
  type DeviceKeyStore,
  SecretVault,
  type SecretVaultDeps,
  settingsKeyStore,
} from './secrets';
