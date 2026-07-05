import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Generates /robots.txt — allow crawling the page, keep the API endpoints out. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
