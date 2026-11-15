import type { BackupService } from './service';

/**
 * Checks once a minute whether a backup is due (docs/backup/PRD.md FR-237) and now at the start.
 * A check never overlaps the previous one. Returns a function that stops it.
 */
export function startBackupScheduler({
  service,
  intervalMs = 60_000,
}: {
  service: BackupService;
  intervalMs?: number;
}): () => void {
  let checking = false;
  async function tick() {
    if (checking) return;
    checking = true;
    try {
      await service.check();
    } catch (err) {
      console.error('Backup check failed:', err);
    } finally {
      checking = false;
    }
  }
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
