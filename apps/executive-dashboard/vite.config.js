import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Dealer entry. contract-auditor.html was a Tailwind-era standalone page;
      // its function now lives inside the app, so shipping it would mean
      // shipping a second, unstyled copy of the product.
      // The founder console is a second, separate page (founder/index.html,
      // served at /founder) so that nothing founder-related ships inside the
      // dealer app's own entry. See founder/app.js.
      input: {
        main: resolve(__dirname, 'index.html'),
        founder: resolve(__dirname, 'founder/index.html'),
      },
    },
  },
  server: { port: 3000 },
});
