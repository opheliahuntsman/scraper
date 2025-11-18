# SmartFrame Scraper

Professional image metadata extraction tool for SmartFrame search pages.

## Overview

This application scrapes image data from smartframe.com search results and extracts detailed metadata including EXIF data, captions, photographer information, location data, and more. Features persistent PostgreSQL storage and CSV/JSON export capabilities.

## Features

- 🔍 Web scraping of SmartFrame image galleries
- ⚡ **Multi-threaded parallel processing** - Up to 10x faster with concurrent browser tabs
- 🔄 **Advanced retry mechanism** - Multiple retry rounds with exponential backoff and smart error filtering
- 📜 Automatic infinite scroll handling
- 📸 EXIF metadata extraction (photographer, date, location, etc.)
- 🤖 Automatic caption generation for images
- 📊 Export to JSON or CSV format
- 🛡️ Rate limiting to prevent abuse
- 📈 Job-based scraping with real-time progress tracking
- 💾 PostgreSQL database for persistent storage across deployments
- 📝 Comprehensive failure logging and recovery

## Tech Stack

- **Frontend**: React, Vite, TypeScript, TailwindCSS, Radix UI
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL (Drizzle ORM)
- **Scraping**: Puppeteer
- **UI Components**: shadcn/ui

## Quick Start

### Running in Replit (Recommended)

✅ **Already configured and ready to use!**

1. Click the **Run** button
2. The application will start automatically
3. Database is pre-configured
4. Access via the Webview tab

No additional setup needed - everything is configured!

### Running Locally (Windows/Mac/Linux)

**One-Click Launch** - Just run the launcher!

#### Windows:
Simply double-click `launch.bat` - that's it! The app will:
- Auto-install dependencies (first time only)
- Auto-create configuration with SQLite database
- Auto-start the application

#### Mac/Linux:
```bash
npm install
npm run dev
```

The app will be available at `http://localhost:5000`

**No database setup required!** The app uses SQLite for local development (data stored in `./data/local.db`).

**Want to use PostgreSQL locally?** See [LOCAL_SETUP.md](LOCAL_SETUP.md) for advanced configuration.

### Production Build

```bash
npm run build
npm run start
```

## Environment Variables

- `DATABASE_URL` - PostgreSQL connection string (required)
- `PORT` - Server port (default: 5000)
- `NODE_ENV` - Environment (development/production)

## API Endpoints

### POST `/api/scrape/start`
Start a new scraping job
```json
{
  "url": "https://smartframe.com/search?...",
  "maxImages": 100,
  "extractDetails": true,
  "sortBy": "relevance",
  "autoScroll": true,
  "scrollDelay": 1000
}
```

### GET `/api/scrape/job/:jobId`
Get status and results of a scraping job

### GET `/api/scrape/jobs`
Get all scraping jobs

### GET `/api/export/:jobId?format=json|csv`
Export job results as JSON or CSV

## Advanced Configuration

### IP Rotation / Proxy Support

The scraper includes a robust retry mechanism with exponential backoff that handles most rate limiting scenarios. For advanced users who need IP rotation, see [IP_ROTATION.md](IP_ROTATION.md) for configuration options.

## License

MIT