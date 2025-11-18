# SmartFrame Scraper

## Overview

Professional image metadata extraction tool for SmartFrame search pages. This full-stack TypeScript application scrapes image data from smartframe.com search results and extracts detailed metadata including EXIF data, captions, photographer information, location data, and more.

## Project Structure

```
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # UI components
│   │   ├── pages/       # Page components
│   │   ├── hooks/       # Custom React hooks
│   │   └── lib/         # Utilities
│   └── index.html
├── server/              # Express.js backend
│   ├── db/             # Database schema
│   ├── utils/          # Utility functions
│   ├── index.ts        # Main server entry
│   ├── routes.ts       # API routes
│   ├── scraper.ts      # Puppeteer scraping logic
│   └── storage.ts      # Database operations
├── shared/             # Shared types and schemas
└── migrations/         # Database migrations
```

## Technology Stack

- **Frontend**: React, Vite, TypeScript, TailwindCSS, Radix UI, shadcn/ui
- **Backend**: Express.js, TypeScript, Puppeteer
- **Database**: PostgreSQL (Neon) with Drizzle ORM
- **Build**: Vite for frontend, esbuild for backend

## Key Features

- Web scraping of SmartFrame image galleries with Puppeteer
- **Bulk URL submission** - Submit multiple search URLs at once (up to 20 URLs per batch)
- Multi-threaded parallel processing (up to 10x faster)
- Automatic infinite scroll handling
- EXIF metadata extraction (photographer, date, location)
- Automatic caption generation
- Export to JSON or CSV format with ImageID, Page URL, and Copy Link columns
- **Robust retry logic** - 3 automatic retries with exponential backoff for failed images
- **Failed scrapes logging** - Automatic text file logging of images that fail after all retries
- Rate limiting to prevent abuse
- Job-based scraping with real-time progress tracking
- Persistent PostgreSQL storage

## Development Setup

The project is configured to run in the Replit environment with:

1. **Unified Server**: Single Express server serves both API and frontend (port 5000)
2. **Database**: PostgreSQL database (DATABASE_URL) already provisioned
3. **Workflow**: `npm run dev` - starts the development server with hot reloading

### Important Configuration

- Vite is configured to allow all hosts (required for Replit proxy)
- Server binds to 0.0.0.0:5000 for external access
- HMR configured with clientPort 443 for Replit environment
- Database schema is managed with Drizzle ORM

## Database

The application uses two main tables:

1. **scrape_jobs**: Tracks scraping job status, progress, and configuration
2. **scraped_images**: Stores extracted image metadata with foreign key to jobs

Schema is located in `server/db/schema.ts` and managed via Drizzle Kit:
- Push schema changes: `npm run db:push`

## API Endpoints

- `POST /api/scrape/bulk` - Start multiple scraping jobs (up to 20 URLs)
- `POST /api/scrape/start` - Start a single scraping job
- `GET /api/scrape/job/:jobId` - Get job status and results
- `GET /api/scrape/jobs` - Get all scraping jobs
- `GET /api/export/:jobId?format=json|csv` - Export job results

### CSV Export Columns

The CSV export includes 10 columns:
1. **ImageID** - Unique SmartFrame image identifier
2. **Page URL** - Full URL to the image detail page
3. **Copy Link** - SmartFrame copy link for sharing
4. **Title Field** - Image title metadata
5. **Subject Field** - Subject/description metadata
6. **Tags** - Image tags
7. **Comments** - Additional comments
8. **Authors** - Photographer/author information
9. **Date Taken** - Date the photo was taken
10. **Copyright** - Copyright information

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required, auto-configured in Replit)
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)

## Deployment

Configured as VM deployment (to support long-running Puppeteer browser instances):
- Build: `npm run build` - Builds both frontend and backend
- Start: `npm run start` - Runs production server

## Database Support

The application now supports **dual database modes**:

### PostgreSQL (Production/Replit)
- Used automatically when `DATABASE_URL` environment variable is set
- Used in Replit environment (auto-detected via `REPL_ID`)
- Required for production deployments
- Managed via Drizzle ORM with schema in `server/db/schema.ts`

### SQLite (Local Development)
- Used automatically for local development when no `DATABASE_URL` is set
- Zero configuration required - just run the app!
- Data stored in `./data/local.db`
- Schema in `server/db/sqlite-schema.ts`
- Auto-creates tables on first run

The database type is automatically detected at runtime based on environment.

## Local Development (Windows One-Click Setup)

For Windows users, the application features **one-click launch**:

1. Double-click `launch.bat`
2. The launcher automatically:
   - Installs npm dependencies (first time only)
   - Creates `.env` configuration file with SQLite setup
   - Initializes SQLite database with required tables
   - Starts the development server
3. Open http://localhost:5000 in your browser

**No manual database setup required!** The SQLite database is created automatically.

## Recent Changes

- 2025-11-18: Enhanced Metadata Extraction & Attribution ✅
  - **Full Credit Preservation**: Authors and Copyright fields now include complete agency attribution (e.g., "Ricky Swift/WENN.com")
  - **Improved Subject Field**: Now uses Title field when extracted subject is shorter or a substring of the title
  - **Comprehensive Comments**: Comments field now includes the cleaned narrative plus additional metadata (Authors, Date, Copyright) for complete information
  - Changes reviewed and approved by architecture review
  - All changes applied without breaking existing functionality
  - CSV exports now include full agency attribution in Authors and Copyright columns

- 2025-11-18: Fresh GitHub Import to Replit - Setup Complete ✅
  - Successfully imported fresh clone from GitHub repository
  - All npm dependencies installed (597 packages)
  - PostgreSQL database connected (existing DATABASE_URL)
  - Database schema synchronized with `npm run db:push`
  - Development workflow configured and running (npm run dev on port 5000)
  - VM deployment configuration set up (supports long-running Puppeteer processes)
  - Vite configuration already configured with allowedHosts: true for Replit proxy support
  - .gitignore created with proper Node.js, database, and build exclusions
  - Application tested and fully functional in Replit environment
  - Frontend accessible via webview on port 5000
  - Ready to use - just click Run!

- 2025-11-17: Enhanced Retry Logic & Failed Scrapes Logging ✅
  - **Robust retry mechanism**: 3 automatic retries with exponential backoff (2s, 4s, 8s delays)
  - **Failed scrapes logging**: Images that fail after all retries are automatically logged to text files
  - Log files saved to `failed-scrapes/` directory with detailed failure information
  - Each log includes: Image ID, URL, failure reason, attempt count, timestamp, and HTTP status
  - Improved error detection for navigation timeouts, HTTP errors (404, 500, 502, 503), error pages, and rate limiting
  - Success rate tracking: Console shows total attempted, failed count, and success percentage
  - **Failed images included in CSV**: Failed images are saved with partial data (Image ID, URL, etc.) so CSV exports include all attempted images

- 2025-11-17: Multi-URL Submission & CSV Export Enhancement ✅
  - **Added bulk URL submission**: Submit up to 20 URLs at once via textarea input
  - **Restored CSV export columns**: Re-added ImageID, Page URL, and Copy Link columns
  - CSV exports now include 10 columns (3 identifier fields + 7 metadata fields)
  - New API endpoint: `/api/scrape/bulk` for batch job creation
  - Updated UI to support multi-line URL input with improved validation
  - All jobs are created and processed in parallel

- 2025-11-17: GitHub Import to Replit - Setup Complete ✅
  - Successfully imported project from GitHub
  - All npm dependencies installed (597 packages)
  - PostgreSQL database connected and schema synchronized
  - Development workflow configured and running (npm run dev on port 5000)
  - VM deployment configuration set up (supports long-running Puppeteer processes)
  - Vite configuration verified with allowedHosts: true for Replit proxy support
  - Application tested and fully functional
  - .gitignore created with proper Node.js and database exclusions

- 2025-11-16: Performance Optimization (3-5x Faster)
  - **Reduced navigation timeout**: 60s → 30s for page loads (still retries 3x on failure)
  - **Reduced wait times**: smartframe-embed timeout 15s → 5s, metadata wait 10s → 3s
  - **Smart conditional waits**: Removed fixed 3s delay, now checks if metadata is ready
  - **Reduced logging overhead**: Disabled verbose debug logs for production speed
  - **Faster extraction**: Each image now takes 3-5 seconds instead of 13-18 seconds
  - **Parallel processing maintained**: Still processes 5 images concurrently
  - Result: **3-5x faster overall scraping** with same data quality
  
- 2025-11-16: Enhanced Error Detection & Rate Limit Handling
  - **New HTTP error detection**: Detects and handles 502, 503, 500, 404 errors
  - **Automatic retry with exponential backoff**: 3 attempts with 2s, 4s, 8s delays
  - **Error page content detection**: Skips images with error titles like "502 Bad Gateway"
  - **Smart rate-limit detection**: Identifies pages with no metadata (0 label-value pairs)
  - **Clean error logging**: Clear messages showing which images were skipped and why
  - Prevents saving invalid data when SmartFrame is rate-limiting or experiencing issues
  
- 2025-11-16: SQLite Bug Fix & Replit Setup Complete
  - **Fixed critical SQLite bug**: Added missing UNIQUE(job_id, image_id) constraint
  - Implemented automatic migration for existing SQLite databases
  - Fixed "ON CONFLICT clause does not match" error during image insertion
  - Migration preserves existing data and removes duplicates

- 2025-11-15: One-click local setup
  - Added SQLite support for local development (zero-config)
  - Implemented automatic database detection (PostgreSQL vs SQLite)
  - Updated `launch.bat` to auto-create `.env` file
  - Auto-initializes SQLite tables on first run
  - Dual schema support (PostgreSQL + SQLite)
  - Updated documentation for one-click Windows launch
