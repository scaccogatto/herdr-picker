# Upstream

The modules below were copied from [vite-plugin-herdr](https://github.com/scaccogatto/vite-plugin-herdr) at commit `f5ef5e1` on 2026-09-09 and are owned by this repository since then. There is no dependency between the two projects: fixes are ported by hand in either direction.

| Here | There |
|---|---|
| `src/extension/picker.ts` | `src/client/index.ts` |
| `src/extension/dom.ts` | `src/client/dom.ts` |
| `src/extension/agents.ts` | `src/client/agents.ts` |
| `src/compose.ts` | `src/compose.ts` |
| `src/types.ts` | `src/types.ts` |
| `src/herdr.ts` | `src/herdr.ts` |
| `src/validate.ts` | `src/http.ts` |
| `src/bridge.ts` | `src/server.ts` |
| `src/__tests__/helpers/fake-herdr.ts` | `src/__tests__/helpers/fake-herdr.ts` |
| `src/__tests__/*.spec.ts` | the matching specs (`validate.spec.ts` was `http.spec.ts`, `bridge.spec.ts` was `server.spec.ts`) |
