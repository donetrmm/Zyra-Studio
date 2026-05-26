export default function CreateImageLoading() {
  return (
    <div className="flex h-[calc(100dvh-4rem)] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-[13px] text-muted-foreground">Cargando generador...</p>
      </div>
    </div>
  );
}
