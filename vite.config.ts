import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// viteSingleFile inlines all JS, CSS and imported assets (the GLB models under
// src/assets) into one dist/index.html that runs from a double-click on file://.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    target: 'es2020',
  },
})
