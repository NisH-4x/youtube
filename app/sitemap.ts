import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Generates /sitemap.xml. Single-page app, so just the home route. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
