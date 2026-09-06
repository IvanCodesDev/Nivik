'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export type SwitchProps = ComponentProps<typeof RadixSwitch.Root>;

export function Switch({ className, ...props }: SwitchProps) {
  return (
    <RadixSwitch.Root className={cn('nv-switch', className)} {...props}>
      <RadixSwitch.Thumb className="nv-switch__thumb" />
    </RadixSwitch.Root>
  );
}
