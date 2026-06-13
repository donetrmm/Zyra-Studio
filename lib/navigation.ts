import {
  Banknote,
  Clapperboard,
  Home,
  Library,
  FolderKanban,
  Users,
  Palette,
  Sparkles,
  Layers,
  Wallet,
  ShieldCheck,
  Receipt,
  Tag,
  History,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  iconName?: string;
  badge?: string;
};

export type NavSection = {
  title?: string;
  items: NavItem[];
};

// Sidebar /app. El orden comunica jerarquía: el Campaign Studio es el camino
// principal; la creación suelta es herramienta secundaria (specs/v2/06-rediseno-ux.md).
export const APP_SIDEBAR: NavSection[] = [
  {
    items: [
      { label: "Inicio", href: "/app", icon: Home },
      { label: "Campañas", href: "/app/campaigns", icon: FolderKanban },
      { label: "Crear", href: "/app/create", icon: Sparkles },
      { label: "Biblioteca", href: "/app/library", icon: Library },
    ],
  },
  {
    title: "Activos",
    items: [
      { label: "Marca", href: "/app/brand", icon: Palette },
      { label: "Formatos", href: "/app/formats", icon: Clapperboard },
    ],
  },
  {
    title: "Cuenta",
    items: [{ label: "Créditos", href: "/app/billing", icon: Wallet }],
  },
];

// Sidebar /admin.
export const ADMIN_SIDEBAR: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/admin", icon: ShieldCheck },
      { label: "Usuarios", href: "/admin/users", icon: Users },
      { label: "Generaciones", href: "/admin/generations", icon: Layers },
      { label: "Compras", href: "/admin/purchases", icon: Receipt },
      { label: "Precios", href: "/admin/pricing", icon: Tag },
      { label: "Rate card", href: "/admin/rate-card", icon: Banknote },
      { label: "Auditoría", href: "/admin/audit", icon: History },
    ],
  },
];
