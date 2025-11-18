# Local Development Setup Guide

## Quick Start (One-Click Launch) ✨

**Windows Users:** Just double-click `launch.bat` - No setup required!

The launcher will automatically:
1. Install dependencies (if needed)
2. Create a `.env` configuration file
3. Set up SQLite database (no external database needed)
4. Start the application

Open http://localhost:5000 in your browser and you're done!

---

## Advanced Setup (PostgreSQL)

This section is **optional**. Only needed if you want to use PostgreSQL instead of SQLite.

### Prerequisites

1. **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
2. **PostgreSQL Database** - Choose one option:

### Option A: Cloud Database (Recommended for beginners)

Use a free cloud PostgreSQL service:
- [Neon](https://neon.tech) - Free tier available
- [Supabase](https://supabase.com) - Free tier available
- [ElephantSQL](https://www.elephantsql.com/) - Free tier available

### Option B: Local PostgreSQL Installation

1. Download PostgreSQL: https://www.postgresql.org/download/windows/
2. Install with default settings (remember your password!)
3. Use pgAdmin to create a new database called `smartframe_db`

## Setup Steps

1. **Create a `.env` file** in the project root (same folder as launch.bat):

```env
DATABASE_URL=postgresql://username:password@localhost:5432/smartframe_db
NODE_ENV=development
PORT=5000
```

Replace with your actual database credentials:
- `username` - your PostgreSQL username (default: postgres)
- `password` - your PostgreSQL password
- `localhost:5432` - database host and port
- `smartframe_db` - database name

**Example for cloud database (Neon):**
```env
DATABASE_URL=postgresql://user:pass@ep-cool-forest-123456.us-east-2.aws.neon.tech/neondb
```

2. **Install dependencies:**

```bash
npm install
```

3. **Push the database schema:**

```bash
npm run db:push
```

This creates the necessary tables in your database.

4. **Start the application:**

```bash
npm run dev
```

Or simply double-click `launch.bat`

5. **Open your browser:**

Navigate to http://localhost:5000

## Troubleshooting

### "No database connection string" error

- Make sure you have a `.env` file in the project root
- Verify your DATABASE_URL is correct
- Test your database connection using a tool like pgAdmin or DBeaver

### "drizzle-kit: not found" error

Run `npm install` to install all dependencies

### Port 5000 already in use

Change the PORT in your `.env` file to a different number (e.g., 3000, 8080)

## Running in Replit

If you prefer to use Replit (no local setup required):
1. The application is already configured and running
2. Database is automatically provisioned
3. Just click the "Run" button or open the Webview

No additional setup is needed in Replit!
