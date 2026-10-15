import { defineConfig } from 'vite';

// 网页发布在 Pages 的 /app/ 下；本机中继也把它挂在 /app/。
// 开发时 vite 起 5173，/ws 代理到本机中继。
export default defineConfig({
  base: '/app/',
  server: {
    port: 5173,
    proxy: {
      '/ws': { target: 'ws://localhost:8778', ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
  },
});
