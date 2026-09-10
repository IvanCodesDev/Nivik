import {
  type AgentAction,
  applyChangeSet,
  type ChangeSetError,
  createDiagram,
  type Diagram,
  type DiagramType,
  type Id,
  type LayoutPatch,
  LayoutSpecSchema,
  newChangeSetId,
  newDiagramId,
  toReadout,
  type ValidationIssue,
  validateDiagram,
} from '@nivik/ir';
import type { DocumentInfo } from '@nivik/protocol';

/** One diagram the loop is working on: the run's initial document or one it created. */
export interface StagingDoc {
  readonly id: Id;
  /** The document as it was when staging began (the change set's base). */
  readonly initial: Diagram;
  /** Created by the model during this run (no stored record yet). */
  readonly created: boolean;
  staging: Diagram;
  accepted: AgentAction[];
  /** Validation issues present before the last apply, so only new ones are reported. */
  knownIssues: Set<string>;
}

export interface RejectedAction {
  index: number;
  code: ChangeSetError['code'];
  message: string;
  /** What the model can do about it (spec 05 §4.1). */
  hint: string | null;
}

/** What `applyActions` hands back to the model — its way of seeing the result (spec 05 §4.1). */
export interface ApplyActionsResult {
  documentId: Id;
  accepted: number;
  rejected: RejectedAction[];
  /** Validation warnings this batch introduced (errors are impossible: each action was applied). */
  warnings: { code: string; message: string; ids: Id[] }[];
  /** Readout of the touched neighbourhood after the batch; `null` when nothing was accepted. */
  readout: string | null;
  layoutNote: string | null;
  totals: { nodes: number; edges: number; groups: number };
}

export interface ActionOutcome {
  index: number;
  action: AgentAction;
  ok: boolean;
  error?: string;
}

export interface Documents {
  current(): StagingDoc;
  get(id: Id): StagingDoc | undefined;
  all(): StagingDoc[];
  /** Documents whose staging differs from their base (plus anything created). */
  changed(): StagingDoc[];
  applyActions(
    actions: readonly AgentAction[],
    documentId?: Id,
  ): { result: ApplyActionsResult; outcomes: ActionOutcome[] };
  create(init: { name: string; type: DiagramType; layout?: LayoutPatch }): DocumentInfo;
  switchTo(id: Id): DocumentInfo;
  info(doc: StagingDoc): DocumentInfo;
}

export interface DocumentsOptions {
  now(): number;
  runId: string;
  newDiagramId?(): Id;
}

const issueKey = (issue: ValidationIssue) => `${issue.code}:${[...issue.ids].sort().join(',')}`;

/** Labels similar enough to be what the model meant; tiny and deterministic on purpose. */
function similarIds(diagram: Diagram, wanted: string, limit = 3): Id[] {
  const needle = wanted.toLowerCase();
  const scored: { id: Id; score: number }[] = [];
  for (const el of [...diagram.nodes, ...diagram.groups, ...diagram.edges]) {
    const id = el.id.toLowerCase();
    const label = 'label' in el && typeof el.label === 'string' ? el.label.toLowerCase() : '';
    let score = 0;
    if (id.includes(needle) || needle.includes(id)) score += 2;
    if (label && (label.includes(needle) || needle.includes(label))) score += 2;
    if (id.slice(0, 3) === needle.slice(0, 3)) score += 1;
    if (score > 0) scored.push({ id: el.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((s) => s.id);
}

function hintFor(error: ChangeSetError, action: AgentAction, staging: Diagram): string | null {
  const ref = typeof error.detail?.id === 'string' ? (error.detail.id as string) : null;
  switch (error.code) {
    case 'E_UNKNOWN_REF': {
      const near = ref ? similarIds(staging, ref) : [];
      return near.length
        ? `No element "${ref}". Did you mean: ${near.join(', ')}? Otherwise add it first with addNode.`
        : 'Reference an id from the Readout, or add the element first with addNode.';
    }
    case 'E_ID_COLLISION': {
      const taken =
        ref ?? ('node' in action ? action.node.id : 'group' in action ? action.group.id : null);
      return taken
        ? `"${taken}" already exists. Use updateNode / updateGroup to change it, or pick a new id such as "${taken}-2".`
        : 'That id already exists; update the existing element or choose another id.';
    }
    case 'E_PARENT_CYCLE':
      return 'A group cannot contain itself or an ancestor; choose a different parent.';
    case 'E_SELF_LOOP':
      return 'An edge needs two different endpoints.';
    case 'E_REF_KIND':
      return 'That id belongs to a different kind of element (node / edge / group).';
    case 'E_INVALID_ACTION':
      return 'The action did not match the schema; check the field names and types.';
    default:
      return null;
  }
}

function layoutNoteFor(staging: Diagram, touched: Id[]): string | null {
  if (staging.layout.algorithm !== 'grid') return null;
  const index = new Map(staging.nodes.map((n) => [n.id, n]));
  const missing = touched.filter((id) => index.has(id) && !index.get(id)?.cell);
  return missing.length
    ? `This diagram uses the grid strategy; ${missing.length} touched node(s) have no cell yet (${missing.slice(0, 5).join(', ')}).`
    : null;
}

const touchedIds = (action: AgentAction): Id[] => {
  switch (action.op) {
    case 'addNode':
      return [action.node.id];
    case 'addEdge':
      return [action.edge.id];
    case 'addGroup':
      return [action.group.id, ...action.members];
    case 'updateNode':
    case 'updateEdge':
    case 'updateGroup':
    case 'deleteNode':
    case 'deleteEdge':
    case 'deleteGroup':
      return [action.id];
    case 'setStyle':
      return [...action.targets];
    case 'setParent':
      return [...action.ids];
    case 'pinNodes':
      return [...action.ids];
    default:
      return [];
  }
};

/**
 * Spec 05 §4.2: every action is applied to a staging copy one at a time, so the model learns which
 * ones stuck and why the others did not. Nothing here touches storage or a renderer.
 */
export function createDocuments(initial: Diagram, opts: DocumentsOptions): Documents {
  const docs = new Map<Id, StagingDoc>();
  const newId = opts.newDiagramId ?? newDiagramId;
  let currentId = initial.id;

  const open = (diagram: Diagram, created: boolean): StagingDoc => {
    const doc: StagingDoc = {
      id: diagram.id,
      initial: diagram,
      created,
      staging: diagram,
      accepted: [],
      knownIssues: new Set(validateDiagram(diagram).warnings.map(issueKey)),
    };
    docs.set(diagram.id, doc);
    return doc;
  };
  open(initial, false);

  const info = (doc: StagingDoc): DocumentInfo => ({
    id: doc.id,
    name: doc.staging.name,
    type: doc.staging.type,
  });

  return {
    current: () => docs.get(currentId) as StagingDoc,
    get: (id) => docs.get(id),
    all: () => Array.from(docs.values()),
    changed: () => Array.from(docs.values()).filter((d) => d.created || d.accepted.length > 0),
    info,
    applyActions(actions, documentId) {
      const doc = docs.get(documentId ?? currentId);
      if (!doc) throw new Error(`Unknown document "${documentId}"`);
      const outcomes: ActionOutcome[] = [];
      const rejected: RejectedAction[] = [];
      const touched: Id[] = [];
      let accepted = 0;
      actions.forEach((action, index) => {
        const r = applyChangeSet(
          doc.staging,
          {
            id: newChangeSetId(),
            diagramId: doc.id,
            baseVersion: doc.staging.version,
            origin: 'ai',
            runId: opts.runId,
            actions: [action],
            createdAt: opts.now(),
          },
          { skipVersionCheck: true },
        );
        if (r.ok) {
          doc.staging = r.diagram;
          doc.accepted.push(action);
          accepted += 1;
          touched.push(...touchedIds(action));
          outcomes.push({ index, action, ok: true });
        } else {
          rejected.push({
            index,
            code: r.error.code,
            message: r.error.message,
            hint: hintFor(r.error, action, doc.staging),
          });
          outcomes.push({ index, action, ok: false, error: r.error.code });
        }
      });

      const validation = validateDiagram(doc.staging);
      const fresh = validation.warnings.filter((w) => !doc.knownIssues.has(issueKey(w)));
      doc.knownIssues = new Set(validation.warnings.map(issueKey));
      const present = touched.filter(
        (id) =>
          doc.staging.nodes.some((n) => n.id === id) || doc.staging.groups.some((g) => g.id === id),
      );
      const readout =
        accepted > 0
          ? toReadout(doc.staging, {
              scope: present.length ? { selection: Array.from(new Set(present)), hops: 1 } : 'all',
              includeNotes: false,
              maxTokens: 1_200,
            }).text
          : null;

      return {
        outcomes,
        result: {
          documentId: doc.id,
          accepted,
          rejected,
          warnings: fresh.map((w) => ({ code: w.code, message: w.message, ids: w.ids })),
          readout,
          layoutNote: layoutNoteFor(doc.staging, touched),
          totals: {
            nodes: doc.staging.nodes.length,
            edges: doc.staging.edges.length,
            groups: doc.staging.groups.length,
          },
        },
      };
    },
    create(init) {
      const diagram = createDiagram({
        name: init.name,
        type: init.type,
        id: newId(),
        now: opts.now(),
      });
      if (init.layout)
        diagram.layout = LayoutSpecSchema.parse({ ...diagram.layout, ...init.layout });
      const doc = open(diagram, true);
      currentId = doc.id;
      return info(doc);
    },
    switchTo(id) {
      const doc = docs.get(id);
      if (!doc) throw new Error(`Unknown document "${id}"`);
      currentId = id;
      return info(doc);
    },
  };
}
