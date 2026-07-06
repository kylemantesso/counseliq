import { ConvexReactClient } from 'convex/react';

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL || 'https://your-convex-app.convex.cloud'
);

export { convex };
