import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { Toaster } from "@/components/ui/sonner";
import { requireWorkspace } from "@/lib/auth/dal";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, workspace } = await requireWorkspace();

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} workspace={workspace} />
        <main className="flex-1 px-4 py-6 pb-20 lg:px-8 lg:py-8 lg:pb-8">{children}</main>
        <MobileBottomNav />
      </div>
      <Toaster richColors theme="dark" />
    </div>
  );
}
