"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-context";
import { EmptyState } from "@/components/product/empty-state";
import { Button } from "@/components/ui/button";

/*
  Gates a page section behind sign-in. Signed out → one clear prompt;
  loading → skeleton; signed in → the real content.
*/
export function RequireAuth({
  label,
  title,
  description,
  children,
}: {
  label: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const { ready, authenticated } = useAuth();

  if (!ready) {
    return <div className="h-64 animate-skeleton-pulse rounded-md bg-raised" aria-hidden="true" />;
  }

  if (!authenticated) {
    return (
      <EmptyState
        label={label}
        title={title}
        description={description}
        action={
          <Button asChild>
            <Link href="/signin">Sign in</Link>
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
}
