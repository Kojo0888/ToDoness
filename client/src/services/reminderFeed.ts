/** Reminders shown inside the app, next to the system notification (FR-45). */

export interface ReminderMessage {
  key: string;
  title: string;
  body: string;
  /** Where the "Open" link goes. */
  href: string;
}

export interface ReminderFeed {
  push(message: ReminderMessage): void;
  dismiss(key: string): void;
  subscribe(listener: () => void): () => void;
  /** A new array after every change (what `useSyncExternalStore` needs). */
  getSnapshot(): readonly ReminderMessage[];
}

export function createReminderFeed(): ReminderFeed {
  let items: readonly ReminderMessage[] = [];
  const listeners = new Set<() => void>();
  const set = (next: readonly ReminderMessage[]) => {
    items = next;
    for (const l of listeners) l();
  };
  return {
    push(message) {
      if (!items.some((m) => m.key === message.key)) set([...items, message]);
    },
    dismiss: (key) => set(items.filter((m) => m.key !== key)),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => items,
  };
}
