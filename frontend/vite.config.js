import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://optimizer.hivemindnestor.com',
        changeOrigin: true,
        secure: true,
        cookieDomainRewrite: 'localhost',
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Group third-party deps into a few stable vendor chunks so:
        //   1. The main app bundle drops below the 500kB warning threshold.
        //   2. Browsers can cache vendor code across deploys (it changes far
        //      less often than our app code).
        // jspdf / xlsx / html2canvas stay as their own auto-split chunks
        // because they're already loaded via dynamic import() at use sites.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-markdown') || id.includes('remark-') || id.includes('rehype-') || id.includes('mdast-') || id.includes('hast-') || id.includes('micromark') || id.includes('unified') || id.includes('unist-')) return 'vendor-markdown';
          if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router';
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'vendor-react';
          if (id.includes('@headlessui')) return 'vendor-headlessui';
          if (id.includes('axios')) return 'vendor-http';
        },
      },
    },
  },
})
