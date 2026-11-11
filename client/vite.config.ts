import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * vite-plugin-pwa 2.0 still builds the service worker with Rollup's `inlineDynamicImports`,
 * which Rolldown (Vite 8) reports as deprecated. Same meaning, current name.
 */
const swCodeSplittingOff: Plugin = {
  name: 'todoness:sw-code-splitting-off',
  outputOptions(output) {
    if (!('inlineDynamicImports' in output)) return null;
    const { inlineDynamicImports, ...rest } = output as typeof output & {
      inlineDynamicImports?: boolean;
    };
    return inlineDynamicImports ? { ...rest, codeSplitting: false } : rest;
  },
};

/** Libraries in their own files: smaller chunks, and they stay cached across app updates. */
const vendorGroups = [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
  { name: 'dexie', test: /node_modules[\\/]dexie/ },
  { name: 'zod', test: /node_modules[\\/]zod[\\/]/ },
  { name: 'dnd-kit', test: /node_modules[\\/]@dnd-kit[\\/]/ },
  { name: 'vendor', test: /node_modules[\\/]/ },
];

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
        buildPlugins: { vite: [swCodeSplittingOff] },
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: vendorGroups } },
    },
  },
  server: {
    // In development the API runs separately on port 3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
