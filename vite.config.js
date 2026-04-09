import { defineConfig } from 'vite'

export default defineConfig({
  root: 'example',
  server: {
    host: true
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
})
