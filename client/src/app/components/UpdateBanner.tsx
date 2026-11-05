import { useSyncExternalStore } from 'react';
import { t } from '../strings';
import { applyUpdate, updateStore } from '../update';

export function UpdateBanner() {
  const needRefresh = useSyncExternalStore(updateStore.subscribe, updateStore.getSnapshot);
  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span>{t.update.available}</span>
      <button type="button" onClick={applyUpdate}>
        {t.update.reload}
      </button>
    </div>
  );
}
