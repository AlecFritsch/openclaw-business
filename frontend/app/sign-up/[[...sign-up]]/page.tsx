'use client';

import { useSignUp } from '@clerk/nextjs';
import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Waitlist } from '@/components/waitlist';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function SignUpPage() {
  const searchParams = useSearchParams();
  const hasTicket = searchParams.has('__clerk_ticket');
  const isWaitlist = process.env.NEXT_PUBLIC_WAITLIST_MODE === 'true' && !hasTicket;

  if (isWaitlist) return <WaitlistView />;
  return <SignUpForm ticket={hasTicket ? searchParams.get('__clerk_ticket') : undefined} />;
}

function WaitlistView() {
  const t = useTranslations('signupWaitlist');
  return (
    <section className="bg-background flex min-h-screen flex-col px-4">
      <div className="mx-auto w-full max-w-7xl border-b py-3">
        <Link href="/" aria-label="go home" className="inline-block border-t-2 border-transparent py-3">
          <Logo className="w-fit" />
        </Link>
      </div>
      <div className="m-auto w-full max-w-md text-center">
        <h1 className="font-serif text-4xl font-medium">{t('title')}</h1>
        <p className="text-muted-foreground mt-3 text-balance text-sm">{t('description')}</p>
        <div className="mt-8 flex justify-center">
          <Waitlist />
        </div>
        <p className="text-muted-foreground mt-8 text-sm">
          {t('alreadyHaveAccount')}{' '}
          <Link href="/sign-in" className="text-primary font-medium hover:underline">{t('signIn')}</Link>
        </p>
      </div>
    </section>
  );
}

function SignUpForm({ ticket }: { ticket?: string | null }) {
  const { isLoaded, signUp, setActive } = useSignUp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectUrl = searchParams.get('redirect_url') || '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [pendingVerification, setPendingVerification] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isLoaded) return (
    <section className="bg-background flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Logo className="w-fit" />
        <div className="w-5 h-5 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
      </div>
    </section>
  );

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (ticket) {
        // Invitation flow: use ticket strategy, email is auto-verified
        const result = await signUp.create({ strategy: 'ticket', ticket, password });
        if (result.status === 'complete') {
          await setActive({ session: result.createdSessionId });
          router.push(redirectUrl);
          return;
        }
      }
      await signUp.create({ emailAddress: email, password });
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setPendingVerification(true);
    } catch (err: any) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({ code });
      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push(redirectUrl);
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (strategy: 'oauth_google') => {
    signUp.authenticateWithRedirect({
      strategy,
      redirectUrl: '/sso-callback',
      redirectUrlComplete: redirectUrl,
    });
  };

  return (
    <section className="bg-background flex min-h-screen grid grid-rows-[auto_1fr] px-4">
      <div className="mx-auto w-full max-w-7xl border-b py-3">
        <Link href="/" aria-label="go home" className="inline-block border-t-2 border-transparent py-3">
          <Logo className="w-fit" />
        </Link>
      </div>
      <div className="m-auto w-full max-w-sm">
        <div className="text-center">
          <h1 className="font-serif text-4xl font-medium">
            {pendingVerification ? 'Check your email' : 'Create an account'}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {pendingVerification ? `We sent a verification code to ${email}` : 'Get started with your free account today'}
          </p>
        </div>
        <Card variant="outline" className="mt-6 p-8">
          {pendingVerification ? (
            <form onSubmit={handleVerify} className="space-y-5">
              <div className="space-y-3">
                <Label htmlFor="code" className="text-sm">Verification code</Label>
                <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Enter 6-digit code" required />
              </div>
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button className="w-full" disabled={loading}>{loading ? 'Verifying...' : 'Verify Email'}</Button>
            </form>
          ) : (
            <>
              <form onSubmit={handleSignUp} className="space-y-5">
                {!ticket && (
                <div className="space-y-3">
                  <Label htmlFor="email" className="text-sm">Email</Label>
                  <Input type="email" id="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
                </div>
                )}
                <div className="space-y-3">
                  <Label htmlFor="password" className="text-sm">Password</Label>
                  <Input type="password" id="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <Button className="w-full" disabled={loading}>{loading ? 'Creating account...' : 'Create Account'}</Button>
              </form>
              <div className="my-6 flex items-center gap-3">
                <hr className="flex-1" />
                <span className="text-muted-foreground text-xs">or continue with</span>
                <hr className="flex-1" />
              </div>
              <div className="grid gap-3">
                <Button type="button" variant="outline" onClick={() => handleOAuth('oauth_google')}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="size-4" viewBox="0 0 256 262">
                    <path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
                    <path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
                    <path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
                    <path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
                  </svg>
                  <span>Google</span>
                </Button>
              </div>
            </>
          )}
        </Card>
        {!pendingVerification && (
          <p className="text-muted-foreground mt-6 text-center text-sm">
            Already have an account?{' '}
            <Link href="/sign-in" className="text-primary font-medium hover:underline">Sign in</Link>
          </p>
        )}
      </div>
    </section>
  );
}
