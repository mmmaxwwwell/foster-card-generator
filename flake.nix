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

     in {
       devShells = {
         default = pkgs.mkShell {
           name = "stuff";
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
   );
}
