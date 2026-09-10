// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createDiagram } from '@nivik/ir';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { ToastProvider } from '@nivik/ui';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { setRepository } from '@/lib/repository';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/lib/stores/settings-store';
import { DiagramLibrary } from './diagram-library';

vi.mock('@phosphor-icons/react', () => {
  const Icon = () => null;
  const isIconName = (key: PropertyKey) => typeof key === 'string' && /^[A-Z]/.test(key);
  return new Proxy(
    {},
    {
      has: (_, key) => isIconName(key),
      get: (_, key) => (isIconName(key) ? Icon : undefined),
    },
  );
});

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const download = vi.hoisted(() => vi.fn());
vi.mock('@/lib/download', () => ({ download }));

let counter = 0;
let repo: DiagramRepository;

const renderLibrary = () =>
  render(
    <I18nProvider initialLocale="en">
      <ToastProvider>
        <DiagramLibrary />
      </ToastProvider>
    </I18nProvider>,
  );

const cardNames = () =>
  within(screen.getByRole('region', { name: 'Diagrams' }))
    .queryAllByRole('button', { name: /^Open / })
    .map((button) => button.getAttribute('aria-label')?.replace(/^Open /, ''));

describe('DiagramLibrary (PRD §5.3, spec 07 §4)', () => {
  beforeEach(() => {
    repo = new DiagramRepository(new NivikDB(`library-page-${++counter}`));
    setRepository(repo);
    useSettingsStore.setState({ saved: DEFAULT_SETTINGS, draft: DEFAULT_SETTINGS, hydrated: true });
    push.mockReset();
  });
  afterEach(() => {
    cleanup();
    setRepository(null);
  });

  it('shows the empty state, then follows the repository live', async () => {
    renderLibrary();
    await screen.findByText('No diagrams yet. Create one to get started.');

    await repo.create(
      createDiagram({ id: 'd_lib000001', name: 'Checkout flow', type: 'flow', now: 1 }),
    );
    await repo.create(
      createDiagram({ id: 'd_lib000002', name: 'Platform', type: 'architecture', now: 2 }),
    );
    await waitFor(() => expect(cardNames()).toEqual(['Platform', 'Checkout flow']));
    expect(screen.queryByText('No diagrams yet. Create one to get started.')).toBeNull();
  });

  it('filters by display group and favourites, and searches by name', async () => {
    await repo.create(
      createDiagram({ id: 'd_lib000003', name: 'Checkout flow', type: 'flow', now: 1 }),
    );
    await repo.create(createDiagram({ id: 'd_lib000004', name: 'Platform', type: 'c4', now: 2 }));
    await repo.create(
      createDiagram({ id: 'd_lib000005', name: 'Brainstorm', type: 'mindmap', now: 3 }),
    );
    await repo.update('d_lib000004', { favorite: true });
    const user = userEvent.setup();
    renderLibrary();
    await waitFor(() => expect(cardNames()).toHaveLength(3));

    await user.click(screen.getByRole('button', { name: 'Architecture' }));
    expect(cardNames()).toEqual(['Platform']);
    await user.click(screen.getByRole('button', { name: 'Favorites' }));
    expect(cardNames()).toEqual(['Platform']);
    expect(screen.getByText('★ Edited just now')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search diagrams' }), 'brain');
    expect(cardNames()).toEqual(['Brainstorm']);
  });

  it('renames through the dialog as a change set and deletes after confirmation', async () => {
    await repo.create(createDiagram({ id: 'd_lib000006', name: 'Draft', type: 'flow', now: 1 }));
    const user = userEvent.setup();
    renderLibrary();
    await waitFor(() => expect(cardNames()).toEqual(['Draft']));

    await user.click(screen.getByRole('button', { name: 'More options for Draft' }));
    await user.click(await screen.findByRole('button', { name: 'Rename' }));
    const field = await screen.findByRole('textbox', { name: 'Diagram name' });
    await user.clear(field);
    await user.type(field, 'Login flow{Enter}');
    await waitFor(() => expect(cardNames()).toEqual(['Login flow']));
    const record = await repo.require('d_lib000006');
    expect(record.version).toBe(2);
    expect(await repo.db.changeSets.count()).toBe(1);

    await user.click(screen.getByRole('button', { name: 'More options for Login flow' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await screen.findByText('Delete Login flow?');
    await user.click(screen.getByRole('button', { name: 'Delete diagram' }));
    await waitFor(() => expect(cardNames()).toEqual([]));
    expect(await repo.get('d_lib000006')).toBeUndefined();
  });

  it('exports a diagram as a Nivik document and imports one back as a new diagram', async () => {
    await repo.create(
      createDiagram({ id: 'd_lib000008', name: 'Payment flow', type: 'flow', now: 1 }),
    );
    const user = userEvent.setup();
    renderLibrary();
    await waitFor(() => expect(cardNames()).toEqual(['Payment flow']));

    await user.click(screen.getByRole('button', { name: 'More options for Payment flow' }));
    await user.click(await screen.findByRole('button', { name: 'Export…' }));
    await user.click(await screen.findByRole('button', { name: 'Nivik document (.nivik.json)' }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    const [blob, filename] = download.mock.calls[0] as [Blob, string];
    expect(filename).toBe('Payment-flow.nivik.json');
    const text = await blob.text();
    expect(JSON.parse(text)).toMatchObject({ schema: 'nivik.diagram/1', name: 'Payment flow' });

    await user.click(screen.getByRole('button', { name: 'New Diagram' }));
    await user.click(await screen.findByRole('button', { name: 'Import from file…' }));
    const input = screen.getByLabelText('Import from file…') as HTMLInputElement;
    await user.upload(input, new File([text], 'payment.nivik.json', { type: 'application/json' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    const [target] = push.mock.calls[0] as [string];
    expect(target).toMatch(/^\/canvas\/d_/);
    expect(target).not.toBe('/canvas/d_lib000008');
    await waitFor(() => expect(cardNames()).toEqual(['Payment flow', 'Payment flow']));
    expect((await repo.list()).map((d) => d.version)).toEqual([1, 1]);
  });

  it('opens a diagram and offers the three ways to start a new one', async () => {
    await repo.create(createDiagram({ id: 'd_lib000007', name: 'Open me', type: 'flow', now: 1 }));
    const user = userEvent.setup();
    renderLibrary();
    await user.click(await screen.findByRole('button', { name: 'Open Open me' }));
    expect(push).toHaveBeenCalledWith('/canvas/d_lib000007');

    await user.click(screen.getByRole('button', { name: 'New Diagram' }));
    await user.click(await screen.findByRole('button', { name: 'Use a template' }));
    expect(push).toHaveBeenLastCalledWith('/templates');
  });
});
