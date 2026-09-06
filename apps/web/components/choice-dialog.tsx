'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@nivik/ui';

export interface ChoiceAction {
  label: string;
  onSelect: () => void;
  variant?: 'soft' | 'primary' | 'danger';
}

export interface ChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  actions?: ChoiceAction[];
  layout?: 'grid' | 'stack' | 'row';
}

/** Small notice dialog with optional card-style choices (the prototype's `dialog(title, text, actions)`). */
export function ChoiceDialog({
  open,
  onOpenChange,
  title,
  description,
  actions = [],
  layout = 'grid',
}: ChoiceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {actions.length > 0 && (
          <DialogActions layout={layout}>
            {actions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant ?? 'soft'}
                onClick={() => {
                  onOpenChange(false);
                  action.onSelect();
                }}
              >
                {action.label}
              </Button>
            ))}
          </DialogActions>
        )}
      </DialogContent>
    </Dialog>
  );
}
