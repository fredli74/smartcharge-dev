import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import vue2 from '@vitejs/plugin-vue2'
import Components from 'unplugin-vue-components/vite'
import { VuetifyResolver } from 'unplugin-vue-components/resolvers'

import { execSync } from 'child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'path';
import globals from './shared/smartcharge-globals.json'; // Adjusted to resolve from `shared`

const commitHash = process.env.SOURCE_VERSION || execSync('git rev-parse --short HEAD').toString().trim();
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
            [globals.API_PATH]: {
                target: `http://localhost:${process.env.SERVER_PORT || globals.DEFAULT_PORT}`,
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
        viteStaticCopy({ targets: [{ src: 'public/*', dest: '.' }] }),
    ],
});
