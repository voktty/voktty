import type { RemoteSshConnection } from "./client";

export function normalizedRemoteSessionConnection(
  connection: RemoteSshConnection,
): Readonly<RemoteSshConnection> {
  return Object.freeze({
    host: connection.host.trim(),
    user: connection.user?.trim() || undefined,
    port: connection.port ?? 22,
    identityFile: connection.identityFile?.trim() || undefined,
    extraArgs: connection.extraArgs?.trim() || undefined,
    initialDirectory: connection.initialDirectory?.trim() || undefined,
  });
}

export function sameRemoteSessionConnection(
  left: RemoteSshConnection,
  right: RemoteSshConnection,
): boolean {
  const a = normalizedRemoteSessionConnection(left);
  const b = normalizedRemoteSessionConnection(right);
  return (
    a.host === b.host &&
    a.user === b.user &&
    a.port === b.port &&
    a.identityFile === b.identityFile &&
    a.extraArgs === b.extraArgs &&
    a.initialDirectory === b.initialDirectory
  );
}
