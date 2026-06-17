"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";
import { markAllNotificationsReadAction } from "@/server-actions/notifications";

type Notification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

type Props = {
  userId: string;
  initial: Notification[];
};

export function NotificationBell({ userId, initial }: Props) {
  const [items, setItems] = useState<Notification[]>(initial);
  const [pending, start] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    // setAuth explícito antes de subscribir — sin esto, RLS evalúa auth.uid()
    // como null y descarta los eventos en silencio. Ver CreditPill.tsx para
    // el detalle del workaround.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) return;

      channel = supabase
        .channel(`notifications:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const n = payload.new as Notification;
            if (!n.id) return;
            setItems((prev) => [n, ...prev].slice(0, 20));
          },
        )
        .subscribe();
    })();

    const { data: authSub } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session?.access_token) {
          supabase.realtime.setAuth(session.access_token);
        }
      },
    );

    return () => {
      cancelled = true;
      authSub.subscription.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, [userId]);

  const unread = items.length;

  function markAll() {
    start(async () => {
      await markAllNotificationsReadAction();
      setItems([]);
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Notificaciones${unread ? `: ${unread} sin leer` : ""}`}
          className="relative"
        >
          <Bell className="size-4" />
          {unread > 0 ? (
            <span className="absolute right-1.5 top-1.5 inline-flex h-2 w-2 rounded-full bg-primary" />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Notificaciones</span>
          {unread > 0 ? (
            <button
              type="button"
              disabled={pending}
              onClick={markAll}
              className="text-xs font-normal text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Marcar como leídas
            </button>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            <CheckCircle2 className="mx-auto mb-2 size-5" aria-hidden />
            Estás al día
          </div>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="text-sm font-medium">
                {notificationLabel(n)}
              </span>
              <span className="text-xs text-muted-foreground">
                {new Date(n.created_at).toLocaleString("es-MX", {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function notificationLabel(n: Notification): string {
  switch (n.type) {
    case "purchase_approved": {
      const credits = numFromPayload(n.payload, "credits");
      return credits !== null
        ? `Compra aprobada: +${fmt(credits)} créditos`
        : "Tu compra fue aprobada";
    }
    case "purchase_rejected":
      return "Tu compra fue rechazada";
    case "generation_done": {
      const t = strFromPayload(n.payload, "type");
      if (t === "video") return "Tu video está listo";
      if (t === "audio") return "Tu audio está listo";
      if (t === "image") return "Tu imagen está lista";
      return "Tu generación está lista";
    }
    case "credit_grant": {
      const delta = numFromPayload(n.payload, "delta");
      if (delta === null) return "Se ajustaron tus créditos";
      if (delta >= 0) return `Recibiste ${fmt(delta)} créditos`;
      return `Se debitaron ${fmt(Math.abs(delta))} créditos`;
    }
    default:
      return n.type;
  }
}

function numFromPayload(
  payload: Record<string, unknown>,
  key: string,
): number | null {
  const v = payload[key];
  return typeof v === "number" ? v : null;
}

function strFromPayload(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const v = payload[key];
  return typeof v === "string" ? v : null;
}

function fmt(n: number): string {
  return new Intl.NumberFormat("es-MX").format(n);
}
