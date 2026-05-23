"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { signInWithGoogleAction } from "@/server-actions/auth";

export function GoogleButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() => start(() => signInWithGoogleAction())}
    >
      <GoogleGlyph />
      {pending ? "Conectando…" : label}
    </Button>
  );
}

function GoogleGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mr-2 size-4"
      fill="currentColor"
    >
      <path d="M21.35 11.1h-9.18v2.92h5.27c-.23 1.4-1.66 4.1-5.27 4.1-3.18 0-5.77-2.63-5.77-5.87s2.59-5.87 5.77-5.87c1.81 0 3.02.77 3.71 1.43l2.53-2.43C16.78 3.93 14.7 3 12.17 3 6.99 3 2.83 7.16 2.83 12.34s4.16 9.34 9.34 9.34c5.39 0 8.96-3.79 8.96-9.12 0-.61-.06-1.08-.13-1.46Z" />
    </svg>
  );
}
