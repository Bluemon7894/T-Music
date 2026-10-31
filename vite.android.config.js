import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const local = (p) => fileURLToPath(new URL(p, import.meta.url));

// The Android app is the same page plus the code the desktop app runs in its main process, with
// the few Node and Electron APIs that code uses answered by the phone.
export default defineConfig({
  root: 'src',
  base: '/',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^electron$/, replacement: local('./src/android/shims/electron.js') },
      { find: /^fs$/, replacement: local('./src/android/shims/fs.js') },
      { find: /^path$/, replacement: local('./src/android/shims/path.js') },
      { find: /^youtubei\.js$/, replacement: local('./src/android/youtubei.js') },
    ],
  },
  build: {
    outDir: '../dist-android',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: local('./src/android.html') },
  },
});
