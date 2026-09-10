// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { orderPlatformLaidOut } from '@nivik/ir/testing';
import { DiagramRepository, NivikDB } from '@nivik/storage';
import { ToastProvider } from '@nivik/ui';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AnchorHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/provider';
import { renameDiagram } from '@/lib/library-actions';
import { setRepository } from '@/lib/repository';
import { DEFAULT_SETTINGS, useSettingsStore } from '@/lib/stores/settings-store';
import { DiagramDetail } from './diagram-detail';

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
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let counter = 0;
let repo: DiagramRepository;

const renderDetail = (id: string) =>
  render(
    <I18nProvider initialLocale="en">
      <ToastProvider>
        <DiagramDetail diagramId={id} />
      </ToastProvider>
    </I18nProvider>,
  );

const versionsCard = () => screen.getByRole('region', { name: 'Versions' });
const changesCard = () => screen.getByRole('region', { name: 'Recent changes' });

describe('DiagramDetail (PRD §5.6, spec 06 §3)', () => {
  beforeEach(() => {
    repo = new DiagramRepository(new NivikDB(`detail-page-${++counter}`));
    setRepository(repo);
    useSettingsStore.setState({ saved: DEFAULT_SETTINGS, draft: DEFAULT_SETTINGS, hydrated: true });
    push.mockReset();
  });
  afterEach(() => {
    cleanup();
    setRepository(null);
  });

  it('shows the facts, the preview and the version list of a stored diagram', async () => {
    const source = orderPlatformLaidOut();
    await repo.create(source);
    renderDetail(source.id);

    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(source.name);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain(source.name);
    const facts = screen.getByRole('region', { name: 'Basic info' }).textContent ?? '';
    expect(facts).toContain(`${source.nodes.length} nodes`);
    expect(facts).toContain(source.type);
    expect(within(versionsCard()).getAllByRole('listitem')).toHaveLength(1);
    expect(versionsCard().textContent).toContain('Created');
    expect(versionsCard().textContent).toContain('Current');
    expect(changesCard().textContent).toContain('No changes recorded yet.');
  });

  it('tells the user when the diagram is not on this device', async () => {
    renderDetail('d_missing0001');
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe(
      'This diagram is not on this device',
    );
    expect(screen.getByRole('link', { name: /Back to library/ }).getAttribute('href')).toBe(
      '/library',
    );
  });

  it('saves a labelled version, lists a rename as a change and restores the earlier version', async () => {
    const source = orderPlatformLaidOut();
    await repo.create(source);
    const user = userEvent.setup();
    renderDetail(source.id);
    await screen.findByRole('heading', { level: 1 });

    await user.click(screen.getByRole('button', { name: 'Save version' }));
    const label = await screen.findByRole('textbox', { name: 'Version label' });
    await user.type(label, 'Before edits{Enter}');
    await waitFor(() => expect(versionsCard().textContent).toContain('Before edits'));
    expect(versionsCard().textContent).toContain('Saved by you');

    await renameDiagram(repo, source.id, 'Renamed platform');
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Renamed platform'),
    );
    await waitFor(() =>
      expect(changesCard().textContent).toContain('Renamed to "Renamed platform"'),
    );
    expect(changesCard().textContent).toContain('You');
    expect(changesCard().textContent).toContain(`v${source.version} → v${source.version + 1}`);

    const v1 = within(versionsCard())
      .getAllByRole('listitem')
      .find((li) => new RegExp(`^v${source.version}(?!\\d)`).test(li.textContent ?? ''));
    if (!v1) throw new Error('v1 row missing');
    await user.click(within(v1).getByRole('button', { name: 'Compare' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('1 diagram setting');
    await user.keyboard('{Escape}');

    await user.click(within(v1).getByRole('button', { name: 'Restore' }));
    await user.click(await screen.findByRole('button', { name: 'Restore this version' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(source.name),
    );
    const record = await repo.require(source.id);
    expect(record.version).toBe(source.version + 2);
    const versions = await repo.listVersions(source.id);
    expect(versions.map((v) => [v.version, v.reason])).toEqual([
      [source.version, 'manual'],
      [source.version + 2, 'restore'],
    ]);
    await waitFor(() => expect(changesCard().textContent).toContain('System'));
  });

  it('navigates to the canvas and to the duplicate', async () => {
    const source = orderPlatformLaidOut();
    await repo.create(source);
    const user = userEvent.setup();
    renderDetail(source.id);
    await user.click(await screen.findByRole('button', { name: 'Open in Canvas' }));
    expect(push).toHaveBeenCalledWith(`/canvas/${source.id}`);

    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(2));
    const [target] = push.mock.calls[1] as [string];
    expect(target).toMatch(/^\/diagram\/d_/);
    expect(target).not.toBe(`/diagram/${source.id}`);
    expect(await repo.list()).toHaveLength(2);
  });
});
