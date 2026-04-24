{
  description = "Foster Card Generator - Generate printable cards for foster animals";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };

        electronLibs = with pkgs; [
          gtk3 glib cairo pango gdk-pixbuf
          xorg.libX11 xorg.libXrandr xorg.libxcb xorg.libXcomposite
          xorg.libXcursor xorg.libXdamage xorg.libXext xorg.libXfixes
          xorg.libXi xorg.libXrender xorg.libXtst xorg.libxshmfence
          libxkbcommon libpng stdenv.cc.cc.lib nss nspr dbus cups
          libdrm mesa libgbm expat alsa-lib at-spi2-atk at-spi2-core systemd
        ];

        # Fetches and builds node_modules from package-lock.json (v3) using
        # nixpkgs' buildNpmPackage. `--ignore-scripts` skips the
        # electron-builder postinstall and puppeteer's Chromium download;
        # neither is needed at runtime here (we use pkgs.electron and
        # pkgs.chromium). sql.js is pure JS, so no native rebuild is needed.
        foster-card-generator = pkgs.buildNpmPackage {
          pname = "foster-card-generator";
          version = "1.0.0";
          src = ./.;

          npmDepsHash = "sha256-60Jo3hZwCvlbyBVJB8AnLaDJXfzAofGAnD6qSreKpRs=";

          npmFlags = [ "--ignore-scripts" ];
          dontNpmBuild = true;
          makeCacheWritable = true;

          PUPPETEER_SKIP_DOWNLOAD = "1";

          nativeBuildInputs = [ pkgs.makeWrapper ];

          installPhase = ''
            runHook preInstall

            mkdir -p $out/lib/foster-card-generator
            mkdir -p $out/bin
            mkdir -p $out/share/applications
            mkdir -p $out/share/icons/hicolor/256x256/apps

            cp -r app src db package.json main.js $out/lib/foster-card-generator/
            cp -r node_modules $out/lib/foster-card-generator/

            # Electron's `require('electron')` intercept resolves via the
            # normal Node module path first. The electron npm package ships an
            # index.js that returns the path to the bundled binary — which is
            # wrong here because we use pkgs.electron. Replace it with a stub
            # so Electron's built-in loader wins.
            cat > $out/lib/foster-card-generator/node_modules/electron/index.js <<'JS'
            throw new Error('electron npm shim: should be intercepted by Electron main process');
            JS

            cp src/new_icon.png $out/share/icons/hicolor/256x256/apps/foster-card-generator.png

            makeWrapper ${pkgs.electron}/bin/electron $out/bin/foster-card-generator \
              --add-flags "$out/lib/foster-card-generator" \
              --unset ELECTRON_RUN_AS_NODE \
              --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
              --set PUPPETEER_SKIP_DOWNLOAD "1" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.chromium pkgs.nodejs_22 pkgs.sqlite pkgs.gimp ]} \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath electronLibs}"

            cat > $out/share/applications/foster-card-generator.desktop <<EOF
            [Desktop Entry]
            Type=Application
            Name=Foster Card Generator
            Comment=Generate printable cards for foster animals
            Exec=$out/bin/foster-card-generator
            Icon=foster-card-generator
            Terminal=false
            Categories=Utility;Graphics;
            EOF

            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Generate printable cards for foster animals";
            homepage = "https://github.com/yourusername/foster-card-generator";
            license = licenses.mit;
            platforms = platforms.linux;
          };
        };

      in {
        packages = {
          default = foster-card-generator;
          foster-card-generator = foster-card-generator;
        };

        apps.default = {
          type = "app";
          program = "${foster-card-generator}/bin/foster-card-generator";
        };

        devShells.default = pkgs.mkShell {
          name = "foster-card-generator-dev";
          buildInputs = with pkgs; [
            wkhtmltopdf qrencode nodejs_22 chromium sqlite electron imagemagick
            wineWowPackages.stable winetricks winePackages.fonts mono
          ] ++ electronLibs;
          shellHook = ''
            unset ELECTRON_RUN_AS_NODE
            export PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
            export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}:$LD_LIBRARY_PATH"
          '';
        };
      }
    ) // {
      nixosModules.default = { config, lib, pkgs, ... }:
        with lib;
        let
          cfg = config.services.foster-card-generator;
        in {
          options.services.foster-card-generator = {
            enable = mkEnableOption "Foster Card Generator service";
            package = mkOption {
              type = types.package;
              default = self.packages.${pkgs.system}.default;
              description = "The foster-card-generator package to use";
            };
            dataDir = mkOption {
              type = types.path;
              default = "/var/lib/foster-card-generator";
              description = "Directory for foster card data";
            };
            outputDir = mkOption {
              type = types.path;
              default = "/var/lib/foster-card-generator/output";
              description = "Directory for generated card output";
            };
          };

          config = mkIf cfg.enable {
            environment.systemPackages = [ cfg.package ];
            systemd.tmpfiles.rules = [
              "d ${cfg.dataDir} 0755 root root -"
              "d ${cfg.outputDir} 0755 root root -"
            ];
          };
        };
    };
}
