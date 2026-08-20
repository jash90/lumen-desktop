import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // The preload entry is src/preload/index.ts (PRD §18) and would otherwise emit
    // .vite/build/index.js, clashing with the main process bundle. The main
    // process loads this file by name, so it has to be predictable.
    rollupOptions: { output: { entryFileNames: 'preload.js' } },
  },
});
