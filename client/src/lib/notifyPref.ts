/**
 * "Notifications on this device" on/off (docs/note-lists/PRD.md FR-120, decision S1).
 *
 * A page cannot take back the browser's notification permission, so "off" is an app
 * setting kept on the device (`localStorage`, like the theme and the last module). While it
 * is off, the open app shows neither the in-app reminder message nor a system notification.
 */
import type { KeyValueStore } from './modules';

export type { KeyValueStore };

const KEY = 'todoness.localNotifications';

export function localNotificationsOn(storage: KeyValueStore | undefined): boolean {
  try {
    return storage?.getItem(KEY) !== 'off';
  } catch {
    return true; // storage blocked: the default
  }
}

export function setLocalNotifications(storage: KeyValueStore | undefined, on: boolean): void {
  try {
    storage?.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* storage may be blocked; the choice then lasts until reload */
  }
}
