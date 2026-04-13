import { resolve } from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  root: resolve(__dirname, 'example'),
  server: {
    host: true,
    open: '/index.html',
    fs: {
      allow: [
        resolve(__dirname, 'example'),
        resolve(__dirname, 'src')
      ]
    }
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true
  }
})
