import type { Metadata } from "next";
import { UsersTable, type UserRow } from "@/components/admin/UsersTable";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Usuarios",
};

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createAdminClient();
  const { data: profiles, count } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const ids = (profiles ?? []).map((p) => p.id);
  const balances = ids.length
    ? (
        await supabase
          .from("credit_balances")
          .select("user_id, balance")
          .in("user_id", ids)
      ).data ?? []
    : [];
  const balanceById = new Map<string, number>(
    balances.map((b) => [b.user_id, Number(b.balance)]),
  );

  const rows: UserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    full_name: p.full_name,
    role: p.role,
    status: p.status,
    balance: balanceById.get(p.id) ?? 0,
    created_at: p.created_at,
  }));

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-3xl font-semibold tracking-tight">
            Usuarios
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Intl.NumberFormat("es-MX").format(total)} en total
          </p>
        </div>
        <Pagination page={page} lastPage={lastPage} />
      </header>
      <UsersTable rows={rows} />
      <Pagination page={page} lastPage={lastPage} />
    </div>
  );
}

function Pagination({ page, lastPage }: { page: number; lastPage: number }) {
  if (lastPage <= 1) return null;
  return (
    <nav className="flex items-center gap-1 text-sm">
      <a
        href={`?page=${Math.max(1, page - 1)}`}
        aria-disabled={page === 1}
        className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Anterior
      </a>
      <span className="px-2 text-muted-foreground">
        {page} / {lastPage}
      </span>
      <a
        href={`?page=${Math.min(lastPage, page + 1)}`}
        aria-disabled={page === lastPage}
        className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Siguiente
      </a>
    </nav>
  );
}
