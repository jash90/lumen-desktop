import { useState } from 'react';

import type { Action, QuickAction, Shortcut } from '../../shared/models';
import {
  useQuickActions,
  useRooms,
  useScenes,
  useShortcutConflicts,
  useShortcuts,
  useUpdateSettings,
} from '../hooks/useHue';

/**
 * Editor for quick actions and global shortcuts.
 *
 * Both are the same Action under the hood, so they share one picker: choose what
 * should happen, then either pin it as a button or bind it to a key.
 */

interface Choice {
  label: string;
  action: Action;
}

/** Everything the user can currently point an action at. */
function useChoices(connected: boolean): Choice[] {
  const rooms = useRooms(connected);
  const scenes = useScenes(connected);

  return [
    { label: 'Wyłącz wszystko', action: { kind: 'allOff' } },
    ...(rooms.data ?? []).map((room) => ({
      label: `Przełącz: ${room.name}`,
      action: { kind: 'toggleRoom', id: room.id } as Action,
    })),
    ...(scenes.data ?? []).map((scene) => ({
      label: `Scena: ${scene.name}`,
      action: { kind: 'activateScene', id: scene.id } as Action,
    })),
  ];
}

const describe = (action: Action, choices: Choice[]): string =>
  choices.find((choice) => JSON.stringify(choice.action) === JSON.stringify(action))?.label ??
  'Nieznana akcja';

/** Turns a keydown into an Electron accelerator string. */
function acceleratorFrom(event: React.KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  const key = event.key;
  // A chord that is still only modifiers is not finished yet.
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) return null;
  if (parts.length === 0) return null;

  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join('+');
}

export function ActionEditor({ connected }: { connected: boolean }) {
  const choices = useChoices(connected);
  const quickActions = useQuickActions();
  const shortcuts = useShortcuts();
  const conflicts = useShortcutConflicts();
  const update = useUpdateSettings();

  const [selected, setSelected] = useState(0);
  const [capturing, setCapturing] = useState(false);

  const choice = choices[selected];

  const addQuickAction = (): void => {
    if (!choice) return;
    const next: QuickAction[] = [
      ...quickActions,
      // Date.now() is enough of an id for a local list the user curates by hand.
      { id: `qa-${Date.now()}`, label: choice.label, action: choice.action },
    ];
    update.mutate({ quickActions: next });
  };

  const bindShortcut = (accelerator: string): void => {
    if (!choice) return;
    const next: Shortcut[] = [
      ...shortcuts.filter((shortcut) => shortcut.accelerator !== accelerator),
      { accelerator, action: choice.action },
    ];
    update.mutate({ shortcuts: next });
    setCapturing(false);
  };

  return (
    <div className="space-y-4">
      <div className="card-stack space-y-3 p-4">
        <select
          value={selected}
          onChange={(event) => setSelected(Number(event.target.value))}
          aria-label="Akcja"
          className="min-h-9 w-full rounded-row border border-line bg-surface-raised px-2 text-sm focus-visible:focus-ring"
        >
          {choices.map((entry, index) => (
            <option key={entry.label} value={index}>
              {entry.label}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={addQuickAction}
            className="min-h-9 flex-1 rounded-row border border-line px-3 text-sm transition-colors hover:bg-line/40 focus-visible:focus-ring"
          >
            Przypnij jako przycisk
          </button>
          <button
            type="button"
            onClick={() => setCapturing((value) => !value)}
            onKeyDown={(event) => {
              if (!capturing) return;
              event.preventDefault();
              const accelerator = acceleratorFrom(event);
              if (accelerator) bindShortcut(accelerator);
            }}
            className={`min-h-9 flex-1 rounded-row border px-3 text-sm transition-colors focus-visible:focus-ring ${
              capturing ? 'border-accent bg-accent/10' : 'border-line hover:bg-line/40'
            }`}
          >
            {capturing ? 'Naciśnij skrót…' : 'Przypisz skrót'}
          </button>
        </div>
      </div>

      {quickActions.length > 0 && (
        <div className="card-stack divide-y divide-line">
          {quickActions.map((quickAction) => (
            <Row
              key={quickAction.id}
              title={quickAction.label}
              subtitle="Przycisk na ekranie głównym"
              onRemove={() =>
                update.mutate({
                  quickActions: quickActions.filter((entry) => entry.id !== quickAction.id),
                })
              }
            />
          ))}
        </div>
      )}

      {shortcuts.length > 0 && (
        <div className="card-stack divide-y divide-line">
          {shortcuts.map((shortcut) => {
            const failed = (conflicts.data ?? []).includes(shortcut.accelerator);
            return (
              <Row
                key={shortcut.accelerator}
                title={shortcut.accelerator}
                subtitle={describe(shortcut.action, choices)}
                // A shortcut the OS refused looks identical to a working one
                // unless it says so.
                warning={failed ? 'Skrót zajęty przez inną aplikację' : undefined}
                onRemove={() =>
                  update.mutate({
                    shortcuts: shortcuts.filter(
                      (entry) => entry.accelerator !== shortcut.accelerator,
                    ),
                  })
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

function Row({
  title,
  subtitle,
  warning,
  onRemove,
}: {
  title: string;
  subtitle: string;
  warning?: string;
  onRemove(): void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{title}</p>
        <p className="truncate text-xs text-ink-muted">{subtitle}</p>
        {warning && <p className="mt-0.5 text-xs text-danger">{warning}</p>}
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Usuń ${title}`}
        className="min-h-8 rounded-row px-2 text-sm text-ink-muted transition-colors hover:text-danger focus-visible:focus-ring"
      >
        Usuń
      </button>
    </div>
  );
}
