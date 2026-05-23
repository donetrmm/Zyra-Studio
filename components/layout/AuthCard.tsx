import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AuthCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
};

export function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <Card className="border-border/60 bg-card/60 shadow-xl shadow-black/30 backdrop-blur">
      <CardHeader className="space-y-2">
        <CardTitle className="font-heading text-2xl tracking-tight">
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
      {footer ? (
        <div className="border-t border-border/60 px-6 py-4 text-center text-sm text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </Card>
  );
}
