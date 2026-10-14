import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Vite loads .env files into `import.meta.env`, not `process.env`, so reading process.env here
  // could never see VITE_DEV_API_TARGET and the proxy always fell back to its default. loadEnv is
  // the supported way to read .env values from the config file itself.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // The API lives at /api/v1 (see src/api/http.js).
        '/api': { target: env.VITE_DEV_API_TARGET || process.env.VITE_DEV_API_TARGET || 'http://localhost:8080', changeOrigin: true },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{js,jsx}'],
      setupFiles: ['./src/test/setup.js'],
      css: false,
    },
  };
});
