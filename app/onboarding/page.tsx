import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getCurrentUser,
  getCurrentWorkspace,
} from "@/lib/auth/dal";
import { OnboardingFlow } from "@/components/layout/OnboardingFlow";

export const metadata: Metadata = {
  title: "Bienvenida",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const workspace = await getCurrentWorkspace();
  if (workspace) redirect("/app");

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <OnboardingFlow />
      </div>
    </div>
  );
}
