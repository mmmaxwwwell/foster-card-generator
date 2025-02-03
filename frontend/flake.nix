{
  description = "A basic project in flutter";

  inputs = {
    flake-utils = {
      url = "github:numtide/flake-utils";
    };
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
    android-nixpkgs = {
      url = "github:tadfisher/android-nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, flake-compat, android-nixpkgs }:
    flake-utils.lib.eachDefaultSystem ( system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true;
            android_sdk = {
              accept_license = true;
            };
          };
        };
        androidCustomPackage = android-nixpkgs.sdk.${system} (
          sdkPkgs: with sdkPkgs; [
            cmdline-tools-latest
            build-tools-30-0-3
            build-tools-33-0-2
            build-tools-34-0-0
            platform-tools
            emulator
            platforms-android-28
            platforms-android-29
            platforms-android-30
            platforms-android-31
            platforms-android-32
            platforms-android-33
            platforms-android-34
          ]
        );
        pinnedJDK = pkgs.jdk17; # jdk11, jdk13
      in {
        devShells = {
          default = pkgs.mkShell {
            name = "stuff";
            buildInputs = with pkgs; [
              flutter
              android-studio
              fdroidserver
            ] ++ [
              pinnedJDK
              #androidEnvCustomPackage.androidsdk
              androidCustomPackage
            ];
            #shellHook = ''
            #  GRADLE_USER_HOME=$HOME/gradle-user-home
            #  GRADLE_HOME=$HOME/gradle-home
            #'';
            JAVA_HOME = pinnedJDK;
            ANDROID_HOME = "${androidCustomPackage}/share/android-sdk";
            # ANDROID_SDK_HOME = "${androidCustomPackage}/share/android-sdk";
            GRADLE_USER_HOME = "/home/max/.gradle";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidCustomPackage}/share/android-sdk/build-tools/34.0.0/aapt2";
          };
        };
      }
    );
}
