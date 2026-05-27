import type { Metadata } from "next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata: Metadata = {
  title: "Auditoría",
};

const PAGE_SIZE = 100;

type AuditRow = {
  id: string;
  admin_id: string | null;
  action: string;
  target_user_id: string | null;
  target_resource_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createAdminClient();
  const { data, count } = await supabase
    .from("admin_audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  const rows = (data ?? []) as AuditRow[];
  const adminIds = Array.from(
    new Set(rows.map((r) => r.admin_id).filter((x): x is string => !!x)),
  );
  const targetIds = Array.from(
    new Set(rows.map((r) => r.target_user_id).filter((x): x is string => !!x)),
  );
  const allIds = Array.from(new Set([...adminIds, ...targetIds]));

  const emailById = new Map<string, string>();
  if (allIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", allIds);
    for (const p of profiles ?? []) emailById.set(p.id, p.email);
  }

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[22px] font-semibold tracking-tight">
            Auditoría
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {new Intl.NumberFormat("es-MX").format(total)} entradas
          </p>
        </div>
      </header>

      <div className="scroll-thin overflow-x-auto rounded-md border border-border">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Payload</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Sin entradas todavía.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("es-MX", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.admin_id
                      ? (emailById.get(r.admin_id) ?? r.admin_id.slice(0, 8))
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.action}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.target_user_id
                      ? (emailById.get(r.target_user_id) ??
                        r.target_user_id.slice(0, 8))
                      : r.target_resource_id
                        ? r.target_resource_id.slice(0, 8)
                        : "—"}
                  </TableCell>
                  <TableCell>
                    <code className="block max-w-md truncate rounded bg-muted px-2 py-1 text-xs">
                      {JSON.stringify(r.payload)}
                    </code>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {lastPage > 1 ? (
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
      ) : null}
    </div>
  );
}
