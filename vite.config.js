import { defineConfig } from 'vite';
import fs from 'fs';

export default defineConfig({
  server: {
    host: true,
    port: 3000, // You can customize the port if needed
    https: {
      key: fs.readFileSync('/var/www/nostrclient.local.taylorperron.com/keys/selfsigned.key'),
      cert: fs.readFileSync('/var/www/nostrclient.local.taylorperron.com/keys/selfsigned.crt'),
    },
  },
  plugins: [
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace(/YOUR_IMAGE_URL_HERE/g, process.env.VITE_OG_IMAGE)
                   .replace(/YOUR_WEBSITE_URL_HERE/g, process.env.VITE_OG_URL)
                   .replace(/YOUR_IMAGE_URL_HERE/g, process.env.VITE_TWITTER_IMAGE);
      }
    }
  ],
  optimizeDeps: {
    include: ["nostr-tools"], // Ensure nostr-tools is pre-bundled
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      external: [], // Forces ALL dependencies to be bundled
    },
    commonjsOptions: {
      include: [/node_modules/], // Ensure dependencies in node_modules are processed
      transformMixedEsModules: true, // Allow mixed ESM/CJS modules
    },
  },
  resolve: {
    alias: {
      "nostr-tools": "/node_modules/nostr-tools", // Force resolution
    }
  }
});
