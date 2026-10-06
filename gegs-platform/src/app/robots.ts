import type { MetadataRoute } from 'next';

/**
 * Phase 1 §1.2 rule 2: the operational application is invisible to crawlers.
 * The existing WordPress site remains solely responsible for public URLs and
 * SEO, and nothing here can compete with or dilute it.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
