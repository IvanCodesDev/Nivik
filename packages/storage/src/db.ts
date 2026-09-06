import Dexie, { type Table } from 'dexie';
import type {
  ChangeSetRecord,
  DiagramRecord,
  ProviderRecord,
  RunRecord,
  SecretRecord,
  SettingRecord,
  SourceRecord,
  TemplateRecord,
  VersionRecord,
} from './records';

export const DB_NAME = 'nivik-db';

/** Dexie schema of the local-first store (spec 06 §2), version 1. */
export class NivikDB extends Dexie {
  diagrams!: Table<DiagramRecord, string>;
  versions!: Table<VersionRecord, string>;
  changeSets!: Table<ChangeSetRecord, string>;
  runs!: Table<RunRecord, string>;
  sources!: Table<SourceRecord, string>;
  templates!: Table<TemplateRecord, string>;
  providers!: Table<ProviderRecord, string>;
  secrets!: Table<SecretRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name: string = DB_NAME) {
    super(name);
    this.version(1).stores({
      diagrams: 'id, updatedAt, name, type, favorite, *tags',
      versions: 'id, [diagramId+version], diagramId, createdAt',
      changeSets: 'id, [diagramId+resultVersion], diagramId, runId, createdAt',
      runs: 'id, diagramId, startedAt, status',
      sources: 'id, diagramId, kind',
      templates: 'id, category, builtin',
      providers: 'id, kind',
      secrets: 'providerId',
      settings: 'key',
    });
  }
}
