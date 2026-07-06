# packages/ui

Design system only. See [root AGENTS.md](../../AGENTS.md).

**Gluestack v5 + NativeWind v5 + Tailwind CSS v4.** Full LLM docs: [gluestack.io/llms.txt](https://gluestack.io/llms.txt)

## Contains

- Gluestack v5 primitives in `src/components/ui/*`
- `UIProvider`, `global.css`, `gluestack-ui-provider/config.ts`
- `src/nativewind-compat.ts` — `cssInterop` shim for v5-generated components

## Must NOT contain

Screens, auth, Convex, Solito, or business logic.

## Theming

Semantic tokens (`primary`, `foreground`, `muted`, `card`, `border`, `destructive`, …) — **not** v3 scales (`primary-500`, `typography-900`).

Update both `global.css` and `config.ts` when changing brand colors.

## Add a component

```bash
# from repo root
npx gluestack-ui@latest add <component> --monorepo --path packages/ui/src/components/ui -y
```

Export from `index.ts` after adding.
