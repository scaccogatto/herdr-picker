import { defineConfig, type ViteUserConfig } from 'vitest/config'

export default defineConfig(({ mode }): ViteUserConfig => {
  if (mode === 'extension') {
    return {
      publicDir: 'extension',
      build: {
        lib: {
          entry: { content: 'src/extension/content.ts', background: 'src/extension/background.ts' },
          formats: ['es'],
          fileName: (_format: string, name: string) => `${name}.js`,
        },
        outDir: 'dist/extension',
        emptyOutDir: true,
        minify: false,
        target: 'es2022',
      },
    }
  }

  return {
    build: {
      lib: {
        entry: { host: 'src/host.ts', cli: 'src/cli.ts' },
        formats: ['es'],
        fileName: (_format: string, name: string) => `${name}.js`,
      },
      rolldownOptions: {
        external: [/^node:/],
      },
      minify: false,
      target: 'node22',
    },
    test: {
      include: ['src/__tests__/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['src/__tests__/**'],
        reporter: ['text', 'json-summary'],
        // A floor a little under the current numbers (lines ~65%), so coverage cannot silently drop;
        // picker.ts's browser-only paths are covered by the Playwright suite instead
        thresholds: { lines: 60, statements: 60, functions: 65, branches: 50 },
      },
    },
  }
})
