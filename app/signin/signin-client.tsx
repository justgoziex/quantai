"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mark } from "@/components/brand/logo";
import { useAuth } from "@/components/auth/auth-context";
import { SignInForm } from "@/components/auth/signin-form";

export function SignInClient() {
  const { configured, ready, authenticated } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && authenticated) router.replace("/");
  }, [ready, authenticated, router]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-10 inline-flex rounded" aria-label="Back to Quant AI home">
          <Mark size={36} className="text-bone" />
        </Link>
        <h1 className="text-h1 mb-8 text-bone">Sign in to Quant AI</h1>

        {configured ? (
          <SignInForm />
        ) : (
          <div className="rounded-md border border-line bg-panel p-5">
            <p className="text-label mb-3">Setup required</p>
            <p className="mb-3 text-sm text-muted">
              Authentication isn&rsquo;t configured in this environment yet. Add
              your Privy app ID to enable email and Google sign-in with embedded
              wallets:
            </p>
            <pre className="mb-3 overflow-x-auto rounded border border-line bg-ink px-3 py-2 font-mono text-data-sm text-bone">
              NEXT_PUBLIC_PRIVY_APP_ID=…{"\n"}# .env.local — see .env.example
            </pre>
            <p className="text-xs text-faint">
              Create a free app at dashboard.privy.io → enable Email and Google
              login methods → paste the App ID and rebuild.
            </p>
          </div>
        )}

        <p className="mt-8 text-xs text-faint">
          By continuing you agree to the{" "}
          <Link href="/terms" className="rounded underline-offset-4 hover:text-muted hover:underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="rounded underline-offset-4 hover:text-muted hover:underline">
            Privacy Policy
          </Link>
          . Analytics, not financial advice.
        </p>
      </div>
    </main>
  );
}
