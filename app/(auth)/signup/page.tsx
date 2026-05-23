import Link from "next/link";
import type { Metadata } from "next";
import { AuthCard } from "@/components/layout/AuthCard";
import { SignupForm } from "@/components/layout/SignupForm";
import { GoogleButton } from "@/components/layout/GoogleButton";

export const metadata: Metadata = {
  title: "Crear cuenta",
};

export default function SignupPage() {
  return (
    <AuthCard
      title="Empieza a crear"
      description="500 créditos de bienvenida para que pruebes Zyra Studio."
      footer={
        <>
          ¿Ya tienes cuenta?{" "}
          <Link href="/login" className="text-foreground hover:underline">
            Inicia sesión
          </Link>
        </>
      }
    >
      <SignupForm />
      <Divider />
      <GoogleButton label="Registrarse con Google" />
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
