import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/anura-staff-portal/', 
  plugins: [react()],
});