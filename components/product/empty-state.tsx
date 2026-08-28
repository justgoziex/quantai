import { cn } from "@/lib/utils";
import { Mark } from "@/components/brand/logo";

/*
  EmptyState — considered emptiness: hatched panel (the 45° brand gesture),
  a muted mark, and a single clear next action.
*/
export function EmptyState({
  label,
  title,
  description,
  action,
  className,
}: {
  label: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-md border border-line bg-panel px-8 py-14 text-center",
        className,
      )}
    >
      <div className="signal-hatch absolute inset-x-0 top-0 h-1.5" aria-hidden="true" />
      <Mark size={30} className="mb-5 text-faint" tailClassName="text-faint" />
      <span className="text-label mb-2">{label}</span>
      <h3 className="text-h2 mb-1.5 text-bone">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}
