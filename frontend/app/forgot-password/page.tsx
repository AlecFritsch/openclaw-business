'use client';

import { useSignIn } from '@clerk/nextjs';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pendingReset, setPendingReset] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isLoaded) return null;

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email,
      });
      setPendingReset(true);
    } catch (err: any) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code,
        password,
      });

      if (result.status === 'complete') {
        await setActive({ session: result.createdSessionId });
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.errors?.[0]?.longMessage || err.errors?.[0]?.message || 'Reset failed');
    } finally {
      setLoading(false);
    }
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
            {pendingReset ? 'Reset your password' : 'Forgot password?'}
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {pendingReset
              ? `Enter the code we sent to ${email} and your new password`
              : "Enter your email and we'll send you a reset code"}
          </p>
        </div>
        <Card variant="outline" className="mt-6 p-8">
          {pendingReset ? (
            <form onSubmit={handleReset} className="space-y-5">
              <div className="space-y-3">
                <Label htmlFor="code" className="text-sm">Reset code</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Enter code"
                  required
                />
              </div>
              <div className="space-y-3">
                <Label htmlFor="password" className="text-sm">New password</Label>
                <Input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <Button className="w-full" disabled={loading}>
                {loading ? 'Resetting...' : 'Reset Password'}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleSendCode} className="space-y-5">
              <div className="space-y-3">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <Button className="w-full" disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Code'}
              </Button>
            </form>
          )}
        </Card>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Remember your password?{' '}
          <Link href="/sign-in" className="text-primary font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
