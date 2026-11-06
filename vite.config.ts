import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'TeraFi Clinic', short_name: 'TeraFi', lang: 'es-MX', start_url: '/', scope: '/',
        display: 'standalone', background_color: '#F7F2E8', theme_color: '#3F6B52',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      // Solo recursos estáticos. Nunca se cachean respuestas de Supabase (datos clínicos).
      workbox: { globPatterns: ['**/*.{js,css,html,png}'], navigateFallback: 'index.html', runtimeCaching: [] },
    }),
  ],
})
