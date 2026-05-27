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
  title: "Generaciones",
};

const PAGE_SIZE = 50;

const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  done: "default",
  processing: "secondary",
  queued: "outline",
  failed: "destructive",
  canceled: "outline",
};

type GenerationRow = {
  id: string;
  type: string;
  provider: string;
  model_id: string;
  status: string;
  prompt: string | null;
  credits_charged: number | null;
  credits_estimated: number;
  user_id: string;
  created_at: string;
};

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; status?: string }>;
}) {
  const { page: pageRaw, status: filterStatus } = await searchParams;
  const page = Math.max(1, Number(pageRaw ?? "1") || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = createAdminClient();

  let query = supabase
    .from("generations")
    .select(
      "id, type, provider, model_id, status, prompt, credits_charged, credits_estimated, user_id, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  if (
    filterStatus &&
    ["done", "failed", "processing", "queued"].includes(filterStatus)
  ) {
    query = query.eq("status", filterStatus);
  }

  const { data, count } = await query.range(from, to);
  const rows = (data ?? []) as GenerationRow[];

  // Resolve emails
  const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
  const emailById = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);
    for (const p of profiles ?? []) emailById.set(p.id, p.email);
  }

  const total = count ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tabs = [
    { label: "Todas", value: "" },
    { label: "Done", value: "done" },
    { label: "Failed", value: "failed" },
    { label: "Processing", value: "processing" },
  ];
  const activeTab = filterStatus ?? "";

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-heading text-[22px] font-semibold tracking-tight">
            Generaciones
          </h1>
          <p className="text-[13px] text-muted-foreground">
            {new Intl.NumberFormat("es-MX").format(total)} en total
          </p>
        </div>
        <Pagination page={page} lastPage={lastPage} status={activeTab} />
      </header>

      <nav className="flex gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.value}
            href={
              tab.value
                ? `?status=${tab.value}&page=1`
                : "?page=1"
            }
            className={`rounded-md border px-3 py-1 text-sm transition-colors ${
              activeTab === tab.value
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:border-primary/60 hover:text-foreground"
            }`}
          >
            {tab.label}
          </a>
        ))}
      </nav>

      <div className="rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Modelo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Créditos</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Sin generaciones.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[180px] truncate text-xs">
                    {emailById.get(r.user_id) ?? r.user_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-xs capitalize">
                    {r.type}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.model_id}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.status] ?? "outline"}>
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {r.credits_charged ?? r.credits_estimated}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("es-MX", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Pagination page={page} lastPage={lastPage} status={activeTab} />
    </div>
  );
}

function Pagination({
  page,
  lastPage,
  status,
}: {
  page: number;
  lastPage: number;
  status: string;
}) {
  if (lastPage <= 1) return null;
  const qs = status ? `&status=${status}` : "";
  return (
    <nav className="flex items-center gap-1 text-sm">
      <a
        href={`?page=${Math.max(1, page - 1)}${qs}`}
        aria-disabled={page === 1}
        className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Anterior
      </a>
      <span className="px-2 text-muted-foreground">
        {page} / {lastPage}
      </span>
      <a
        href={`?page=${Math.min(lastPage, page + 1)}${qs}`}
        aria-disabled={page === lastPage}
        className="rounded-md border border-border px-3 py-1 text-muted-foreground hover:border-primary/60 hover:text-foreground aria-disabled:pointer-events-none aria-disabled:opacity-50"
      >
        Siguiente
      </a>
    </nav>
  );
}
