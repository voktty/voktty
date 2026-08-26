{
  description = "Voktty - open-source lightweight cross-platform AI-native terminal (ADE)";

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }: let
    forAllSystems = nixpkgs.lib.genAttrs [ "x86_64-linux" "x86_64-darwin" "aarch64-darwin" ];
  in {
    packages = forAllSystems (system: let
      pkgs = nixpkgs.legacyPackages.${system};
    in {
      voktty = pkgs.callPackage ./nix/package.nix { };
      default = self.packages.${system}.voktty;
    });

    nixosModules.voktty = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.voktty ];
    };

    darwinModules.voktty = { pkgs, ... }: {
      environment.systemPackages = [ self.packages.${pkgs.system}.voktty ];
    };
  };
}
