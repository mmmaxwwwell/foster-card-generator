{ pkgs ? import <nixpkgs> { } }:

let
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
    globalBuildInputs = [ ];
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

in
pkgs.stdenv.mkDerivation {
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
    gimp
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

    # Copy resources.neu from dist (pre-built by neu build)
    cp app/dist/foster-app/resources.neu $out/lib/foster-card-generator/app/

    # Make binaries executable first
    chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_x64
    chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_arm64
    chmod +x $out/lib/foster-card-generator/app/bin/neutralino-linux_armhf
    chmod +x $out/lib/foster-card-generator/app/generate-card-cli.js

    # Create launcher script
    cat > $out/bin/foster-card-generator <<'LAUNCHER'
    #!/usr/bin/env bash
    # Create data directory for app output
    mkdir -p "$HOME/.local/share/foster-card-generator/output"

    # Run Neutralino with the app path
    exec "@out@/lib/foster-card-generator/app/bin/neutralino-linux_x64" --path="@out@/lib/foster-card-generator/app" "$@"
    LAUNCHER
    chmod +x $out/bin/foster-card-generator
    substituteInPlace $out/bin/foster-card-generator --replace "@out@" "$out"

    # Set up environment via a wrapper around our launcher
    mv $out/bin/foster-card-generator $out/bin/.foster-card-generator-unwrapped
    makeWrapper $out/bin/.foster-card-generator-unwrapped $out/bin/foster-card-generator \
      --set PUPPETEER_EXECUTABLE_PATH "${pkgs.chromium}/bin/chromium" \
      --set PUPPETEER_SKIP_DOWNLOAD "1" \
      --prefix PATH : ${pkgs.lib.makeBinPath [ pkgs.chromium pkgs.nodejs_22 pkgs.sqlite pkgs.gimp ]} \
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
}
