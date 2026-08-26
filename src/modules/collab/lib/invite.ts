import type { GuestTerminalCredentials } from "@/modules/collab/types";

export type GuestInvitationForm = Omit<GuestTerminalCredentials, "sessionId">;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function credentialsFromGuestForm(
  form: GuestInvitationForm,
): GuestTerminalCredentials {
  const connectionUrl = form.connectionUrl.trim();
  const inviteCode = form.inviteCode.trim();
  const participantName = form.participantName.trim();

  if (!connectionUrl) throw new Error("connection_url_required");
  if (!inviteCode) throw new Error("invite_code_required");
  if (!participantName) throw new Error("participant_name_required");

  let url: URL;
  try {
    url = new URL(connectionUrl);
  } catch {
    throw new Error("invalid_connection_url");
  }

  const secure = url.protocol === "wss:";
  const local = url.protocol === "ws:" && LOOPBACK_HOSTS.has(url.hostname);
  if (!secure && !local) throw new Error("secure_url_required");
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("invalid_connection_url");
  }

  const match = /^\/v1\/session\/([^/]+)\/?$/.exec(url.pathname);
  const sessionId = match?.[1]?.trim();
  if (!sessionId) throw new Error("invalid_connection_url");

  return { connectionUrl, sessionId, inviteCode, participantName };
}
