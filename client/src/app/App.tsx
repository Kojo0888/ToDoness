import { useEffect } from 'react';
import { InitialSync, OfflineNoSession, Splash } from './components/Splash';
import { UpdateBanner } from './components/UpdateBanner';
import { LoginScreen } from './components/LoginScreen';
import { Shell } from './components/Shell';
import { applyTheme, readTheme, useSession } from './hooks';
import { session } from './services';

export function App() {
  const state = useSession();

  useEffect(() => {
    applyTheme(readTheme());
    void session.boot();
  }, []);

  // Ask the browser not to clear our data when disk space runs low (FR-20).
  const ready = state.status === 'ready';
  useEffect(() => {
    if (ready) void navigator.storage?.persist?.();
  }, [ready]);

  return (
    <>
      <UpdateBanner />
      <Screen state={state} />
    </>
  );
}

function Screen({ state }: { state: ReturnType<typeof useSession> }) {
  switch (state.status) {
    case 'loading':
      return <Splash />;
    case 'login':
      return <LoginScreen email={state.email} reason={state.reason} />;
    case 'offline_no_session':
      return <OfflineNoSession />;
    case 'initial_sync':
      return <InitialSync error={state.error} />;
    case 'ready':
      return <Shell user={state.user} />;
  }
}
