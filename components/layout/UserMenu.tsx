"use client";

import { BookOpen, LogOut, Settings, Shield, Sparkles } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/server-actions/auth";
import { resetWelcome } from "@/components/onboarding/WelcomeModal";

type Props = {
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  isAdmin: boolean;
};

export function UserMenu({ email, fullName, avatarUrl, isAdmin }: Props) {
  const initials = (fullName ?? email).slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label="Menú de usuario"
        >
          <Avatar className="size-8">
            {avatarUrl ? (
              <AvatarImage src={avatarUrl} alt={fullName ?? email} />
            ) : null}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="space-y-0.5">
          <p className="text-sm font-medium">{fullName ?? "Usuario"}</p>
          <p className="text-xs font-normal text-muted-foreground">{email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isAdmin ? (
          <DropdownMenuItem asChild>
            <a href="/admin">
              <Shield className="size-4" /> Panel admin
            </a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href="/app/billing">
            <Settings className="size-4" /> Cuenta y billing
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/app/guide">
            <BookOpen className="size-4" /> Guía
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            resetWelcome();
            if (window.location.pathname !== "/app") window.location.href = "/app";
          }}
        >
          <Sparkles className="size-4" /> Ver bienvenida
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex w-full items-center gap-2 px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 focus:outline-none"
          >
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
