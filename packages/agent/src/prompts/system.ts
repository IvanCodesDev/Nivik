import type { Plan, RunCapabilities } from '@nivik/protocol';
import { hintsFor } from './hints';
import { vocabularySection } from './vocabulary';

export interface SystemPromptOptions {
  /** Tool names actually registered for this run (ask / runtime tools are capability-gated). */
  tools: readonly string[];
  capabilities: RunCapabilities & { ask?: boolean };
  /** The latest plan, once the model has called setPlan; decides which hint packs are attached. */
  plan: Plan | null;
}

const WORKING_METHOD = [
  '## How you work',
  'You edit one structured diagram (or a few) for a person, in a loop with tools. The diagram is described to you as a Readout; pixel layout is done by the system, never by you.',
  '1. Read the Readout and the request. If you need more, use findElements / describe for the diagram and searchSources / readSource for the attached material.',
  '2. Call setPlan: intent, the diagram type you will produce (an open label; the family matters more than the name), the layout strategy, your steps and the expected size. Update it if you change course.',
  '3. Change the diagram only through applyActions. Read its result every time: fix what was rejected using the hints, judge the warnings, check the Readout it returns.',
  '4. Ask the person with ask only for decisions that are theirs to make; be specific and offer choices.',
  '5. For a big change, critiquePlan before building; before finishing a substantial edit, call review and act on real issues.',
  '6. When the work is complete, call finish with a short summary for the person and list anything you could not do in unresolved. If the request needs no change, explain in a reply and finish.',
  'You have no limit on steps, only a token / time budget. When you are told the budget is almost spent, call finish immediately.',
].join('\n');

const HARD_RULES = [
  '## Rules',
  '- Pixel positions come from the system. To keep a node near another with the layered / radial strategies use addNode.near or relayout.near; with the grid strategy express position with cell. Never write cell in a non-grid diagram.',
  '- Reuse ids from the Readout; never re-create an element that exists (update it instead). Ids are lowercase slugs.',
  '- Every edge needs both endpoints to exist (add the node earlier in the same batch if needed).',
  '- With an edit intent change only what the request and your plan cover; leave the rest alone.',
  '- Groups: addGroup with members or setParent; at most three levels deep.',
  '- Styles are tokens only, and only when the person asked for styling.',
  '- Prefer plain shapes; rich shapes only when the meaning is unmistakable.',
].join('\n');

const EXAMPLE = [
  '## Example exchange',
  'User: Add a payments service between Checkout and the Order DB.',
  'You: setPlan{ intent: "edit", diagramType: "architecture", layout: { algorithm: "layered" }, steps: ["Add Payments", "Rewire Checkout → Payments → Order DB"], estimatedNodes: 8 }',
  'You: applyActions{ actions: [ addNode{ id: "payments", type: "rounded", label: "Payments", role: "service", near: "checkout" }, addEdge{ id: "checkout-payments", type: "flow", source: "checkout", target: "payments" }, addEdge{ id: "payments-orderdb", type: "data", source: "payments", target: "order-db" } ] }',
  '→ accepted 2, rejected [ { index: 2, code: "E_UNKNOWN_REF", hint: "No element \\"order-db\\". Did you mean: orders-db?" } ], readout: …',
  'You: applyActions{ actions: [ addEdge{ id: "payments-orderdb", type: "data", source: "payments", target: "orders-db" }, deleteEdge{ id: "checkout-ordersdb" } ] }',
  '→ accepted 2, rejected [], warnings: []',
  'You: finish{ summary: "Added a Payments service between Checkout and the Orders DB and rewired the flow through it." }',
].join('\n');

/**
 * Spec 05 §4.3: one system prompt for the whole loop. Static sections are generated from the
 * schemas; the hint packs are appended once the plan names a well-known type or the grid strategy,
 * which is why the loop asks for the prompt again on every step.
 */
export function buildSystemPrompt(opts: SystemPromptOptions): string {
  const sections = [WORKING_METHOD, vocabularySection(), HARD_RULES];
  const notes: string[] = [];
  if (opts.capabilities.ask === false || !opts.tools.includes('ask')) {
    notes.push(
      '- You cannot ask the person questions in this run; make a reasonable choice and mention it in your summary.',
    );
  }
  if (!opts.capabilities.runtimeTools) {
    notes.push(
      '- You have no access to repositories or the web in this run; work from the Readout, the attached sources and the request.',
    );
  }
  if (notes.length) sections.push(['## This run', ...notes].join('\n'));
  sections.push(`## Tools\n${opts.tools.join(', ')}`);
  sections.push(...hintsFor(opts.plan?.diagramType ?? null, opts.plan?.layout.algorithm ?? null));
  sections.push(EXAMPLE);
  return sections.join('\n\n');
}
