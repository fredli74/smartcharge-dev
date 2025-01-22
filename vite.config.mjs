import { defineConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import globals from './shared/smartcharge-globals.json'; // Adjusted to resolve from `shared`
import { execSync } from 'child_process';
import { createVuePlugin as vue } from 'vite-plugin-vue2';
import { fileURLToPath, URL } from 'node:url';

const commitHash = process.env.SOURCE_VERSION || execSync('git rev-parse --short HEAD').toString().trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    root: 'app', // Root directory for the Vue app
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
        vue(), // Vue 2 plugin
        viteStaticCopy({
            targets: [
                {
                    src: 'public/*',
                    dest: '.',
                    rename: (fileName) => (fileName.match(/index\.html|\.DS_Store/) ? null : fileName),
                },
            ],
        }),
    ],
});
