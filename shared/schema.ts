import { z } from "zod";

export const scrapeConfigSchema = z.object({
  url: z.string().url("Please enter a valid URL"),
  maxImages: z.number().min(0).max(5000).default(0),
  extractDetails: z.boolean().default(true),
  sortBy: z.enum(["relevance", "newest", "oldest"]).default("relevance"),
  autoScroll: z.boolean().default(true),
  scrollDelay: z.number().min(500).max(5000).default(1000),
  concurrency: z.number().min(1).max(10).default(5),
});

export type ScrapeConfig = z.infer<typeof scrapeConfigSchema>;

export const scrapedImageSchema = z.object({
  imageId: z.string(),
  hash: z.string(),
  url: z.string().url(),
  copyLink: z.string().url(),
  smartframeId: z.string(),
  thumbnailUrl: z.string().url().nullable(),
  
  // The 7 clean metadata fields for CSV export
  titleField: z.string().nullable(),
  subjectField: z.string().nullable(),
  tags: z.string().nullable(),
  comments: z.string().nullable(),
  authors: z.string().nullable(),
  dateTaken: z.string().nullable(),
  copyright: z.string().nullable(),
});

export type ScrapedImage = z.infer<typeof scrapedImageSchema>;

export const scrapeJobSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  status: z.enum(["pending", "scraping", "completed", "error"]),
  progress: z.number().min(0).max(100),
  totalImages: z.number(),
  scrapedImages: z.number(),
  images: z.array(scrapedImageSchema),
  error: z.string().nullable(),
  startedAt: z.string(),
  completedAt: z.string().nullable(),
  config: scrapeConfigSchema,
});

export type ScrapeJob = z.infer<typeof scrapeJobSchema>;

export const exportFormatSchema = z.enum(["json", "csv"]);
export type ExportFormat = z.infer<typeof exportFormatSchema>;
