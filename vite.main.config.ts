import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // Both the main and preload entries are named index.ts (PRD §18), and the
    // Vite plugin derives the output name from the entry — without this they
    // would both emit .vite/build/index.js and silently overwrite each other.
    lib: { entry: 'src/main/index.ts', formats: ['cjs'], fileName: () => 'main.js' },
  },
});
