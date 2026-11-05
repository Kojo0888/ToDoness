import { useEffect, useState } from 'react';

type Health = 'checking' | 'ok' | 'unreachable';

/** Placeholder page for Step 0: shows whether the API answers. */
export function App() {
  const [health, setHealth] = useState<Health>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setHealth(res.ok ? 'ok' : 'unreachable'))
      .catch(() => setHealth('unreachable'));
  }, []);

  return (
    <main>
      <h1>ToDoness</h1>
      <p>
        Server: <strong data-testid="health">{health}</strong>
      </p>
    </main>
  );
}
