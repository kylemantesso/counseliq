# CounselIQ

A production-ready universal counseliq with Next.js 15, Expo (React Native), Convex (auth + database), and Gluestack UI v5 (NativeWind v5 + Tailwind v4). Web and mobile share the same Convex backend, auth logic, screens, and design system.

**Repository:** [github.com/kylemantesso/counseliq](https://github.com/kylemantesso/counseliq)

## Features

- **Next.js 15** — App Router, TypeScript, react-native-web for shared screens
- **Expo 54** — React Native app with Expo Router (iOS, Android); dev builds via `expo-dev-client` (not Expo Go)
- **Clerk** — Authentication (email/password, OAuth) with Convex JWT integration
- **Convex** — Real-time database, notification outbox, Resend email, push notifications
- **PostHog + Sentry** — Optional analytics and error monitoring (no-op without env vars)
- **Gluestack UI v5** — Universal component library in `@counseliq/ui` (NativeWind v5 / Tailwind v4)
- **Shared packages** — `@counseliq/ui` (design system) and `@counseliq/app` (screens, auth, db)
- **Turborepo** — Cached builds and parallel dev tasks
- **Example feature** — `/tasks` route demonstrating AuthGuard + Convex CRUD
- **Vercel + EAS** — Web deploy config and mobile build profiles

## Starting a new project

### Prerequisites

- **Node.js 20+** and **npm 10+**
- **Xcode** (macOS, for iOS) or **Android Studio** (for Android) — for local mobile dev builds
- Accounts: [Convex](https://convex.dev), [Vercel](https://vercel.com) (for automated setup), [Expo](https://expo.dev) (optional, for EAS cloud builds)

### 1. Clone the template

```bash
git clone https://github.com/kylemantesso/counseliq.git my-app
cd my-app
npm install
```

To start with a clean git history:

```bash
rm -rf .git && git init && git add . && git commit -m "Initial commit from counseliq"
```

### 2. Bootstrap (recommended)

Run the interactive init wizard. It prompts for API tokens (or reads them from the environment), then creates Convex, Clerk, and Vercel projects, renames the template, writes env files, and deploys.

```bash
npm run init
```

You'll be prompted for:

| Prompt | Where to get it |
|--------|-----------------|
| **Convex deploy token** | [Convex Dashboard](https://dashboard.convex.dev) → Settings → Deploy Keys |
| **Vercel token** | [vercel.com/account/tokens](https://vercel.com/account/tokens) |
| **Clerk** (optional auto-create) | Run `npx clerk auth login` first, or paste a [Platform API key](https://dashboard.clerk.com/user/developers) |

You can also export tokens before running (skips those prompts):

```bash
export CONVEX_TOKEN="your-convex-token"
export VERCEL_TOKEN="your-vercel-token"
export CLERK_PLATFORM_API_KEY="your-clerk-platform-key"  # optional
npm run init
```

The wizard asks for a display name and bundle ID prefix (e.g. `com.mycompany`), then:

1. Creates a **Convex** project and deploys the backend
2. Creates a **Vercel** project and sets env vars
3. Creates a **Clerk** application (via Clerk CLI or Platform API), sets up the Convex JWT template, and writes Clerk keys locally + on Vercel/Convex

After init, set your Apple Team ID in `apps/mobile/app.json` if building for iOS:

```json
"ios": {
  "appleTeamId": "YOUR_TEAM_ID"
}
```

### Manual setup (alternative)

If you prefer to set things up yourself:

```bash
npm run convex:dev   # log in, create a Convex project, copy the deployment URL

cp apps/web/.env.example apps/web/.env.local
cp apps/mobile/.env.example apps/mobile/.env
# Set NEXT_PUBLIC_CONVEX_URL and EXPO_PUBLIC_CONVEX_URL to the same Convex URL
```

### Recovering from a failed init

If init partially completed (Convex/Vercel created but deploy failed), finish manually:

**1. Clerk + Convex auth** (required for deploy and login)

```bash
# Create a Clerk app at https://dashboard.clerk.com/apps/new
# Activate Convex integration → copy Frontend API URL (https://xxx.clerk.accounts.dev)

# Link Convex (if .env.local is missing):
echo 'CONVEX_DEPLOYMENT=dev:YOUR-DEPLOYMENT' >> .env.local   # from Convex dashboard
echo 'NEXT_PUBLIC_CONVEX_URL=https://YOUR-DEPLOYMENT.convex.cloud' >> .env.local

# Set issuer BEFORE deploy:
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://YOUR-INSTANCE.clerk.accounts.dev

# Deploy backend:
npx convex deploy
```

**2. Local env files** — ensure these exist:

- `apps/web/.env.local` — `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`
- `apps/mobile/.env` — `EXPO_PUBLIC_CONVEX_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`

**3. Vercel** — connect **your** GitHub repo (not the template repo), then:

```bash
npm run deploy          # or: npx vercel deploy --prod from repo root
```

If Vercel shows "No framework detected", confirm root `vercel.json` has `buildCommand: npm run build:web` and `outputDirectory: apps/web/.next`.

**4. Local dev** (works without Vercel deploy):

```bash
npm run dev:all
```

### 3. Build the mobile dev client (one-time)

Mobile uses **development builds** (`expo-dev-client`), not Expo Go.

```bash
cd apps/mobile
npx expo run:ios        # iOS simulator (requires Xcode)
# or: npx expo run:android
# or: npx eas build --profile development --platform ios
cd ../..
```

Rebuild when you add or change native dependencies.

### 4. Run locally

```bash
npm run dev:all        # Convex + web + mobile

# Or individually:
npm run convex:dev
npm run dev:web        # http://localhost:3005
npm run dev:mobile     # Metro — open the dev client app on your device/simulator
```

### 5. Verify

1. Sign up at `/signup`, log in, visit `/dashboard`
2. Try `/tasks` — add, complete, and delete a task
3. Repeat on mobile via the dev client

## Quick Start

```bash
git clone https://github.com/kylemantesso/counseliq.git my-app
cd my-app
npm install
npm run init   # or manual setup — see above
```

## Demo (10-minute pilot)

The course-generation pipeline can be demoed end-to-end — upload source
documents, review three human gates, **watch the course play** (real voice,
cards animating on word anchors, captions), and publish:

```bash
TTS_PROVIDER=mock npm run dev:stack                     # free rehearsal (or set ELEVENLABS_API_KEY)
npm run walkthrough:local -- --yes --pause-at-gate-3    # in another terminal
# …open the printed player URL, watch a unit, edit a sentence, approve gate 3
```

The full numbered demo script, operator setup (ElevenLabs key, brand voice,
pronunciation lexicon), and pipeline architecture live in
[`convex/pipeline/README.md`](convex/pipeline/README.md).

## Project Structure

```
counseliq/
├── apps/
│   ├── web/                 # Next.js — thin routes + platform wiring
│   └── mobile/              # Expo — thin routes + platform wiring
├── packages/
│   ├── ui/                  # Gluestack v5 + NativeWind design system
│   └── app/                 # Screens, AuthGuard, auth, Convex client
├── convex/                  # Convex backend (schema, auth, tasks)
├── turbo.json               # Turborepo task config
├── AGENTS.md                # Agent instructions
└── package.json             # Workspaces + root scripts
```

## Mobile development

This template uses **development builds** (`expo-dev-client`), not Expo Go. OAuth (Google/Apple) and native modules require your app's bundle identifier.

**First time setup** (from `apps/mobile`):

```bash
# Local build (requires Xcode or Android Studio)
npx expo run:ios        # iOS simulator
npx expo run:android    # Android emulator/device

# Or cloud build via EAS (works without local native tooling)
npx eas build --profile development --platform ios
```

Then from repo root, `npm run dev:mobile` starts Metro. Open the dev client app on your device/simulator — it connects automatically.

Rebuild the dev client when you add or change native dependencies.

Add app icons and splash images in `apps/mobile/app.json` when you're ready to ship (see [Expo app config](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/)).

## Authentication

- **Web:** `/signup`, `/login`, `/dashboard`, `/tasks` (protected via `AuthGuard`)
- **Mobile:** Same flows; token in `expo-secure-store`
- Auth backend: `convex/auth.ts`; client: `packages/app/src/auth/`

## Example: Tasks feature

After logging in, visit `/tasks` to add, complete, and delete tasks. Backend: `convex/tasks.ts`. Screen: `packages/app/src/screens/tasks-screen.tsx`.

## Scripts (root)

| Script | Description |
|--------|-------------|
| `npm run dev:all` | Convex + web + mobile in parallel |
| `npm run dev` / `dev:web` | Next.js dev server |
| `npm run dev:mobile` | Metro dev server (requires dev client app) |
| `npm run build:mobile:dev` | EAS development build (iOS/Android) |
| `npm run convex:dev` | Convex dev + codegen |
| `npm run build:web` | Production web build |
| `npm run typecheck` | Turborepo typecheck |
| `npm run init` | Interactive new project setup (Convex + Clerk + Vercel) |
| `npm run auth` | Add Google + Apple OAuth |
| `npm run deploy` | Deploy Convex + Vercel only |

## Environment Variables

See `apps/web/.env.example` and `apps/mobile/.env.example`. Both apps must use the **same** Convex deployment URL.

## Deployment

### Web (Vercel)

Import the repo with **Root Directory** at repo root. Set `NEXT_PUBLIC_CONVEX_URL`. Root `vercel.json` builds from `apps/web`.

### Mobile (EAS)

`apps/mobile/eas.json` includes development, preview, and production profiles. Set `EXPO_PUBLIC_CONVEX_URL` via EAS environment variables.

Build a development client before first mobile run:

```bash
cd apps/mobile && npx eas build --profile development --platform ios
```

Or build locally: `npx expo run:ios` / `npx expo run:android`.

### Convex

```bash
npm run convex:deploy
```

## Tech Stack

- [Next.js 15](https://nextjs.org/)
- [Expo 54](https://expo.dev/)
- [Convex](https://convex.dev/)
- [Gluestack UI v5](https://gluestack.io/ui)
- [NativeWind](https://www.nativewind.dev/)
- [Turborepo](https://turbo.build/)
- [TypeScript](https://www.typescriptlang.org/)

## License

MIT — see [LICENSE](LICENSE).
