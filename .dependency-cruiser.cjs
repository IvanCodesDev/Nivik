/**
 * Package dependency direction (spec 00 §5.1) enforced in CI via `pnpm deps`.
 * Dependencies only flow downwards: apps -> packages -> ir; ir depends on nothing internal.
 */

const path = require('node:path');

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies make modules impossible to reason about in isolation.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'Every import must resolve to a real module.',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'packages-must-not-depend-on-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'ir-has-no-internal-deps',
      severity: 'error',
      comment: '@nivik/ir is the root of the graph: zod + nanoid only.',
      from: { path: '^packages/ir/' },
      to: { path: '^(apps|packages)/', pathNot: '^packages/ir/' },
    },
    {
      name: 'protocol-depends-only-on-ir',
      severity: 'error',
      from: { path: '^packages/protocol/' },
      to: { path: '^packages/', pathNot: '^packages/(protocol|ir)/' },
    },
    {
      name: 'agent-core-depends-only-on-protocol-ir-layout',
      severity: 'error',
      from: { path: '^packages/agent/' },
      to: { path: '^packages/', pathNot: '^packages/(agent|protocol|ir|layout)/' },
    },
    {
      name: 'layout-depends-only-on-ir',
      severity: 'error',
      from: { path: '^packages/layout/' },
      to: { path: '^packages/', pathNot: '^packages/(layout|ir)/' },
    },
    {
      name: 'storage-depends-only-on-ir-protocol',
      severity: 'error',
      comment: 'Storage persists IR documents and run records (protocol wire types); nothing else.',
      from: { path: '^packages/storage/' },
      to: { path: '^packages/', pathNot: '^packages/(storage|ir|protocol)/' },
    },
    {
      name: 'templates-depend-only-on-ir',
      severity: 'error',
      from: { path: '^packages/templates/' },
      to: { path: '^packages/', pathNot: '^packages/(templates|ir)/' },
    },
    {
      name: 'formats-depend-only-on-ir',
      severity: 'error',
      from: { path: '^packages/(format-[^/]+)/' },
      to: { path: '^packages/', pathNot: '^packages/($1|ir)/' },
    },
    {
      name: 'renderers-depend-only-on-renderer-core-ir-layout-ui',
      severity: 'error',
      comment:
        'ui is allowed for the shared palette hex values (@nivik/ui/palettes); it has no internal deps.',
      from: { path: '^packages/(renderer-[^/]+)/' },
      to: { path: '^packages/', pathNot: '^packages/($1|renderer-core|ir|layout|ui)/' },
    },
    {
      name: 'ui-has-no-internal-deps',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/', pathNot: '^packages/ui/' },
    },
    {
      name: 'agent-runtime-depends-only-on-protocol-agent-ir',
      severity: 'error',
      from: { path: '^apps/agent/' },
      to: { path: '^(apps|packages)/', pathNot: '^(apps/agent|packages/(protocol|agent|ir))/' },
    },
    {
      name: 'web-must-not-import-agent-runtime',
      severity: 'error',
      comment:
        'The web app talks to the runtime over HTTP (@nivik/protocol), never by import. Tests may drive the runtime in-process to prove both hosts behave alike.',
      from: { path: '^apps/web/', pathNot: '\\.test\\.tsx?$' },
      to: { path: '^apps/agent/' },
    },
    {
      name: 'isomorphic-packages-no-node-builtins',
      severity: 'error',
      comment: 'These packages run in browser Workers as well as Node; host access is injected.',
      from: {
        path: '^packages/(agent|protocol|ir|templates|storage|layout|renderer-core)/src/',
        pathNot: '\\.test\\.tsx?$',
      },
      to: { dependencyTypes: ['core'] },
    },
  ],
  options: {
    // Externals stay in the graph as leaves (needed for the `core` and `couldNotResolve` rules).
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['/\\.next/', '/dist/', '/coverage/', '/public/', '\\.d\\.ts$'] },
    tsPreCompilationDeps: true,
    // Resolution-only tsconfig: dependency-cruiser applies `paths` relative to the cwd, so the
    // web app's `@/*` alias is re-declared there as `./apps/web/*` (never used by tsc).
    tsConfig: { fileName: path.join(__dirname, 'tsconfig.depcruise.json') },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // `production` resolves entries that only ship development/production conditions
      // (e.g. `@excalidraw/excalidraw/index.css`).
      conditionNames: ['import', 'types', 'default', 'production'],
      mainFields: ['module', 'main', 'types'],
      extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '.css'],
    },
    skipAnalysisNotInRules: true,
    progress: { type: 'none' },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
