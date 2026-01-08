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

        # Libraries needed for Neutralino and Chromium
        neutralinoLibs = with pkgs; [
          gtk3
          glib
          cairo
          gdk-pixbuf
          xorg.libX11
          xorg.libXrandr
          xorg.libxcb
          libpng
          stdenv.cc.cc.lib
          webkitgtk_4_1
          nss
          nspr
          dbus
          cups
          libdrm
          mesa
          expat
          alsa-lib
          at-spi2-atk
          at-spi2-core
        ];

        # Wrapped script to run Neutralino with proper library paths
        neutralinoWrapper = pkgs.writeShellScriptBin "neu-run" ''
          export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath neutralinoLibs}:$LD_LIBRARY_PATH"
          cd "$1"
          exec ./bin/neutralino-linux_x64 "$@"
        '';

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
          ];

          buildInputs = with pkgs; [
            chromium
            sqlite
            node2nixPkgs.nodeDependencies
          ];

          buildPhase = ''
            # Copy node_modules from node2nix (not link, to avoid broken symlink check)
            cp -rL ${node2nixPkgs.nodeDependencies}/lib/node_modules node_modules
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

            # Copy node_modules
            cp -r node_modules $out/lib/foster-card-generator/

            # Copy icon
            cp src/logo.png $out/share/icons/hicolor/256x256/apps/foster-card-generator.png
            mkdir -p $out/lib/foster-card-generator/app/resources/icons
            cp src/logo.png $out/lib/foster-card-generator/app/resources/icons/appIcon.png

            # Make binaries executable first
            chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_x64
            chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_arm64
            chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_armhf
            chmod +x $out/lib/foster-card-generator/app/generate-card-cli.js

            # Create wrapper to run Neutralino
            makeWrapper $out/lib/foster-card-generator/app/bin/neutralino-linux_x64 $out/bin/foster-card-generator \
              --chdir "$out/lib/foster-card-generator/app" \
              --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
              --set PUPPETEER_SKIP_DOWNLOAD "1" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.chromium pkgs.nodejs_22 pkgs.sqlite ]} \
              --prefix NODE_PATH : "$out/lib/foster-card-generator/node_modules" \
              --prefix LD_LIBRARY_PATH : "${pkgs.lib.makeLibraryPath neutralinoLibs}"

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
              neutralinoWrapper
              zenity  # Required for Neutralino file dialogs on Linux
            ] ++ neutralinoLibs;
            shellHook = ''
              export PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath neutralinoLibs}:$LD_LIBRARY_PATH"
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
