import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/blog(.*)',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/sso-callback',
  '/forgot-password',
  // All /api/* routes are rewrites to the Fastify backend which has its own
  // auth middleware (Clerk JWT + API Key). Clerk middleware here only protects
  // Next.js pages, not API routes — otherwise API key auth from external
  // clients (Chrome Extension, curl, etc.) gets blocked.
  '/api/(.*)',
]);

const isOnboardingRoute = createRouteMatcher(['/onboarding']);

export default clerkMiddleware(async (auth, request) => {
  const { userId, orgId } = await auth();
  const pathname = request.nextUrl.pathname;

  // ── Standard Auth & Route Protection ───────────────────────────
  // Protect non-public routes
  if (!isPublicRoute(request)) {
    await auth.protect();
  }

  // If user is signed in
  if (userId) {
    // If no organization and NOT on onboarding page -> redirect to onboarding
    if (!orgId && !isOnboardingRoute(request) && !isPublicRoute(request)) {
      return NextResponse.redirect(new URL('/onboarding', request.url));
    }
    
    // If user already has an org and visits onboarding -> redirect to waiting (payment)
    if (orgId && isOnboardingRoute(request)) {
      return NextResponse.redirect(new URL('/waiting', request.url));
    }

    // If on root path with organization -> redirect to dashboard
    if (orgId && pathname === '/') {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
