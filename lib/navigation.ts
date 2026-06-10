import {
  Home,
  ImageIcon,
  Video,
  Mic,
  Library,
  FolderKanban,
  Files,
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

// Sidebar /app (todas las rutas; algunas las llenan fases 2-5).
export const APP_SIDEBAR: NavSection[] = [
  {
    items: [{ label: "Inicio", href: "/app", icon: Home }],
  },
  {
    title: "Crear",
    items: [
      { label: "Imagen", href: "/app/create/image", icon: ImageIcon },
      { label: "Video", href: "/app/create/video", icon: Video },
      { label: "Audio", href: "/app/create/audio", icon: Mic },
    ],
  },
  {
    title: "Trabajo",
    items: [
      { label: "Campañas", href: "/app/campaigns", icon: FolderKanban },
      { label: "Library", href: "/app/library", icon: Library },
    ],
  },
  {
    title: "Recursos",
    items: [
      { label: "Referencias", href: "/app/references", icon: Files },
      { label: "Brand Kits", href: "/app/brand-kits", icon: Palette },
      { label: "Cast", href: "/app/cast", icon: Users },
      { label: "Voces", href: "/app/voices", icon: Mic, badge: "Beta" },
      { label: "Presets", href: "/app/presets", icon: Sparkles },
    ],
  },
  {
    title: "Cuenta",
    items: [{ label: "Billing", href: "/app/billing", icon: Wallet }],
  },
];

// Bottom-nav mobile: 5 ítems principales.
export const MOBILE_NAV: NavItem[] = [
  { label: "Inicio", href: "/app", icon: Home },
  { label: "Crear", href: "/app/create/image", icon: ImageIcon },
  { label: "Library", href: "/app/library", icon: Library },
  { label: "Campañas", href: "/app/campaigns", icon: FolderKanban },
  { label: "Billing", href: "/app/billing", icon: Wallet },
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
      { label: "Auditoría", href: "/admin/audit", icon: History },
    ],
  },
];
