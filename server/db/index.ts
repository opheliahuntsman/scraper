import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { neon } from "@neondatabase/serverless";
import Database from "better-sqlite3";
import * as pgSchema from "./schema";
import * as sqliteSchema from "./sqlite-schema";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === "production";
const isReplit = process.env.REPL_ID !== undefined;
const databaseUrl = process.env.DATABASE_URL;

// Use PostgreSQL in Replit or production, SQLite for local development
const usePostgres = databaseUrl && (isProduction || isReplit);

let db: any;
let schema: any;

if (usePostgres) {
  console.log("📊 Using PostgreSQL database");
  const sql = neon(databaseUrl!);
  db = drizzleNeon(sql, { schema: pgSchema });
  schema = pgSchema;
} else {
  console.log("📊 Using SQLite database (local development)");
  
  // Create data directory if it doesn't exist
  const dbPath = process.env.SQLITE_DB_PATH || "./data/local.db";
  const dbDir = dirname(dbPath);
  
  try {
    await mkdir(dbDir, { recursive: true });
  } catch (error) {
    // Directory might already exist, that's fine
  }
  
  const sqlite = new Database(dbPath);
  db = drizzleSqlite(sqlite, { schema: sqliteSchema });
  schema = sqliteSchema;
  
  // Auto-create tables for SQLite
  console.log("🔨 Initializing SQLite database tables...");
  
  // Create tables if they don't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS scrape_jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      progress INTEGER NOT NULL DEFAULT 0,
      total_images INTEGER NOT NULL DEFAULT 0,
      scraped_images INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      config TEXT NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS scrape_jobs_status_idx ON scrape_jobs(status);
    CREATE INDEX IF NOT EXISTS scrape_jobs_started_at_idx ON scrape_jobs(started_at);
    
    CREATE TABLE IF NOT EXISTS scraped_images (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      image_id TEXT NOT NULL,
      hash TEXT NOT NULL,
      url TEXT NOT NULL,
      copy_link TEXT NOT NULL,
      smartframe_id TEXT NOT NULL,
      thumbnail_url TEXT,
      title_field TEXT,
      subject_field TEXT,
      tags TEXT,
      comments TEXT,
      authors TEXT,
      date_taken TEXT,
      copyright TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (job_id) REFERENCES scrape_jobs(id) ON DELETE CASCADE,
      UNIQUE(job_id, image_id)
    );
    
    CREATE INDEX IF NOT EXISTS scraped_images_job_id_idx ON scraped_images(job_id);
    CREATE INDEX IF NOT EXISTS scraped_images_image_id_idx ON scraped_images(image_id);
    CREATE INDEX IF NOT EXISTS scraped_images_image_id_job_id_idx ON scraped_images(image_id, job_id);
  `);
  
  // Migration: Update schema if needed (for existing databases with old schema)
  try {
    const checkQuery = sqlite.prepare(`
      SELECT sql FROM sqlite_master 
      WHERE type='table' AND name='scraped_images'
    `);
    const tableInfo = checkQuery.get() as { sql: string } | undefined;
    
    // If table exists with old schema (has 'photographer' or 'caption' columns), migrate it
    if (tableInfo && (tableInfo.sql.includes('photographer') || tableInfo.sql.includes('caption'))) {
      console.log("🔄 Migrating existing database to new clean metadata schema...");
      
      // Drop old table and recreate with new schema
      sqlite.exec(`
        DROP TABLE IF EXISTS scraped_images;
        
        CREATE TABLE scraped_images (
          id TEXT PRIMARY KEY,
          job_id TEXT NOT NULL,
          image_id TEXT NOT NULL,
          hash TEXT NOT NULL,
          url TEXT NOT NULL,
          copy_link TEXT NOT NULL,
          smartframe_id TEXT NOT NULL,
          thumbnail_url TEXT,
          title_field TEXT,
          subject_field TEXT,
          tags TEXT,
          comments TEXT,
          authors TEXT,
          date_taken TEXT,
          copyright TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (job_id) REFERENCES scrape_jobs(id) ON DELETE CASCADE,
          UNIQUE(job_id, image_id)
        );
        
        CREATE INDEX scraped_images_job_id_idx ON scraped_images(job_id);
        CREATE INDEX scraped_images_image_id_idx ON scraped_images(image_id);
        CREATE INDEX scraped_images_image_id_job_id_idx ON scraped_images(image_id, job_id);
      `);
      
      console.log("✅ Migration complete - updated to clean metadata schema");
    }
  } catch (error) {
    console.error("Migration warning:", error);
    // Continue anyway - table might be new
  }
  
  console.log("✅ SQLite database ready");
}

export { db, schema };
export const dbType = usePostgres ? "postgres" : "sqlite";
