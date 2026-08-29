export type BuiltinAction =
  | "ipme"
  | "port"
  | "sslcheck"
  | "jwt"
  | "envdiff"
  | "hash"
  | "sysinfo"
  | "bench";

export type AliasTarget =
  | {
      kind: "command";
      executable: string;
      args: string[];
    }
  | {
      kind: "builtin";
      action: BuiltinAction;
    };

export interface AliasDefinition {
  description: string;
  enabled: boolean;
  disabledWorkspaces: string[];
  disabledProfiles: string[];
  target: AliasTarget;
}

export interface ResolvedAlias {
  name: string;
  source: "preinstalled" | "user";
  definition: AliasDefinition;
}

export interface AliasFile {
  $schema?: string;
  aliases: Record<string, AliasDefinition>;
}

export interface AliasesStateDto {
  configPath: string;
  effective: ResolvedAlias[];
  user: AliasFile;
  preinstalled: AliasFile;
}
