# NixOS Installation Guide

Foster Card Generator ships as a Nix flake, so NixOS (and non-NixOS Nix) users
can install it straight from the remote repository without cloning.

## Quick start

```bash
nix profile install github:mmmaxwwwell/foster-card-generator
```

Or from the Forgejo mirror:

```bash
nix profile install git+https://forgejo.a110c8.net/max/foster-card-generator
```

That's it — `foster-card-generator` is now on your `PATH` and in your app
launcher.

### Pinning a version

- Track the default branch (`main`): `github:mmmaxwwwell/foster-card-generator`
- Pin to a release tag: `github:mmmaxwwwell/foster-card-generator/v3.0.3`
- Pin to a commit: `github:mmmaxwwwell/foster-card-generator/<sha>`

The same pin syntax works with the `git+https://...` form
(`git+https://forgejo.a110c8.net/max/foster-card-generator?ref=v3.0.3`).

## Prerequisites

Flakes must be enabled. On NixOS, add this to your configuration:

```nix
{
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}
```

On non-NixOS installs, put the same line in `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

If you can't or don't want to enable flakes, skip to
[Method 2](#method-2-using-packagenix-no-flakes-required).

## Not using Nix?

Linux releases now include an AppImage. Download the latest
`Foster-Card-Generator-*.AppImage` from the
[Releases page](https://github.com/mmmaxwwwell/foster-card-generator/releases),
`chmod +x` it, and run it. No Nix required.

## Installation Methods

### Method 1: NixOS Module (system-wide)

Add the flake as an input and enable the module:

```nix
{
  inputs.foster-card-generator.url = "github:mmmaxwwwell/foster-card-generator";
  # or: inputs.foster-card-generator.url = "git+https://forgejo.a110c8.net/max/foster-card-generator";

  outputs = { self, nixpkgs, foster-card-generator, ... }: {
    nixosConfigurations.yourHostname = nixpkgs.lib.nixosSystem {
      modules = [
        foster-card-generator.nixosModules.default
        {
          services.foster-card-generator.enable = true;
          # Optional: customize data directories
          # services.foster-card-generator.dataDir = "/var/lib/foster-card-generator";
          # services.foster-card-generator.outputDir = "/var/lib/foster-card-generator/output";
        }
      ];
    };
  };
}
```

Pin to a tag by appending it to the URL:
`github:mmmaxwwwell/foster-card-generator/v3.0.3`.

### Method 2: Direct Flake Package

Inline the flake reference directly in `configuration.nix` or a home-manager
config:

```nix
{
  environment.systemPackages = [
    (builtins.getFlake "github:mmmaxwwwell/foster-card-generator").packages.${pkgs.system}.default
  ];
}
```

### Method 3: User Profile Install

Install for the current user only:

```bash
nix profile install github:mmmaxwwwell/foster-card-generator
# pin to a tag:
nix profile install github:mmmaxwwwell/foster-card-generator/v3.0.3
```

Update later with `nix profile upgrade foster-card-generator`.

### Method 4: Temporary Shell (try before installing)

```bash
nix shell github:mmmaxwwwell/foster-card-generator
foster-card-generator
```

Leaves nothing installed — the shell exits, the package is garbage-collected on
the next `nix-collect-garbage`.

## Usage

After installation, Foster Card Generator appears in your application launcher.
From the terminal:

```bash
foster-card-generator
```

For scripted card generation:

```bash
node /path/to/foster-card-generator/app/generate-card-cli.js '<json-params>'
```

---

# Developers

Everything below is for working *on* this repo, not installing it.

## Building

Clone, then:

```bash
nix build          # build the package into ./result
nix run            # run without installing
nix develop        # enter a shell with all build dependencies
```

## Building for Windows

The Nix dev shell includes wine and mono so you can cross-compile Windows
executables from Linux:

```bash
nix develop
npm ci
npm run build:win            # NSIS + portable
# or a single target:
npm run build -- --win nsis
npm run build -- --win portable
```

Output lands in `dist/`:
- `Foster Card Generator Setup X.X.X.exe` — NSIS installer
- `Foster Card Generator-X.X.X-portable.exe` — portable .exe

## Building for Linux (AppImage)

```bash
nix develop
npm ci
npm run build:linux
```

Output: `dist/Foster Card Generator-X.X.X.AppImage`.

## Automated Releases

Pushing a version tag triggers GitHub Actions to build Windows (.exe) and Linux
(.AppImage) artifacts and attach them to a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Updating Dependencies

1. Update `package.json` and regenerate the lockfile:
   ```bash
   npm install
   ```

2. Refresh the Nix npm deps hash in `flake.nix`:
   ```bash
   ./scripts/update-npm-hash.sh
   ```

3. Commit:
   ```bash
   git add package.json package-lock.json flake.nix
   git commit -m "Update npm dependencies"
   ```

## Troubleshooting

### Build fails with `getaddrinfo EAI_AGAIN`

Puppeteer is trying to download Chrome at build time. `PUPPETEER_SKIP_DOWNLOAD
= "1"` is set in `flake.nix`; if you still see this, verify `npmFlags = [
"--ignore-scripts" ]` hasn't been removed.

### Build fails with `hash mismatch` for npm deps

`package-lock.json` changed but `npmDepsHash` in `flake.nix` is stale. Run
`./scripts/update-npm-hash.sh` to refresh it.

## How It Works

- **buildNpmPackage** fetches every npm dep declared in `package-lock.json` and
  verifies the full tree against `npmDepsHash` in `flake.nix`
- **Puppeteer** uses system Chromium (via `PUPPETEER_EXECUTABLE_PATH`) instead
  of downloading its own
- **Node.js 22** is provided by `pkgs.nodejs_22` in the dev shell and build

The flake exposes:
- `packages.default` — the app
- `apps.default` — direct execution via `nix run`
- `devShells.default` — build dependencies for development
- `nixosModules.default` — NixOS module for system-wide installation
