{ config, pkgs, lib, ... }:

let
  # Build derivation for the API (node app)
  cardgenerator = pkgs.stdenv.mkDerivation {
    pname = "cardgenerator";
    version = "1.0";
    src = pkgs.lib.cleanSource ./api;
    buildInputs = [ pkgs.nodejs ];
    buildPhase = '' 
      export PATH=${pkgs.nodejs}/bin:$PATH
      npm install
      npm run build
    '';
    installPhase = ''
      mkdir -p $out/bin
      # ...existing code to build the API...
      # Assume the built app entrypoint is at bin/index.js
      cp -r . $out/
      ln -s $out/dist/server.js $out/bin/cardgenerator
    '';
  };

  # New derivation to pre-fetch the Flutter package cache automatically.
  # flutterCache = pkgs.stdenv.mkDerivation {
  #   name = "flutter-pkg-cache";
  #   src = pkgs.lib.cleanSource ./frontend;
  #   buildInputs = [ pkgs.flutter ];
  #   allowNetwork = true;  # Allow network access to fetch packages
  #   buildPhase = ''
  #     home=$(mktemp -d)
  #     export HOME=$home
  #     mkdir -p $home/flutter_storage
  #     export FLUTTER_STORAGE_BASE=$home/flutter_storage
  #     mkdir -p $home/.config
  #     export FLUTTER_HOME=$home/.config
  #     flutter pub get
  #     cp -r $home/flutter_storage $out
  #   '';
  #   # No installPhase needed.
  #   installPhase = "true";
  # };

  # Build derivation for the frontend (flutter web)
  # frontend = pkgs.stdenv.mkDerivation {
  #   pname = "cardgenerator-frontend";
  #   version = "1.0";
  #   src = pkgs.lib.cleanSource ./frontend;
  #   buildInputs = [ pkgs.flutter ];
  #   allowNetwork = false;  # Disable network access during build
  #   buildPhase = ''
  #     home=$(mktemp -d)
  #     export HOME=$home
  #     mkdir -p $home/flutter_storage
  #     # Automatically load the pre-fetched package cache
  #     cp -r ${flutterCache}/* $home/flutter_storage/
  #     export FLUTTER_STORAGE_BASE=$home/flutter_storage
  #     mkdir -p $home/.config
  #     export FLUTTER_HOME=$home/.config
  #     flutter pub get --offline
  #     flutter build web --release
  #   '';
  #   installPhase = ''
  #     mkdir -p $out
  #     cp -r build/web $out/
  #   '';
  # };
in {
  # NixOS module options and configuration for cardgenerator service
  options.services.cardgenerator.enable = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = "Enable the Cardgenerator service (build API and frontend, serve API via systemd and frontend via nginx)";
  };

  config = lib.mkIf config.services.cardgenerator.enable {
    # Ensure the API becomes available as a command in the user environment
    environment.systemPackages = with pkgs; [ cardgenerator ];

    # # Systemd service for the Node API app
    # systemd.services.cardgenerator = {
    #   description = "Cardgenerator API service";
    #   after = [ "network.target" ];
    #   wantedBy = [ "multi-user.target" ];
    #   serviceConfig = {
    #     ExecStart = "${cardgenerator}/bin/cardgenerator";
    #     Restart = "on-failure";
    #   };
    # };

    # # Configure Nginx to serve the frontend assets as static files
    # services.nginx = {
    #   enable = true;
    #   virtualHosts."cardgenerator" = {
    #     root = "${frontend}";
    #     locations."/" = {
    #       extraConfig = ''
    #         index index.html;
    #       '';
    #     };
    #   };
    # };
  };

  # ...existing code or additional module configurations...
}
