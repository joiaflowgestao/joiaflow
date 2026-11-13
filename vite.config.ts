import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// O base path precisa ser o nome do repositório no GitHub Pages (ex.: /joiaflow/).
// Para domínio próprio, defina VITE_BASE_PATH=/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: env.VITE_BASE_PATH || '/joiaflow/',
    plugins: [react()],
    resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
    build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  };
});
