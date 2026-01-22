{
  description = "Foster Card Generator - Generate printable cards for foster animals";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
        };

        # Import node2nix generated packages with PUPPETEER_SKIP_DOWNLOAD
        nodeEnv = import ./node-env.nix {
          inherit (pkgs) stdenv lib python2 runCommand writeTextFile writeShellScript;
          inherit pkgs;
          nodejs = pkgs.nodejs_22;
          libtool = if pkgs.stdenv.isDarwin then pkgs.cctools or pkgs.darwin.cctools else null;
        };

        node2nixPkgs = import ./node-packages.nix {
          inherit (pkgs) fetchurl nix-gitignore stdenv lib fetchgit;
          inherit nodeEnv;
          globalBuildInputs = [];
        };

        # Libraries needed for Electron
        electronLibs = with pkgs; [
          gtk3
          glib
          cairo
          pango
          gdk-pixbuf
          xorg.libX11
          xorg.libXrandr
          xorg.libxcb
          xorg.libXcomposite
          xorg.libXcursor
          xorg.libXdamage
          xorg.libXext
          xorg.libXfixes
          xorg.libXi
          xorg.libXrender
          xorg.libXtst
          xorg.libxshmfence
          libxkbcommon
          libpng
          stdenv.cc.cc.lib
          nss
          nspr
          dbus
          cups
          libdrm
          mesa
          libgbm
          expat
          alsa-lib
          at-spi2-atk
          at-spi2-core
          systemd
        ];

        # Main foster-card-generator package
        foster-card-generator = pkgs.stdenv.mkDerivation {
          pname = "foster-card-generator";
          version = "1.0.0";

          src = ./.;

          # Set PUPPETEER_SKIP_DOWNLOAD for the build
          PUPPETEER_SKIP_DOWNLOAD = "1";

          nativeBuildInputs = with pkgs; [
            makeWrapper
            nodejs_22
            python3
            pkg-config
            gnumake
            gcc
          ];

          buildInputs = with pkgs; [
            chromium
            sqlite
            gimp
            electron
            node2nixPkgs.nodeDependencies
          ];

          buildPhase = ''
            # Copy node_modules from node2nix (not link, to avoid broken symlink check)
            cp -rL ${node2nixPkgs.nodeDependencies}/lib/node_modules node_modules
            chmod -R u+w node_modules

            # Rebuild better-sqlite3 for Electron using electron-rebuild
            export HOME=$(mktemp -d)
            ${pkgs.nodejs_22}/bin/npx @electron/rebuild -f -w better-sqlite3 -v ${pkgs.electron.version}
          '';

          installPhase = ''
            mkdir -p $out/lib/foster-card-generator
            mkdir -p $out/bin
            mkdir -p $out/share/applications
            mkdir -p $out/share/icons/hicolor/256x256/apps

            # Copy the application
            cp -r app $out/lib/foster-card-generator/
            cp -r src $out/lib/foster-card-generator/
            cp -r db $out/lib/foster-card-generator/ || true
            cp package.json $out/lib/foster-card-generator/
            cp main.js $out/lib/foster-card-generator/

            # Copy node_modules
            cp -r node_modules $out/lib/foster-card-generator/

            # Copy icon
            cp src/new_icon.png $out/share/icons/hicolor/256x256/apps/foster-card-generator.png

            # Create wrapper script that runs electron
            makeWrapper ${pkgs.electron}/bin/electron $out/bin/foster-card-generator \
              --add-flags "$out/lib/foster-card-generator" \
              --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
              --set PUPPETEER_SKIP_DOWNLOAD "1" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.chromium pkgs.nodejs_22 pkgs.sqlite pkgs.gimp ]} \
              --prefix NODE_PATH : "$out/lib/foster-card-generator/node_modules" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath electronLibs}"

            # Create desktop entry
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
          '';

          meta = with pkgs.lib; {
            description = "Generate printable cards for foster animals";
            homepage = "https://github.com/yourusername/foster-card-generator";
            license = licenses.mit;
            maintainers = [ ];
            platforms = platforms.linux;
          };
        };

      in {
        packages = {
          default = foster-card-generator;
          foster-card-generator = foster-card-generator;
        };

        apps = {
          default = {
            type = "app";
            program = "${foster-card-generator}/bin/foster-card-generator";
          };
        };

        devShells = {
          default = pkgs.mkShell {
            name = "foster-card-generator-dev";
            buildInputs = with pkgs; [
              wkhtmltopdf
              qrencode
              nodejs_22
              chromium
              sqlite
              electron
              imagemagick
              # For Windows cross-compilation with electron-builder
              wineWowPackages.stable
              winetricks
              winePackages.fonts
              mono
            ] ++ electronLibs;
            shellHook = ''
              export PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath electronLibs}:$LD_LIBRARY_PATH"
            '';
          };
        };
      }
    ) // {
      # NixOS module for declarative installation
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
