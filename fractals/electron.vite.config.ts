import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      lib: {
        entry: {
          main: resolve(__dirname, 'electron/main.ts'),
          'sync.worker': resolve(__dirname, 'electron/workers/sync.worker.ts'),
          'delete.worker': resolve(__dirname, 'electron/workers/delete.worker.ts'),
          'm3u-sync.worker': resolve(__dirname, 'electron/workers/m3u-sync.worker.ts'),
          'export.worker': resolve(__dirname, 'electron/workers/export.worker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, '.'),
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return
            if (id.includes('framer-motion')) return 'motion'
            if (id.includes('artplayer') || id.includes('hls.js')) return 'player'
            if (id.includes('@dnd-kit')) return 'vendor'
            if (id.includes('@tanstack')) return 'vendor'
            if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
          },
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
    },
  },
})
