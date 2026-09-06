'use client';

import { cn, IconButton, useToast } from '@nivik/ui';
import { ArrowRight, GearSix } from '@phosphor-icons/react';
import Image from 'next/image';
import { useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { INTEGRATIONS, type Integration } from '@/lib/data/integrations';
import styles from './integrations.module.css';

/** Integrations (PRD 5.5): connect Nivik with everyday tools. Connection state is local for now. */
export function Integrations() {
  const toast = useToast();
  const [connected, setConnected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INTEGRATIONS.map((i) => [i.id, i.connected])),
  );
  const [configuring, setConfiguring] = useState<Integration | null>(null);

  const toggle = (integration: Integration) => {
    const next = !connected[integration.id];
    setConnected((state) => ({ ...state, [integration.id]: next }));
    toast(next ? `${integration.name} connected` : `${integration.name} disconnected`);
  };

  const groups: { title: string; items: Integration[] }[] = [
    { title: 'Connected', items: INTEGRATIONS.filter((i) => connected[i.id]) },
    { title: 'Available', items: INTEGRATIONS.filter((i) => !connected[i.id]) },
  ];

  return (
    <main className="nv-page-main">
      <div className="nv-page-heading">
        <h1>Integrations</h1>
        <p>Connect Nivik with the tools you use every day.</p>
      </div>

      {groups.map((group) => (
        <section key={group.title} className={styles.group} aria-label={group.title}>
          <div className={styles.groupHead}>
            <h2>{group.title}</h2>
            <button
              type="button"
              className={styles.viewAll}
              onClick={() => toast(`${group.title} integrations are shown`)}
            >
              View all <ArrowRight size={15} aria-hidden="true" />
            </button>
          </div>
          <div className={styles.grid}>
            {group.items.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                connected={connected[integration.id] ?? false}
                onToggle={() => toggle(integration)}
                onConfigure={() => setConfiguring(integration)}
              />
            ))}
            {group.items.length === 0 && <p className={styles.description}>Nothing here yet.</p>}
          </div>
        </section>
      ))}

      <ChoiceDialog
        open={configuring !== null}
        onOpenChange={(open) => !open && setConfiguring(null)}
        title={configuring?.name ?? ''}
        description="Manage this integration connection."
        layout="row"
        actions={[
          {
            label: 'Configure',
            onSelect: () => toast(`${configuring?.name} settings are coming soon.`),
          },
          {
            label: 'Disconnect',
            onSelect: () => {
              if (configuring) toggle(configuring);
            },
          },
        ]}
      />
    </main>
  );
}

interface IntegrationCardProps {
  integration: Integration;
  connected: boolean;
  onToggle: () => void;
  onConfigure: () => void;
}

function IntegrationCard({ integration, connected, onToggle, onConfigure }: IntegrationCardProps) {
  const size = integration.logoSize ?? 38;
  return (
    <article className={styles.card}>
      <span className={cn(styles.logoWrap, styles[integration.tint])}>
        <Image
          src={integration.logo}
          alt={`${integration.name} logo`}
          width={size}
          height={size}
          style={{ width: size, height: size }}
        />
      </span>
      <div className={styles.copy}>
        <span className={styles.name}>{integration.name}</span>
        <span className={styles.description}>{integration.description}</span>
      </div>
      {connected ? (
        <button
          type="button"
          className={styles.status}
          aria-pressed="true"
          onClick={onToggle}
          title="Click to disconnect"
        >
          <i className={styles.statusDot} aria-hidden="true" />
          Connected
        </button>
      ) : (
        <button type="button" className={styles.connect} aria-pressed="false" onClick={onToggle}>
          Connect
        </button>
      )}
      {connected && (
        <IconButton
          className={styles.settings}
          aria-label={`Configure ${integration.name}`}
          onClick={onConfigure}
        >
          <GearSix size={18} aria-hidden="true" />
        </IconButton>
      )}
    </article>
  );
}
