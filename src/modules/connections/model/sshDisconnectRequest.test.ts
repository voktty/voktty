import { expect, it, vi } from "vitest";
import { requestSshDisconnect, subscribeSshDisconnectRequests } from "@/modules/connections/model/sshDisconnectRequest";

it.each([undefined, null, {}, 1, "", " ", " profile", "profile ", "x".repeat(257)])(
  "rejects malformed profile identities without delivery (%j)", (input) => {
    const receive = vi.fn();
    const release = subscribeSshDisconnectRequests(receive);
    try {
      Reflect.apply(requestSshDisconnect, undefined, [input]);
      expect(receive).not.toHaveBeenCalled();
    } finally { release(); }
  },
);

it("delivers the exact profile identity and preserves its case", () => {
  const receive = vi.fn();
  const release = subscribeSshDisconnectRequests(receive);
  try {
    requestSshDisconnect("SSH-Profile/日本語");
    requestSshDisconnect("x".repeat(256));
    expect(receive.mock.calls).toEqual([["SSH-Profile/日本語"], ["x".repeat(256)]]);
  } finally { release(); }
});

it("has no replay for a later subscriber", () => {
  requestSshDisconnect("before-registration");
  const receive = vi.fn();
  const release = subscribeSshDisconnectRequests(receive);
  try { expect(receive).not.toHaveBeenCalled(); } finally { release(); }
});

it("revalidates exact subscribers during reentrant retirement and registration", () => {
  const retired = vi.fn();
  const replacement = vi.fn();
  let releaseReplacement = () => {};
  const releaseFirst = subscribeSshDisconnectRequests(() => {
    releaseRetired();
    releaseReplacement = subscribeSshDisconnectRequests(replacement);
  });
  const releaseRetired = subscribeSshDisconnectRequests(retired);
  try {
    requestSshDisconnect("original");
    expect(retired).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
  } finally { releaseFirst(); releaseRetired(); releaseReplacement(); }
});

it("bounds subscriptions and releases only the original receipt", () => {
  const receive = vi.fn();
  const releases = Array.from({ length: 256 }, () => subscribeSshDisconnectRequests(receive));
  let releaseReplacement = () => {};
  try {
    expect(() => subscribeSshDisconnectRequests(receive)).toThrow("Too many SSH disconnect subscribers.");
    releases[0]();
    releaseReplacement = subscribeSshDisconnectRequests(receive);
    releases[0]();
    expect(() => subscribeSshDisconnectRequests(receive)).toThrow();
    requestSshDisconnect("profile");
    expect(receive).toHaveBeenCalledTimes(256);
  } finally {
    releases.forEach((release) => { release(); });
    releaseReplacement();
  }
});
