import { Separator } from "@/components/ui/separator";
import { CreditPill } from "@/components/layout/CreditPill";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { UserMenu } from "@/components/layout/UserMenu";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser, CurrentWorkspace } from "@/lib/auth/dal";

type Props = {
  user: CurrentUser;
  workspace: CurrentWorkspace;
};

export async function Topbar({ user, workspace }: Props) {
  const supabase = await createClient();
  const [{ data: balance }, { data: notifications }] = await Promise.all([
    supabase
      .from("credit_balances")
      .select("balance")
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("notifications")
      .select("id, type, payload, created_at")
      .eq("user_id", user.id)
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <p className="truncate text-[13.5px] font-medium">{workspace.name}</p>
        <span className="hidden text-2xs text-muted-foreground sm:inline">
          · {roleLabel(workspace.role)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <CreditPill userId={user.id} initialBalance={balance?.balance ?? 0} />
        <Separator orientation="vertical" className="hidden h-6 sm:block" />
        <NotificationBell userId={user.id} initial={notifications ?? []} />
        <UserMenu
          email={user.email}
          fullName={user.fullName}
          avatarUrl={user.avatarUrl}
          isAdmin={user.role === "admin"}
        />
      </div>
    </header>
  );
}

function roleLabel(role: CurrentWorkspace["role"]): string {
  switch (role) {
    case "owner":
      return "Owner";
    case "editor":
      return "Editor";
    case "viewer":
      return "Viewer";
  }
}
