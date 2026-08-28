import { Nav } from "@/components/marketing/nav";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <Nav />
      <main className="mx-auto max-w-wrap px-6 pb-24">
        <div className="border-b border-line py-8">
          <Skeleton className="mb-3 h-3 w-40" />
          <div className="flex items-start justify-between gap-6">
            <div>
              <Skeleton className="mb-2 h-9 w-72" />
              <Skeleton className="h-3 w-96" />
            </div>
            <Skeleton className="h-10 w-44" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 border-b border-line py-4 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="mb-2 h-3 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 pt-6 lg:grid-cols-[2fr_1fr]">
          <Skeleton className="h-[430px] rounded-md" />
          <div className="flex flex-col gap-4">
            <Skeleton className="h-32 rounded-md" />
            <Skeleton className="h-72 rounded-md" />
          </div>
        </div>
      </main>
    </>
  );
}
