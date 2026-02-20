import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import vue2 from '@vitejs/plugin-vue2'
import Components from 'unplugin-vue-components/vite'
import { VuetifyResolver } from 'unplugin-vue-components/resolvers'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import dotenv from "dotenv";

import { execSync } from 'child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'path';
import globals from './shared/smartcharge-globals.json'; // Adjusted to resolve from `shared`
import { VitePWA } from 'vite-plugin-pwa'

dotenv.config();

const commitHash = process.env.SOURCE_VERSION || execSync('git rev-parse --short HEAD').toString().trim();
const serverURL = `http://${process.env.SERVER_IP ? (process.env.SERVER_IP.includes(":" ) ? `[${process.env.SERVER_IP}]` : process.env.SERVER_IP) : "localhost"}:${process.env.SERVER_PORT || globals.DEFAULT_PORT}`;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'app', // Root directory for the Vue app
  envDir: '../', // Backing out of the Vue app root to the project root
  build: {
    outDir: '../dist/app', // Output directory
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600,
  },
  define: {
    COMMIT_HASH: JSON.stringify(commitHash),
  },
  server: {
    proxy: {
      ["/api"]: {
        target: serverURL,
        ws: true,
      },
    },
  },
  resolve: {
    // extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    alias: {
      '@app': path.resolve(__dirname, './app/src'),
      '@shared': path.resolve(__dirname, './shared'),
      '@providers': path.resolve(__dirname, './providers'),
      '@vuetify': fileURLToPath(new URL('./node_modules/vuetify', import.meta.url)), // Alias for vuetify
      'type-graphql': 'type-graphql/dist/browser-shim',
    },
  },
  plugins: [
    vue2(), // Vue 2 plugins
    Components({ resolvers: [VuetifyResolver()] }),
    nodePolyfills(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Never cache API/GraphQL calls
            urlPattern: ({ url }) => url.pathname.startsWith('/api'),
            handler: 'NetworkOnly',
          },
          {
            // Prefer network for the app shell so updates land quickly
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'html-cache',
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
      manifest: {
        name: 'SmartCharge',
        short_name: 'SmartCharge',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#4DBA87',
        icons: [
          {
            src: 'img/icons/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'img/icons/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'img/icons/apple-touch-icon-180x180.png',
            sizes: '180x180',
            type: 'image/png'
          }
        ]
      }
    }),
    viteStaticCopy({ targets: [{ src: 'public/*', dest: '.' }] }),
  ],
});
