'use client';

import { CaretDown, Check } from '@phosphor-icons/react';
import { Select as RadixSelect } from 'radix-ui';
import { cn } from './cn';

export interface SelectOption<V extends string = string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  id?: string;
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SelectOption<V>[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/**
 * Styled listbox built on Radix Select. Replaces the prototype's hand-rolled
 * "custom-select" enhancement of native `<select>` elements.
 */
export function Select<V extends string = string>({
  id,
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  ...aria
}: SelectProps<V>) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger id={id} className={cn('nv-select', className)} {...aria}>
        <span className="nv-select__label">
          <RadixSelect.Value placeholder={placeholder} />
        </span>
        <RadixSelect.Icon className="nv-select__caret">
          <CaretDown size={15} weight="bold" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          className="nv-select__menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <RadixSelect.Viewport className="nv-select__viewport">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="nv-select__option"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="nv-select__check">
                  <Check size={14} weight="bold" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
