import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { UserMenu } from "@/components/layout/UserMenu";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { requireAdmin } from "@/lib/auth/dal";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Double-check role en server: el proxy ya redirige sin sesión, pero el
  // check de role es server-side aquí (per Next 16 auth best practices).
  const user = await requireAdmin();

  return (
    <ConfirmProvider>
      <div className="flex h-dvh overflow-hidden">
        <AdminSidebar />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-border bg-background/85 px-4 backdrop-blur lg:px-6">
            <p className="text-[13.5px] font-medium text-muted-foreground">
              Panel administrativo
            </p>
            <UserMenu
              email={user.email}
              fullName={user.fullName}
              avatarUrl={user.avatarUrl}
              isAdmin
            />
          </header>
          <main className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-8">{children}</main>
          <Toaster richColors theme="dark" />
        </div>
      </div>
    </ConfirmProvider>
  );
}
