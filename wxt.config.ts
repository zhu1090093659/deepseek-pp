import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  outDir: 'dist',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'DeepSeek++',
    description: 'Agentic memory & skill system for DeepSeek',
    version: '0.1.0',
    permissions: ['sidePanel', 'storage'],
    side_panel: {
      default_path: 'sidepanel.html',
    },
    host_permissions: ['*://chat.deepseek.com/*'],
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
