import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";
import { prisma, dbConfigured } from "@/lib/db";

export const revalidate = 3600; // rebuild the sitemap hourly

/*
  Sitemap = static marketing pages + every listed token page. The token URLs
  are the long-tail SEO surface (people search token names), so we enumerate
  them from the DB, capped and ordered by liquidity so the strongest pages
  lead. Google caps a single sitemap at 50k URLs.
*/
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = getSiteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${site}/`, changeFrequency: "daily", priority: 1 },
    { url: `${site}/screener`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${site}/scoring`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${site}/faq`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site}/about`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${site}/signals`, changeFrequency: "hourly", priority: 0.7 },
    { url: `${site}/launch`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${site}/rewards`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${site}/alerts`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${site}/status`, changeFrequency: "weekly", priority: 0.3 },
    { url: `${site}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/disclaimer`, changeFrequency: "yearly", priority: 0.2 },
  ];

  if (!dbConfigured) return staticPages;

  try {
    const tokens = await prisma.token.findMany({
      where: { blacklisted: false, liquidityUsd: { gt: 0 } },
      orderBy: { liquidityUsd: "desc" },
      take: 20000,
      select: { chain: true, address: true, updatedAt: true },
    });
    const tokenPages: MetadataRoute.Sitemap = tokens.map((t) => ({
      url: `${site}/token/${t.chain.toLowerCase()}/${t.address}`,
      lastModified: t.updatedAt,
      changeFrequency: "hourly",
      priority: 0.5,
    }));
    return [...staticPages, ...tokenPages];
  } catch {
    return staticPages;
  }
}
