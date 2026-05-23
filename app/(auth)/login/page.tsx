import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/layout/AuthCard";
import { LoginForm } from "@/components/layout/LoginForm";
import { GoogleButton } from "@/components/layout/GoogleButton";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage() {
  return (
    <AuthCard
      title="Bienvenido de vuelta"
      description="Inicia sesión para volver a tu studio."
      footer={
        <>
          ¿No tienes cuenta?{" "}
          <Link href="/signup" className="text-foreground hover:underline">
            Crear una
          </Link>
        </>
      }
    >
      <LoginForm />
      <Divider />
      <GoogleButton label="Continuar con Google" />
    </AuthCard>
  );
}

function Divider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs uppercase tracking-wider">
        <span className="bg-card px-3 text-muted-foreground">o</span>
      </div>
    </div>
  );
}
