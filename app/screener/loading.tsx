import { Nav } from "@/components/marketing/nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <div className="border-b border-line py-10">
          <Skeleton className="mb-3 h-3 w-20" />
          <Skeleton className="h-8 w-96" />
        </div>
        <div className="flex flex-col gap-4 pt-8">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-9 w-full max-w-2xl" />
          <div className="overflow-hidden rounded-md border border-line bg-panel">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-0">
                <Skeleton className="h-4 w-4 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="mb-1.5 h-3.5 w-28" />
                  <Skeleton className="h-2.5 w-40" />
                </div>
                <Skeleton className="hidden h-3 w-14 sm:block" />
                <Skeleton className="hidden h-4 w-24 lg:block" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
