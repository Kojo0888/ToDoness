import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ask the user before switching to a new version (see UpdateBanner).
      registerType: 'prompt',
      injectRegister: false,
      // Our own service worker (src/sw/sw.ts): the offline app shell plus web push.
      strategies: 'injectManifest',
      srcDir: 'src/sw',
      filename: 'sw.ts',
      manifest: {
        name: 'ToDoness',
        short_name: 'ToDoness',
        description: 'Simple to-do lists that keep working offline.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2851d6',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        // Cache the app itself. API calls are never cached: data comes from IndexedDB.
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
    }),
  ],
  server: {
    // In development the API runs separately on port 3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
