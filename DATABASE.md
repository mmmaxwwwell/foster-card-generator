# Database Initialization

## Overview

The application now includes automatic database initialization on startup. The database tables will be created automatically if the database file doesn't exist.

## How It Works

### Neutralino Desktop App (Main App)

1. **On Startup**: The app checks if the `animals` table exists in `db/animals.db`
2. **If Table Doesn't Exist**:
   - Automatically creates the `animals` table with proper schema
   - Creates indexes and triggers
   - **Does NOT seed any data** - starts with an empty database
3. **If Table Exists**: Skips initialization and loads existing data

### Fastify Server (Optional)

1. **On Startup**: The server checks if the database file exists (specified by `DB_FILE_NAME` in `.env`)
2. **If Database Doesn't Exist**:
   - Automatically runs migration to create necessary tables
   - Creates `users` and `cards` tables with proper schema
   - **Does NOT seed any data** - starts with an empty database
3. **If Database Exists**: Skips initialization and uses existing database

## Configuration

Create a `.env` file (see `.env.example` for template):

```env
DB_FILE_NAME=file:./db/app.db
```

## Optional: Seeding Data

If you want to seed the database with sample data on startup, set:

```env
SEED_DB=true
```

This will populate the database with two sample dog profiles (Buddy and Bella).

## Database Schema

### Animals Table (Neutralino App)
- `id` - Auto-incrementing primary key
- `name` - Animal's name
- `slug` - URL-friendly identifier
- `size` - Size category (Small/Medium/Large)
- `shots` - Vaccination status (0/1)
- `housetrained` - House training status (0/1)
- `breed` - Animal's breed
- `age_long` - Full age description
- `age_short` - Brief age description
- `gender` - Male/Female
- `kids` - Compatible with kids ('0'/'1'/'?')
- `dogs` - Compatible with dogs ('0'/'1'/'?')
- `cats` - Compatible with cats ('0'/'1'/'?')
- `portrait_path` - Path to portrait image
- `portrait_data` - Binary image data (BLOB)
- `portrait_mime` - Image MIME type
- `created_at` - Timestamp
- `updated_at` - Timestamp (auto-updated via trigger)

### Users Table (Fastify Server)
- `id` - Auto-incrementing primary key
- `name` - User's name
- `email` - User's email (unique)
- `created_at` - Timestamp
- `updated_at` - Timestamp

### Cards Table (Fastify Server)
- `id` - Auto-incrementing primary key
- `name` - Dog's name
- `age` - Dog's age
- `breed` - Dog's breed
- `adoption_url` - URL to adoption page
- `gender` - Dog's gender
- `size` - Dog's size
- `shots` - Vaccination status (0/1)
- `housetrained` - House training status (0/1)
- `ok_with_kids` - Compatible with kids (0/1)
- `ok_with_dogs` - Compatible with dogs (0/1)
- `ok_with_cats` - Compatible with cats (0/1)
- `special_needs` - Has special needs (0/1)
- `created_at` - Timestamp
- `updated_at` - Timestamp

## Manual Migration

To manually create or reset the database:

```bash
# Delete the database file to force re-initialization
rm db/app.db

# Start the server (it will recreate the database)
npm start
```

## Legacy Migration

The old migration script (`db/migrate.js`) is still available for migrating data from YAML files:

```bash
npm run db:migrate          # Migrate YAML data to animals.db
npm run db:migrate --reset  # Reset and re-migrate
```
