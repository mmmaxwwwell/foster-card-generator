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

        # Import node2nix generated packages
        nodeEnv = import ./node-env.nix {
          inherit (pkgs) stdenv lib python2 runCommand writeTextFile writeShellScript;
          inherit pkgs;
          nodejs = pkgs.nodejs_22;
          libtool = if pkgs.stdenv.isDarwin then pkgs.cctools or pkgs.darwin.cctools else null;
        };

        node2nixPkgs = import ./node-packages.nix {
          inherit (pkgs) fetchurl nix-gitignore stdenv lib fetchgit;
          inherit nodeEnv;
        };

        # Libraries needed for Neutralino
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
            # Link node_modules from node2nix
            ln -sf ${node2nixPkgs.nodeDependencies}/lib/node_modules/foster-card-generator/node_modules node_modules
          '';

          installPhase = ''
            mkdir -p $out/lib/foster-card-generator
            mkdir -p $out/bin

            # Copy the application
            cp -r app $out/lib/foster-card-generator/
            cp -r src $out/lib/foster-card-generator/
            cp -r db $out/lib/foster-card-generator/ || true
            cp package.json $out/lib/foster-card-generator/

            # Link node_modules
            ln -sf ${node2nixPkgs.nodeDependencies}/lib/node_modules/foster-card-generator/node_modules $out/lib/foster-card-generator/node_modules

            # Create wrapper for the CLI tool
            makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/foster-card-generator \
              --add-flags "$out/lib/foster-card-generator/app/generate-card-cli.js" \
              --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
              --set PUPPETEER_SKIP_DOWNLOAD "1" \
              --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.chromium ]} \
              --prefix NODE_PATH : "$out/lib/foster-card-generator/node_modules"

            # Make the CLI executable
            chmod +x $out/lib/foster-card-generator/app/generate-card-cli.js
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
