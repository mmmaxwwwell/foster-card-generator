{
  description = "";

  inputs = {
    flake-utils = {
      url = "github:numtide/flake-utils";
    };
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, flake-utils, flake-compat}:
    flake-utils.lib.eachDefaultSystem ( system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            programs.nix-ld.enable = true;
            programs.nix-ld.libraries = with pkgs; [
              # Add any missing dynamic libraries for unpackaged programs
              # here, NOT in environment.systemPackages
              google-chrome
            ];
          };
        };
      in {
        devShells = {
          default = pkgs.mkShell {
            name = "stuff";
            buildInputs = with pkgs; [
              wkhtmltopdf
              qrencode
              nodejs_22
              chromium  # Added Chromium to buildInputs
            ];
            shellHook = ''
              export PUPPETEER_EXECUTABLE_PATH=${pkgs.chromium}/bin/chromium
            '';
          };
        };
      }
    );
}
