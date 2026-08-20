import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Motion and geolocation need a secure context on iOS. `npm run dev -- --https`
    // or a tunnel is required to test on a real phone over the LAN.
    port: 5173,
  },
  build: { target: 'es2020', sourcemap: false },
});
