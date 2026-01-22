# NixOS Installation Guide

This app can be installed declaratively on NixOS using the provided flake.

## Installation Methods

### Method 1: Using NixOS Module (Recommended for system-wide installation)

Add the flake to your NixOS configuration:

```nix
{
  inputs.foster-card-generator.url = "path:/home/max/git/foster-card-generator";
  # Or use git: inputs.foster-card-generator.url = "git+file:///home/max/git/foster-card-generator";

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

### Method 2: Using package.nix (Simple, no flake required)

Import the package directly in your NixOS configuration using `package.nix`:

```nix
{ lib, config, pkgs, ... }:

let
  foster-card-generator = import /path/to/foster-card-generator/package.nix { inherit pkgs; };
in
{
  environment.systemPackages = [
    foster-card-generator
  ];
}
```

This method:
- Works without enabling flakes
- Uses your system's `nixpkgs` version
- Can be used in any NixOS module file (e.g., `configuration.nix` or a separate module)

### Method 3: Direct Flake Package Installation

Add to your `configuration.nix` or home-manager configuration:

```nix
{
  environment.systemPackages = [
    (builtins.getFlake "path:/home/max/git/foster-card-generator").packages.${pkgs.system}.default
  ];
}
```

### Method 4: User Profile Installation

Install to your user profile:

```bash
nix profile install .#foster-card-generator
```

### Method 5: Temporary Shell

Try it out without installing:

```bash
nix shell .#foster-card-generator
```

## Building

To build the package locally:

```bash
nix build
```

To run directly without building:

```bash
nix run
```

## Usage

After installation, Foster Card Generator will be available:

### Desktop Application

The app appears in your application launcher (dmenu, rofi, etc.) as "Foster Card Generator" with an icon. Simply launch it from your app menu or run:

```bash
foster-card-generator
```

This starts the Neutralino desktop application for generating foster animal cards.

### Command Line (Advanced)

For CLI usage of the card generator, you can run:

```bash
node /path/to/foster-card-generator/app/generate-card-cli.js '<json-params>'
```

## Development

To enter a development shell with all dependencies:

```bash
nix develop
```

## Updating Dependencies

If you need to update npm dependencies:

1. Update `package.json` and regenerate `package-lock.json`:
   ```bash
   npm install --lockfile-version=2 --legacy-peer-deps
   ```

2. Regenerate node2nix files:
   ```bash
   nix-shell -p node2nix --run "node2nix -18 -i package.json"
   ```

3. Add PUPPETEER_SKIP_DOWNLOAD to node-packages.nix args (line ~7168):
   ```nix
   production = true;
   bypassCache = true;
   reconstructLock = true;
   PUPPETEER_SKIP_DOWNLOAD = "1";
   ```

4. Commit the updated files:
   ```bash
   git add package.json package-lock.json node-packages.nix node-env.nix default.nix
   git commit -m "Update npm dependencies"
   ```

## Troubleshooting

### Build fails with "getaddrinfo EAI_AGAIN"

This means Puppeteer is trying to download Chrome during the build. Ensure `PUPPETEER_SKIP_DOWNLOAD = "1"` is set in `node-packages.nix` args section.

### Missing dependencies

If you get module not found errors, regenerate the node2nix files following the "Updating Dependencies" section above.

## How It Works

This package uses:
- **node2nix**: Generates Nix expressions from npm dependencies
- **Puppeteer**: Uses system Chromium instead of downloading its own (set via `PUPPETEER_EXECUTABLE_PATH`)
- **Node.js 22**: Specified via `--pkg-name nodejs_22` in node2nix

The flake provides:
- `packages.default`: The foster-card-generator CLI tool
- `apps.default`: Direct execution via `nix run`
- `devShells.default`: Development environment with all dependencies
- `nixosModules.default`: NixOS module for system-wide installation
