import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <Link
        href="/"
        className="mb-10 text-sm font-medium uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-foreground"
      >
        Zyra Studio
      </Link>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
