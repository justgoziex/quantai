import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-skeleton-pulse rounded-sm bg-raised", className)}
      {...props}
    />
  );
}

export { Skeleton };
