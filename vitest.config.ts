import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
  test: {
    // Entorno Node (no jsdom/happy-dom — las API routes son server-side)
    environment: 'node',
    // Directorio de tests
    include: ['tests/**/*.test.ts'],
    // Timeout generoso para tests que mockean transacciones
    testTimeout: 15000,
    // Limpiar mocks entre tests
    mockReset: true,
    // Variables de entorno para tests
    env: {
      // JWT_SECRET dummy para que lib/auth.ts no falle al cargarse
      JWT_SECRET: 'test-secret-key-not-used-in-unit-tests',
    },
  },
})
