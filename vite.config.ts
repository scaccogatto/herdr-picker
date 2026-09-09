import { defineConfig } from 'vitest/config'

export default defineConfig(({ mode }) => {
  if (mode === 'extension') {
    return {
      publicDir: 'extension',
      build: {
        lib: {
          entry: { content: 'src/extension/content.ts', background: 'src/extension/background.ts' },
          formats: ['es'],
          fileName: (_format, name) => `${name}.js`,
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
        fileName: (_format, name) => `${name}.js`,
      },
      rolldownOptions: {
        external: [/^node:/],
      },
      minify: false,
      target: 'node20',
    },
    test: {
      include: ['src/__tests__/**/*.spec.ts'],
      coverage: {
        provider: 'v8',
        include: ['src/**'],
        exclude: ['src/__tests__/**'],
        reporter: ['text', 'json-summary'],
      },
    },
  }
})
