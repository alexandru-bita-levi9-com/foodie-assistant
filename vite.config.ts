import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cloudflare()],
  server: {
    proxy: {
      '/wolt-api': {
        target: 'https://consumer-api.wolt.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wolt-api/, ''),
        headers: {
          Origin: 'https://wolt.com',
          Referer: 'https://wolt.com/',
          platform: 'Web',
        },
      },
      '/wolt-auth': {
        target: 'https://authentication.wolt.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wolt-auth/, ''),
        headers: {
          Origin: 'https://wolt.com',
          Referer: 'https://wolt.com/',
        },
      },
    },
  },
})