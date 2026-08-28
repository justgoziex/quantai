import { Nav } from "@/components/marketing/nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <div className="border-b border-line py-12">
          <Skeleton className="mb-4 h-3 w-20" />
          <Skeleton className="mb-4 h-8 w-96" />
          <Skeleton className="h-3 w-80" />
        </div>
        <div className="flex flex-col gap-4 pt-8">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-48 rounded-md" />
        </div>
      </main>
    </>
  );
}
