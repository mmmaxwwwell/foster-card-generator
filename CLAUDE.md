# Claude Code Instructions

See [AGENTS.md](AGENTS.md) for comprehensive documentation about this codebase.

## Quick Reference

- **Purpose**: Electron desktop app for creating printable foster animal trading cards
- **Stack**: Electron, sql.js, Puppeteer, Sharp, Handlebars
- **Main entry**: `main.js` (Electron main process)
- **UI**: `app/resources/` (vanilla JS, no framework)
- **Database**: `app/db.js` with migrations in `app/db/migrations/`

## Before Releases

1. Update npm packages if needed
2. If package.json changed, regenerate node2nix: `node2nix -l package-lock.json -c node-packages.nix`
3. Review [AGENTS.md](AGENTS.md) for accuracy
4. Build and test
