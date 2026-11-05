import { useEffect } from 'react';
import { InitialSync, OfflineNoSession, Splash } from './components/Splash';
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
