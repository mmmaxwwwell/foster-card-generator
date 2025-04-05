{
  description = "A simple flake using the make-shell flake module";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    snow-blower.url = "path:/home/sincore/source/snow-blower";
  };

  outputs = inputs:
    inputs.snow-blower.mkSnowBlower {
      inherit inputs;
      perSystem = {
        config,
        pkgs,
        ...
      }: let
        serv = config.snow-blower.services;
        lang = config.snow-blower.languages;
        env = config.snow-blower.env;

      in {
        snow-blower = {
          paths.src = ./.;
          dotenv.enable = true;
          packages = [
            pkgs.google-chrome
          ];

          processes = {
            npm-dev.exec = ''
                npm run dev
            '';
          };

          languages = {
            javascript.enable = true;
            javascript.npm.enable = true;
          };

          services = {
            aider.enable = true;
          };

          integrations = {

            git-cliff.enable = true;

            treefmt = {
              settings.formatter = {

              };
              programs = {
                alejandra.enable = true;
                prettier = {
                  enable = true;
                  settings = {
                    trailingComma = "es5";
                    semi = true;
                    singleQuote = true;
                    jsxSingleQuote = true;
                    bracketSpacing = true;
                    printWidth = 80;
                    tabWidth = 2;
                    endOfLine = "lf";
                  };
                };
              };
            };

            git-hooks.hooks = {
              treefmt = {
                enable = true;
              };
            };
          };
        };
      };
    };
}
#
#
#{
#  description = "";
#
#  inputs = {
#    flake-utils = {
#      url = "github:numtide/flake-utils";
#    };
#    flake-compat = {
#      url = "github:edolstra/flake-compat";
#      flake = false;
#    };
#  };
#
#  outputs = { self, nixpkgs, flake-utils, flake-compat}:
#    flake-utils.lib.eachDefaultSystem ( system:
#      let
#        pkgs = import nixpkgs {
#          inherit system;
#          config = {
#            programs.nix-ld.enable = true;
#            programs.nix-ld.libraries = with pkgs; [
#              # Add any missing dynamic libraries for unpackaged programs
#              # here, NOT in environment.systemPackages
#              google-chrome
#            ];
#          };
#        };
#      in {
#        devShells = {
#          default = pkgs.mkShell {
#            name = "stuff";
#            buildInputs = with pkgs; [
#              wkhtmltopdf
#              qrencode
#              nodejs_22
#              chromium  # Added Chromium to buildInputs
#            ];
#            shellHook = ''
#              export PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
#            '';
#          };
#        };
#      }
#    );
#}
