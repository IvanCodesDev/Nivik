import { expect, type Page, test } from '@playwright/test';

interface NodeView {
  id: string;
  label: string;
  pinned: boolean;
  position?: { x: number; y: number };
  size?: { w: number; h: number };
}

declare global {
  interface Window {
    /** Installed by `apps/web/lib/debug-hook.ts` when the app runs with NEXT_PUBLIC_NIVIK_E2E=1. */
    __nivik?: {
      diagram(): { nodes: NodeView[]; edges: unknown[] } | null;
      viewport(): { x: number; y: number; zoom: number };
    };
  }
}

const nodes = (page: Page) =>
  page.evaluate(() => (window.__nivik?.diagram()?.nodes ?? []) as NodeView[]);

const edgeCount = (page: Page) =>
  page.evaluate(() => window.__nivik?.diagram()?.edges.length ?? -1);

/** Centre of a node in page pixels: scene → screen through the renderer's viewport. */
const centerOf = (page: Page, index: number) =>
  page.evaluate((i) => {
    const hook = window.__nivik;
    const node = hook?.diagram()?.nodes[i];
    const viewport = hook?.viewport();
    if (!node?.position || !node.size || !viewport) throw new Error('node not placed yet');
    const host = document.querySelector('[data-testid="renderer-host"]')?.getBoundingClientRect();
    return {
      x: (host?.left ?? 0) + (node.position.x + node.size.w / 2 + viewport.x) * viewport.zoom,
      y: (host?.top ?? 0) + (node.position.y + node.size.h / 2 + viewport.y) * viewport.zoom,
    };
  }, index);

test('generate → drag a node → AI edit keeps it pinned → undo the run', async ({ page }) => {
  await page.goto('/canvas/new?prompt=Login%20-%3E%20Verify%20-%3E%20Done');
  await expect(page.getByTestId('renderer-host')).toBeVisible();
  await expect(page.locator('.excalidraw canvas').first()).toBeVisible();

  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect
    .poll(() => nodes(page).then((n) => n.map((node) => node.label)))
    .toEqual(['Login', 'Verify', 'Done']);
  await expect.poll(() => nodes(page).then((n) => n.every((node) => node.position))).toBe(true);
  await expect(page.getByRole('button', { name: 'Undo run' })).toBeVisible();
  // Let the fit-to-content animation settle before converting scene to screen coordinates.
  await page.waitForTimeout(600);

  const start = await centerOf(page, 0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y + 30, { steps: 4 });
  await page.mouse.move(start.x + 220, start.y + 140, { steps: 12 });
  await page.mouse.up();

  await expect.poll(() => nodes(page).then((n) => n[0]?.pinned)).toBe(true);
  const pinned = (await nodes(page))[0]?.position;
  expect(pinned).toBeDefined();
  // The run bar no longer offers to undo a run that is not the latest change.
  await expect(page.getByRole('button', { name: 'Undo run' })).toBeDisabled();

  await page.getByLabel('Describe your diagram').fill('Ship');
  await page.getByRole('button', { name: 'Create diagram' }).click();
  await expect.poll(() => nodes(page).then((n) => n.length)).toBe(4);
  await expect.poll(() => edgeCount(page)).toBe(3);
  expect((await nodes(page))[3]?.label).toBe('Ship');
  expect((await nodes(page))[0]?.position).toEqual(pinned);

  const undo = page.getByRole('button', { name: 'Undo run' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect
    .poll(() => nodes(page).then((n) => n.map((node) => node.label)))
    .toEqual(['Login', 'Verify', 'Done']);
  await expect.poll(() => edgeCount(page)).toBe(2);
  expect((await nodes(page))[0]?.position).toEqual(pinned);

  // The diagram survives a reload: it lives in IndexedDB, not in component state.
  await page.reload();
  await expect.poll(() => nodes(page).then((n) => n.length)).toBe(3);
  expect((await nodes(page))[0]?.position).toEqual(pinned);
});
