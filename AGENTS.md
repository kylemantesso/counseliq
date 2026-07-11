# Agent Instructions

Product-first monorepo: admin is Next.js-only, client is Next.js + Expo. Both products share Convex backend and UI via workspace packages.

## Architecture

```
counsel-iq/
├── apps/
│   ├── admin-web/     # Admin Next.js 15 App Router — thin routes + platform wiring only
│   ├── client-web/    # Client Next.js 15 App Router — thin routes + platform wiring only
│   └── client-mobile/ # Client Expo Router — thin routes + platform wiring only
├── packages/
│   ├── ui/           # Design system (Gluestack v5 + NativeWind v5)
│   ├── admin/        # Admin product code: screens, auth, Convex client
│   ├── client/       # Client product code: screens, auth, Convex client
│   └── course-schema/ # Zod contracts: course definition + ingestion manifest
├── services/
│   └── converter/    # Node/TS document converter (Fly.io/Docker; LibreOffice + poppler)
└── convex/           # Canonical Convex backend (schema, mutations, auth)
```

## Package boundaries

### `@counseliq/ui` — design system only

- **Contains:** Gluestack v5 components (`src/components/ui/*`), `UIProvider`, theme tokens in `global.css` and `gluestack-ui-provider/config.ts`, `src/nativewind-compat.ts` (cssInterop shim)
- **Must NOT contain:** screens, auth, Convex, Solito, business logic, or API calls
- **Styling:** NativeWind v5 + Tailwind CSS v4. Theme tokens are **semantic** (`primary`, `foreground`, `muted`, `card`, `border`, `destructive`) — defined in `global.css` (`@layer theme`, `@theme inline`) and `config.ts`. No `tailwind.config.js`.
- **Add Gluestack primitives** (from repo root):
  ```bash
  npx gluestack-ui@latest add <component> --monorepo --path packages/ui/src/components/ui -y
  ```
- **Exports:** add new public components to `packages/ui/index.ts`; export `global.css` for web via `@counseliq/ui/global.css`
- **v5 component APIs:** Button uses `variant` (`default`, `outline`, `destructive`, …) — not `action="primary"`. Alert uses `variant="default" | "destructive"`. See [v5 docs](https://v5.gluestack.io/ui/docs).

### `@counseliq/admin` / `@counseliq/client` — product layers

- **Contains:**
  - `src/screens/` — full screen components for that product
  - `src/components/` — `AuthGuard`, `AppErrorBoundary`, `Screen`, `AuthScreen`
  - `src/auth/` — Clerk hooks, `AuthProvider`, `useAuth`
  - `src/db/` — `createConvexClient`, re-export of `api` from `convex/_generated`
- **May depend on:** `@counseliq/ui`, `solito`, `convex`, `react-native`
- **Screens must:** compose `@counseliq/ui` components; use `useAuth` from `../auth`; use Solito for navigation (`Link`, `useRouter`, `TextLink`); wrap protected screens in `AuthGuard`; wrap full-screen layouts in `Screen` (or `AuthScreen` for auth flows) for safe-area padding
- **Exports:** add screens to the product package `index.ts`

### App Shells

- **Routes are thin re-exports.** Do not put screen UI or business logic here.
- **All apps wrap the tree with `UIProvider`** from `@counseliq/ui` (inside `providers.tsx` / `_layout.tsx`)
- **Platform-only code stays in apps:**
  - Web: `providers.tsx`, `convex-client-provider.tsx`, `middleware.ts` (Clerk), Sentry/PostHog init
  - Mobile: `_layout.tsx` (Clerk + Convex), `babel.config.js`, `metro.config.js`. Uses **expo-dev-client**
- **Web shared screens:** `'use client'` required on pages that re-export from `@counseliq/admin` or `@counseliq/client` (they use React Native via `react-native-web`)

## Adding a new feature

### New Gluestack UI primitive

1. From repo root: `npx gluestack-ui@latest add <component> --monorepo --path packages/ui/src/components/ui -y`
2. Export from `packages/ui/index.ts`
3. Customize theme in **both** `packages/ui/global.css` and `packages/ui/src/components/ui/gluestack-ui-provider/config.ts` if needed

### New screen

1. Create `packages/admin/src/screens/my-screen.tsx` or `packages/client/src/screens/my-screen.tsx`
2. Compose `@counseliq/ui` components
3. Wrap the root layout in `Screen` from `../components/screen` (applies safe-area insets on mobile)
4. Export from the product package `index.ts`
5. Add thin route:
   - Admin web: `apps/admin-web/app/my-route/page.tsx` → `export { MyScreen as default } from '@counseliq/admin'`
   - Client web: `apps/client-web/app/my-route/page.tsx` → `export { MyScreen as default } from '@counseliq/client'`
   - Client mobile: `apps/client-mobile/app/my-route.tsx` → same re-export from `@counseliq/client`

### Safe area (mobile + notched web)

- App shells must wrap the tree in `SafeAreaProvider` (`apps/client-mobile/app/_layout.tsx`, `apps/admin-web/app/providers.tsx`).
- Shared screens must **not** hand-roll status bar padding. Use `Screen` (default top + bottom insets) or `AuthScreen` for login/signup flows.
- Do not use raw `paddingTop: 20` or `useSafeAreaInsets()` in individual screens — keep inset logic in `Screen` / `AuthScreen`.

### New Convex function

1. Add to `convex/` at repo root (not inside apps)
2. Run `npm run convex:dev` to regenerate types
3. Import via `@counseliq/admin/db/api` or `@counseliq/admin`

### New auth behavior

1. Configure Clerk dashboard + `CLERK_JWT_ISSUER_DOMAIN` on Convex
2. Update `convex/auth.ts` for user mapping if needed
3. Update the product package auth context if needed

### Optional integrations

- **Email:** Resend via `@convex-dev/resend` — set `RESEND_API_KEY` on Convex, run `npm run env:sync:convex-email`
- **Analytics:** PostHog — set `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` / `EXPO_PUBLIC_POSTHOG_PROJECT_TOKEN`
- **Errors:** Sentry — set `NEXT_PUBLIC_SENTRY_DSN` / `EXPO_PUBLIC_SENTRY_DSN`
- **Admin:** set `ADMIN_EMAILS` on Convex deployment (comma-separated)

### User-facing errors (required)

Use structured error codes — never parse or display raw `error.message`.

1. **Backend** (`convex/errors.ts`): throw `appError(AppErrorCode.X)` for expected failures. Codes live in `AppErrorCode`; handlers must not embed user-facing strings.
2. **Frontend** (`packages/admin/src/errors/messages.ts` or `packages/client/src/errors/messages.ts`): map each code to UI copy in `APP_ERROR_MESSAGES`.
3. **UI**: always use `getUserFacingErrorMessage(error, fallback)` — resolves by code, falls back for unknown errors.

```typescript
// convex/auth.ts
import { AppErrorCode, appError } from "./errors";
if (!user) appError(AppErrorCode.INVALID_CREDENTIALS);

// product package screen
catch (error) {
  setError(getUserFacingErrorMessage(error, "Login failed. Check your email and password."));
}
```

## Tech stack

- **Web:** Next.js 15, react-native-web, NativeWind v5, Tailwind CSS v4, Gluestack UI v5, Solito, Convex
- **Mobile:** Expo 54, Expo Router, React Native 0.81, React 19, NativeWind v5, Gluestack UI v5, **expo-dev-client** (not Expo Go)
- **Backend:** Convex (`convex/` at repo root)
- **Monorepo:** npm workspaces + Turborepo (`turbo.json`)
- **UI docs:** [gluestack.io/llms.txt](https://gluestack.io/llms.txt) · [v5.gluestack.io](https://v5.gluestack.io/ui/docs)

## Commands (run from repo root)

| Command | Purpose |
|---------|---------|
| `npm run dev` / `dev:web` | Admin Next.js dev server |
| `npm run dev:client:web` | Client Next.js dev server |
| `npm run dev:client:mobile` | Metro dev server (requires dev client — run `npx expo run:ios` first) |
| `npm run build:client:mobile:dev` | EAS development build |
| `npm run dev:all` | Convex + admin web + client web + client mobile in parallel |
| `npm run dev:stack` | Full local ingestion stack: MinIO + converter (Docker) + local Convex + web |
| `npm run walkthrough:local` | E2e pipeline run against the `dev:stack` local deployment |
| `npm run convex:dev` | Convex dev + codegen |
| `npm run build:admin:web` / `build:client:web` | Production web builds |
| `npm run typecheck` | Turborepo typecheck across workspaces |
| `npm run init` | Interactive new project setup (Convex + Clerk + Vercel) |
| `npm run env:sync:convex-email` | Push Resend env vars to Convex |

## Environment variables

- Web: `NEXT_PUBLIC_CONVEX_URL` in `apps/admin-web/.env.local` and `apps/client-web/.env.local`
- Mobile: `EXPO_PUBLIC_CONVEX_URL` in `apps/client-mobile/.env` (see `apps/client-mobile/.env.example`)
- Use the **same** Convex deployment URL for client web and client mobile
- Ingestion (Convex deployment, `npx convex env set`): `OBJECT_STORE_ENDPOINT`, `OBJECT_STORE_REGION`, `OBJECT_STORE_BUCKET`, `OBJECT_STORE_ACCESS_KEY_ID`, `OBJECT_STORE_SECRET_ACCESS_KEY`, `CONVERTER_URL`, `CONVERTER_CALLBACK_SECRET`, optional `CONVERTER_TIMEOUT_MS` / `CONVERTER_CALLBACK_URL`
- Converter (Fly secrets / docker env): same `OBJECT_STORE_*` set plus `CONVERTER_CALLBACK_SECRET` and `CONVEX_CALLBACK_URL` — see `convex/pipeline/README.md` for setup steps

## Gluestack v5 styling reference

This repo uses **NativeWind v5 + Tailwind CSS v4** with semantic tokens. Key files:

| File | Purpose |
|------|---------|
| `packages/ui/global.css` | Tailwind v4 imports, `@layer theme`, `@theme inline` |
| `packages/ui/src/components/ui/gluestack-ui-provider/config.ts` | RN runtime CSS vars via `vars()` |
| `gluestack-ui.config.json` | CLI monorepo config (repo root) |
| `packages/ui/src/nativewind-compat.ts` | `cssInterop` shim for generated components |

Platform config: `apps/admin-web/postcss.config.js`, `apps/client-mobile/metro.config.js`, `apps/client-mobile/babel.config.js`.

Full LLM-oriented docs: [gluestack.io/llms.txt](https://gluestack.io/llms.txt) · Component API: [v5.gluestack.io](https://v5.gluestack.io/ui/docs)

## Do not

- Put screen UI in app shells — use `packages/admin` or `packages/client`
- Put business logic or Convex hooks in `packages/ui`
- Add raw StyleSheet-based components in `packages/ui` — use Gluestack + NativeWind
- Use v3 color classes (`text-typography-500`, `bg-background-0`, `border-outline-200`, `action="primary"`) — v5 uses semantic tokens (`text-muted-foreground`, `bg-card`, `border-border`, `variant="default"`)
- Add `tailwind.config.js` or `nativewind/babel` — v5 is CSS-first via PostCSS
- Create separate `auth` or `db` packages (consolidated in `@counseliq/admin`)
- Use DOM-only components (`div`, Tailwind class strings on web-only elements) in shared screens — use RN primitives / Gluestack for cross-platform
- Commit unless explicitly asked
- Edit generated files in `convex/_generated/`

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
