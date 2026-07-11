# packages/admin

Screens, auth, and db client. See [root AGENTS.md](../../AGENTS.md).

- Compose `@counseliq/ui` for all UI (Gluestack v5 semantic tokens)
- Use Solito for navigation in screens
- Export new screens from `index.ts`

## Styling (v5)

Use semantic Tailwind classes from the design system:

- `bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`
- `border-border`, `text-primary`, `text-destructive`, `bg-destructive`

Do **not** use v3 classes (`text-typography-*`, `bg-background-*`, `border-outline-*`) or v3 Button props (`action="primary"`).
