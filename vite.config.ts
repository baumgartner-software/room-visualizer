import { defineConfig } from 'vite'

// Relative base path so the build works on GitHub Pages (project page under
// /room-visualizer/) as well as on any other static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    // WebXR requires a secure context; for local testing with a Quest use
    // e.g. `npx vite --host` together with adb reverse or an HTTPS tunnel.
    port: 5173,
  },
})
