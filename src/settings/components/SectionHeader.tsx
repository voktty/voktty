type Props = {
  title: string;
  description?: string;
};

export function SectionHeader({ title, description }: Props) {
  return (
    <div
      data-setting-title={title}
      className="flex flex-col gap-0.5 pb-0.5 transition-shadow data-[settings-search-highlight=true]:rounded-lg data-[settings-search-highlight=true]:ring-2 data-[settings-search-highlight=true]:ring-primary/30"
    >
      <h1 className="text-[14.5px] font-semibold tracking-tight text-foreground">{title}</h1>
      {description ? (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
