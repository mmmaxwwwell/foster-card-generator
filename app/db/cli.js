#!/usr/bin/env node
/**
 * Database Migration CLI
 *
 * Usage:
 *   node app/db/cli.js migrate              - Run pending migrations
 *   node app/db/cli.js migrate:status       - Show migration status
 *   node app/db/cli.js migrate:rollback     - Rollback last migration
 *   node app/db/cli.js migrate:rollback:all - Rollback all migrations
 *   node app/db/cli.js migrate:create <name> - Create new migration
 *   node app/db/cli.js seed                 - Run seed data
 *   node app/db/cli.js seed:create <name>   - Create new seed file
 *   node app/db/cli.js db:reset             - Reset database (rollback all + migrate + seed)
 */

const path = require('path');

// Ensure we can load the db module
const dbPath = path.join(__dirname, '..');
const db = require(path.join(dbPath, 'db.js'));
const migrate = require('./migrate.js');
const seeds = require('./seeds.js');

async function main() {
    const args = process.argv.slice(2);
    const command = args[0];

    if (!command) {
        showHelp();
        process.exit(1);
    }

    try {
        // Initialize database first (for commands that need it)
        if (!['migrate:create', 'seed:create'].includes(command)) {
            console.log('[CLI] Initializing database...');
            await db.initializeAsync();
        }

        switch (command) {
            case 'migrate':
                runMigrations();
                break;

            case 'migrate:status':
                showStatus();
                break;

            case 'migrate:rollback':
                rollback(1);
                break;

            case 'migrate:rollback:all':
                rollbackAll();
                break;

            case 'migrate:create':
                createMigration(args[1]);
                break;

            case 'seed':
                runSeeds();
                break;

            case 'seed:create':
                createSeed(args[1]);
                break;

            case 'db:reset':
                await resetDatabase();
                break;

            default:
                console.error(`Unknown command: ${command}`);
                showHelp();
                process.exit(1);
        }

        // Close database
        if (!['migrate:create', 'seed:create'].includes(command)) {
            db.close();
        }

    } catch (err) {
        console.error('[CLI] Error:', err.message);
        process.exit(1);
    }
}

function showHelp() {
    console.log(`
Database Migration CLI

Usage:
  node app/db/cli.js <command> [options]

Commands:
  migrate               Run pending migrations
  migrate:status        Show migration status
  migrate:rollback      Rollback last migration
  migrate:rollback:all  Rollback all migrations
  migrate:create <name> Create new migration file
  seed                  Run seed data
  seed:create <name>    Create new seed file
  db:reset              Reset database (rollback all + migrate + seed)
`);
}

function runMigrations() {
    console.log('[CLI] Running migrations...');
    const applied = db.migrations.run();
    if (applied.length === 0) {
        console.log('[CLI] No pending migrations');
    } else {
        console.log(`[CLI] Applied ${applied.length} migration(s)`);
    }
}

function showStatus() {
    const status = db.migrations.status();

    console.log('\n=== Migration Status ===\n');

    if (status.applied.length === 0) {
        console.log('Applied migrations: (none)');
    } else {
        console.log('Applied migrations:');
        for (const m of status.applied) {
            console.log(`  ✓ ${m.version} - ${m.name}`);
        }
    }

    console.log('');

    if (status.pending.length === 0) {
        console.log('Pending migrations: (none)');
    } else {
        console.log('Pending migrations:');
        for (const m of status.pending) {
            console.log(`  ○ ${m.version} - ${m.name}`);
        }
    }

    console.log('');
}

function rollback(count) {
    console.log(`[CLI] Rolling back ${count} migration(s)...`);
    const rolledBack = db.migrations.rollback(count);
    if (rolledBack.length === 0) {
        console.log('[CLI] No migrations to rollback');
    } else {
        console.log(`[CLI] Rolled back ${rolledBack.length} migration(s)`);
    }
}

function rollbackAll() {
    console.log('[CLI] Rolling back all migrations...');
    const rolledBack = db.migrations.rollbackAll();
    if (rolledBack.length === 0) {
        console.log('[CLI] No migrations to rollback');
    } else {
        console.log(`[CLI] Rolled back ${rolledBack.length} migration(s)`);
    }
}

function createMigration(name) {
    if (!name) {
        console.error('[CLI] Migration name is required');
        console.error('Usage: node app/db/cli.js migrate:create <name>');
        process.exit(1);
    }
    const filepath = migrate.createMigration(name);
    console.log(`[CLI] Created: ${filepath}`);
}

function runSeeds() {
    console.log('[CLI] Running seeds...');
    db.seeds.run();
    console.log('[CLI] Seeds completed');
}

function createSeed(name) {
    if (!name) {
        console.error('[CLI] Seed name is required');
        console.error('Usage: node app/db/cli.js seed:create <name>');
        process.exit(1);
    }
    const filepath = seeds.createSeed(name);
    console.log(`[CLI] Created: ${filepath}`);
}

async function resetDatabase() {
    console.log('[CLI] Resetting database...');
    console.log('[CLI] Rolling back all migrations...');
    db.migrations.rollbackAll();
    console.log('[CLI] Running migrations...');
    db.migrations.run();
    console.log('[CLI] Running seeds...');
    db.seeds.run();
    console.log('[CLI] Database reset complete');
}

main().catch(err => {
    console.error('[CLI] Fatal error:', err);
    process.exit(1);
});
