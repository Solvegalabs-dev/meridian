import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  // Component tests are .tsx. tsconfig keeps "jsx": "preserve" for Next, so vitest needs the automatic runtime.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./*" path mapping. Without this,
    // any test that imports a module using a real (non-mocked) "@/..."
    // import fails to resolve under vitest even though it compiles fine
    // under tsc/next build.
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'components/**/*.test.tsx'],
  },
})
