interface Props {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function EmptyPanel({ icon, title, description }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <div className="text-muted-foreground">{icon}</div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="mt-0.5 max-w-sm text-xs text-muted-foreground">{description}</div>
    </div>
  );
}
