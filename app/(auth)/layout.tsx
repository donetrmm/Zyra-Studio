import Link from "next/link";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center px-4 py-16"
      style={{
        background:
          "radial-gradient(60% 50% at 50% 30%, rgba(0,159,255,0.05) 0%, transparent 70%)",
      }}
    >
      <Link href="/" className="mb-8 block text-center" aria-label="Inicio">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="1to1 Studio"
          className="mx-auto block h-9 w-auto"
        />
      </Link>
      <div className="w-full max-w-sm">{children}</div>
      <p className="mt-5 text-center text-xs text-muted-foreground">
        500 créditos gratis. Sin tarjeta.
      </p>
    </div>
  );
}
