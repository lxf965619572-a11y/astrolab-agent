import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 界面用 Vite 构建到 dist/，主进程用 loadFile 打开；开发时 ASTROLAB_DEV_URL=http://localhost:5173
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: true },
})
