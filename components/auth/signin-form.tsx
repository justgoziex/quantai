"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLoginWithEmail, useLoginWithOAuth } from "@privy-io/react-auth";
import { useAuth } from "@/components/auth/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/*
  Headless sign-in: email OTP (sign-in and sign-up are the same door) or
  Google. Driven by Privy's own flow state. Important OTP property: every
  sendCode call invalidates prior codes — so sends are guarded, resend has a
  cooldown, and the UI tells the user to use the newest email.
*/
const RESEND_COOLDOWN_S = 30;

export function SignInForm() {
  const router = useRouter();
  const { loginWithWallet, ready, authenticated } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);
  const [stage, setStage] = useState<"email" | "code">("email");
  const sending = useRef(false);
  const navigated = useRef(false);

  // Hard navigation (full reload) after auth. Google OAuth is a redirect flow —
  // a soft router.push can render the destination before Privy's auth state
  // finishes propagating, so the nav still shows "signed out" until a manual
  // reload. A real navigation re-hydrates the whole tree signed-in.
  const go = (path: string) => {
    if (navigated.current) return;
    navigated.current = true;
    if (typeof window !== "undefined") window.location.assign(path);
    else router.push(path);
  };

  // Onboarding is for genuinely new accounts only. Privy tells us whether this
  // is the user's first-ever login; returning users always land on the app.
  const onComplete = (params?: { isNewUser?: boolean }) => {
    if (typeof window !== "undefined") localStorage.setItem("quantai:onboarded", "1");
    go(params?.isNewUser ? "/onboarding" : "/");
  };

  const { sendCode, loginWithCode, state } = useLoginWithEmail({ onComplete });
  const { initOAuth } = useLoginWithOAuth({ onComplete });

  // Fallback for the OAuth redirect-return: if we land back here already
  // authenticated and onComplete didn't drive the redirect, move along.
  useEffect(() => {
    if (ready && authenticated) go("/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]);

  const status = state.status;
  const awaiting = stage === "code";

  // resend cooldown tick
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const doSend = async (isResend: boolean) => {
    if (sending.current || cooldown > 0) return;
    setLocalError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLocalError("Enter a valid email address.");
      return;
    }
    sending.current = true;
    try {
      await sendCode({ email });
      setCode("");
      setCooldown(RESEND_COOLDOWN_S);
      setResent(isResend);
      setStage("code");
    } catch {
      setLocalError("Couldn't send the code. Check the address and try again.");
    } finally {
      sending.current = false;
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (!/^\d{6}$/.test(code)) {
      setLocalError("The code is 6 digits.");
      return;
    }
    try {
      await loginWithCode({ code });
    } catch {
      /* surfaced via state.error below */
    }
  };

  const privyError =
    status === "error" && state.error
      ? humanError(state.error.message ?? String(state.error))
      : null;
  const error = localError ?? privyError;

  return (
    <div className="flex flex-col gap-5">
      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => {
          setLocalError(null);
          initOAuth({ provider: "google" });
        }}
      >
        <GoogleGlyph />
        Continue with Google
      </Button>

      <Button
        variant="secondary"
        size="lg"
        className="w-full"
        onClick={() => {
          setLocalError(null);
          loginWithWallet();
        }}
      >
        <WalletGlyph />
        Continue with a wallet
      </Button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-data-sm text-faint">OR EMAIL</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {!awaiting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            doSend(false);
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-email">Email address</Label>
            <Input
              id="auth-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={status === "sending-code"}
            className="w-full"
          >
            {status === "sending-code" ? "Sending code…" : "Continue with email"}
          </Button>
          <p className="text-xs text-faint">
            New here? Same flow — your account is created on first sign-in.
          </p>
        </form>
      ) : (
        <form onSubmit={submitCode} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-code">6-digit code</Label>
            <Input
              id="auth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="w-40 text-center font-mono text-data-lg tracking-[0.3em]"
              autoFocus
            />
            <p className="text-xs text-muted">
              Sent to <span className="text-bone">{email}</span>
              {resent ? " — use the code from the newest email; older codes stopped working." : ""}
            </p>
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={status === "submitting-code" || code.length !== 6}
            className="w-full"
          >
            {status === "submitting-code" ? "Verifying…" : "Verify and sign in"}
          </Button>
          <div className="flex items-center justify-between">
            <button
              type="button"
              disabled={cooldown > 0 || status === "sending-code"}
              className="rounded text-xs text-muted underline-offset-4 enabled:hover:text-bone enabled:hover:underline disabled:opacity-50"
              onClick={() => doSend(true)}
            >
              {cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code"}
            </button>
            <button
              type="button"
              className="rounded text-xs text-muted underline-offset-4 hover:text-bone hover:underline"
              onClick={() => {
                setCode("");
                setLocalError(null);
                setEmail("");
                setCooldown(0);
                setResent(false);
                setStage("email");
              }}
            >
              Use a different email
            </button>
          </div>
        </form>
      )}

      <p
        role="alert"
        aria-live="polite"
        className={cn("text-sm text-loss", !error && "hidden")}
      >
        {error}
      </p>
    </div>
  );
}

function humanError(raw: string): string {
  if (/invalid.*(code|otp)|code.*invalid|incorrect/i.test(raw))
    return "That code didn't match. If you requested more than one email, only the newest code works — or tap Resend.";
  if (/expired/i.test(raw)) return "That code expired. Tap Resend for a fresh one.";
  if (/too many|rate/i.test(raw)) return "Too many attempts — wait a minute and retry.";
  if (/allowed|origin|domain/i.test(raw))
    return "This origin isn't allowed for the Privy app. Add it in the Privy dashboard.";
  return "Sign-in failed: " + raw;
}

function WalletGlyph() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true" fill="none">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 10h2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2.5 8h15" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.36-.19-2.02H12v3.83h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.89-1.74 2.97-4.3 2.97-7.33Z"
      />
      <path
        fill="currentColor"
        opacity=".7"
        d="M12 21.5c2.7 0 4.96-.9 6.62-2.42l-3.23-2.5c-.9.6-2.05.95-3.39.95-2.6 0-4.8-1.76-5.59-4.12H3.07v2.58A9.99 9.99 0 0 0 12 21.5Z"
      />
      <path
        fill="currentColor"
        opacity=".5"
        d="M6.41 13.41a6 6 0 0 1 0-3.82V7.01H3.07a10 10 0 0 0 0 8.98l3.34-2.58Z"
      />
      <path
        fill="currentColor"
        opacity=".85"
        d="M12 6.48c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.97 9.97 0 0 0 12 2.5a9.99 9.99 0 0 0-8.93 5.51l3.34 2.58C7.2 8.23 9.4 6.48 12 6.48Z"
      />
    </svg>
  );
}
