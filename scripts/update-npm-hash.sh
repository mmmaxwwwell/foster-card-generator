#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

hash=$(nix-shell -p prefetch-npm-deps --run "prefetch-npm-deps package-lock.json")

if ! grep -q "npmDepsHash = \"${hash}\";" flake.nix; then
  sed -i -E "s|npmDepsHash = \"sha256-[^\"]+\";|npmDepsHash = \"${hash}\";|" flake.nix
  echo "updated flake.nix: npmDepsHash = \"${hash}\""
else
  echo "already current: npmDepsHash = \"${hash}\""
fi
