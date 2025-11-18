import { ScrapeJob, ScrapedImage } from "@shared/schema";
import { randomUUID } from "crypto";
import { eq, desc } from "drizzle-orm";
import { db, schema, dbType } from "./db/index";

export interface IStorage {
  createScrapeJob(url: string, config: any): Promise<ScrapeJob>;
  getScrapeJob(id: string): Promise<ScrapeJob | undefined>;
  updateScrapeJob(id: string, updates: Partial<ScrapeJob>): Promise<ScrapeJob | undefined>;
  getAllScrapeJobs(): Promise<ScrapeJob[]>;
}

export class PostgresStorage implements IStorage {
  async createScrapeJob(url: string, config: any): Promise<ScrapeJob> {
    const id = randomUUID();
    const now = new Date();
    
    await db.insert(schema.scrapeJobs).values({
      id,
      url,
      status: "pending",
      progress: 0,
      totalImages: 0,
      scrapedImages: 0,
      error: null,
      startedAt: now,
      completedAt: null,
      config,
    });

    return {
      id,
      url,
      status: "pending",
      progress: 0,
      totalImages: 0,
      scrapedImages: 0,
      images: [],
      error: null,
      startedAt: now.toISOString(),
      completedAt: null,
      config,
    };
  }

  async getScrapeJob(id: string): Promise<ScrapeJob | undefined> {
    const [job] = await db
      .select()
      .from(schema.scrapeJobs)
      .where(eq(schema.scrapeJobs.id, id));

    if (!job) return undefined;

    const images = await db
      .select()
      .from(schema.scrapedImages)
      .where(eq(schema.scrapedImages.jobId, id));

    return {
      id: job.id,
      url: job.url,
      status: job.status as any,
      progress: job.progress,
      totalImages: job.totalImages,
      scrapedImages: job.scrapedImages,
      images: images.map((img: any) => ({
        imageId: img.imageId,
        hash: img.hash,
        url: img.url,
        copyLink: img.copyLink,
        smartframeId: img.smartframeId,
        thumbnailUrl: img.thumbnailUrl,
        titleField: img.titleField,
        subjectField: img.subjectField,
        tags: img.tags,
        comments: img.comments,
        authors: img.authors,
        dateTaken: img.dateTaken,
        copyright: img.copyright,
      })),
      error: job.error,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() || null,
      config: job.config as any,
    };
  }

  async updateScrapeJob(id: string, updates: Partial<ScrapeJob>): Promise<ScrapeJob | undefined> {
    const dbUpdates: any = {};
    
    if (updates.status !== undefined) dbUpdates.status = updates.status;
    if (updates.progress !== undefined) dbUpdates.progress = updates.progress;
    if (updates.totalImages !== undefined) dbUpdates.totalImages = updates.totalImages;
    if (updates.scrapedImages !== undefined) dbUpdates.scrapedImages = updates.scrapedImages;
    if (updates.error !== undefined) dbUpdates.error = updates.error;
    if (updates.completedAt !== undefined) {
      dbUpdates.completedAt = updates.completedAt ? new Date(updates.completedAt) : null;
    }

    if (Object.keys(dbUpdates).length > 0) {
      await db
        .update(schema.scrapeJobs)
        .set(dbUpdates)
        .where(eq(schema.scrapeJobs.id, id));
    }

    if (updates.images && updates.images.length > 0) {
      const imagesToInsert = updates.images.map(img => ({
        id: randomUUID(),
        jobId: id,
        imageId: img.imageId,
        hash: img.hash,
        url: img.url,
        copyLink: img.copyLink,
        smartframeId: img.smartframeId,
        thumbnailUrl: img.thumbnailUrl,
        titleField: img.titleField,
        subjectField: img.subjectField,
        tags: img.tags,
        comments: img.comments,
        authors: img.authors,
        dateTaken: img.dateTaken,
        copyright: img.copyright,
      }));

      await db.insert(schema.scrapedImages)
        .values(imagesToInsert)
        .onConflictDoNothing({ target: [schema.scrapedImages.jobId, schema.scrapedImages.imageId] });
      
      console.log(`✓ Inserted up to ${updates.images.length} images (duplicates automatically skipped by database)`);
    }

    return this.getScrapeJob(id);
  }

  async getAllScrapeJobs(): Promise<ScrapeJob[]> {
    const jobs = await db
      .select()
      .from(schema.scrapeJobs)
      .orderBy(desc(schema.scrapeJobs.startedAt));

    const jobsWithImages = await Promise.all(
      jobs.map(async (job: any) => {
        const images = await db
          .select()
          .from(schema.scrapedImages)
          .where(eq(schema.scrapedImages.jobId, job.id));

        return {
          id: job.id,
          url: job.url,
          status: job.status as any,
          progress: job.progress,
          totalImages: job.totalImages,
          scrapedImages: job.scrapedImages,
          images: images.map((img: any) => ({
            imageId: img.imageId,
            hash: img.hash,
            url: img.url,
            copyLink: img.copyLink,
            smartframeId: img.smartframeId,
            thumbnailUrl: img.thumbnailUrl,
            titleField: img.titleField,
            subjectField: img.subjectField,
            tags: img.tags,
            comments: img.comments,
            authors: img.authors,
            dateTaken: img.dateTaken,
            copyright: img.copyright,
          })),
          error: job.error,
          startedAt: job.startedAt.toISOString(),
          completedAt: job.completedAt?.toISOString() || null,
          config: job.config as any,
        };
      })
    );

    return jobsWithImages;
  }
}

export const storage = new PostgresStorage();
