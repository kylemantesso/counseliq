import { clerkMiddleware } from '@clerk/nextjs/server';
import * as Sentry from '@sentry/nextjs';

export default Sentry.wrapMiddlewareWithSentry(clerkMiddleware());

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
