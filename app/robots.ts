import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

/*
  Crawl rules. Public marketing + token pages are open; user/admin/API
  surfaces are kept out of the index.
*/
export default function robots(): MetadataRoute.Robots {
  const site = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/admin",
          "/account",
          "/portfolio",
          "/onboarding",
          "/signin",
          "/pnl-demo",
          "/style-guide",
        ],
      },
    ],
    sitemap: `${site}/sitemap.xml`,
    host: site,
  };
}
