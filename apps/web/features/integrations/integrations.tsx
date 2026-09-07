'use client';

import { cn, IconButton, useToast } from '@nivik/ui';
import { ArrowRight, GearSix } from '@phosphor-icons/react';
import Image from 'next/image';
import { useState } from 'react';
import { ChoiceDialog } from '@/components/choice-dialog';
import { INTEGRATIONS, type Integration } from '@/lib/data/integrations';
import { useT } from '@/lib/i18n/provider';
import styles from './integrations.module.css';

/** Integrations (PRD 5.5): connect Nivik with everyday tools. Connection state is local for now. */
export function Integrations() {
  const t = useT();
  const toast = useToast();
  const [connected, setConnected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(INTEGRATIONS.map((i) => [i.id, i.connected])),
  );
  const [configuring, setConfiguring] = useState<Integration | null>(null);

  const toggle = (integration: Integration) => {
    const next = !connected[integration.id];
    setConnected((state) => ({ ...state, [integration.id]: next }));
    toast(
      next
        ? t.integrations.connectedToast(integration.name)
        : t.integrations.disconnectedToast(integration.name),
    );
  };

  const groups: { id: string; title: string; items: Integration[] }[] = [
    {
      id: 'connected',
      title: t.integrations.connectedGroup,
      items: INTEGRATIONS.filter((i) => connected[i.id]),
    },
    {
      id: 'available',
      title: t.integrations.availableGroup,
      items: INTEGRATIONS.filter((i) => !connected[i.id]),
    },
  ];

  return (
    <main className="nv-page-main">
      <div className="nv-page-heading">
        <h1>{t.integrations.title}</h1>
        <p>{t.integrations.subtitle}</p>
      </div>

      {groups.map((group) => (
        <section key={group.id} className={styles.group} aria-label={group.title}>
          <div className={styles.groupHead}>
            <h2>{group.title}</h2>
            <button
              type="button"
              className={styles.viewAll}
              onClick={() => toast(t.integrations.viewAllToast(group.title))}
            >
              {t.integrations.viewAll} <ArrowRight size={15} aria-hidden="true" />
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
            {group.items.length === 0 && (
              <p className={styles.description}>{t.integrations.empty}</p>
            )}
          </div>
        </section>
      ))}

      <ChoiceDialog
        open={configuring !== null}
        onOpenChange={(open) => !open && setConfiguring(null)}
        title={configuring?.name ?? ''}
        description={t.integrations.manage}
        layout="row"
        actions={[
          {
            label: t.common.configure,
            onSelect: () => toast(t.integrations.settingsSoon(configuring?.name ?? '')),
          },
          {
            label: t.integrations.disconnect,
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
  const t = useT();
  const size = integration.logoSize ?? 38;
  return (
    <article className={styles.card}>
      <span className={cn(styles.logoWrap, styles[integration.tint])}>
        <Image
          src={integration.logo}
          alt={t.integrations.logoAlt(integration.name)}
          width={size}
          height={size}
          style={{ width: size, height: size }}
        />
      </span>
      <div className={styles.copy}>
        <span className={styles.name}>{integration.name}</span>
        <span className={styles.description}>{t.integrations.descriptions[integration.id]}</span>
      </div>
      {connected ? (
        <button
          type="button"
          className={styles.status}
          aria-pressed="true"
          onClick={onToggle}
          title={t.integrations.clickToDisconnect}
        >
          <i className={styles.statusDot} aria-hidden="true" />
          {t.integrations.connected}
        </button>
      ) : (
        <button type="button" className={styles.connect} aria-pressed="false" onClick={onToggle}>
          {t.integrations.connect}
        </button>
      )}
      {connected && (
        <IconButton
          className={styles.settings}
          aria-label={t.integrations.configure(integration.name)}
          onClick={onConfigure}
        >
          <GearSix size={18} aria-hidden="true" />
        </IconButton>
      )}
    </article>
  );
}
