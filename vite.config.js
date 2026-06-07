import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { open: true, port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split heavy vendor libraries into their own chunks so the main app
        // bundle stays small and the big dependencies cache independently.
        manualChunks: {
          react: ['react', 'react-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
