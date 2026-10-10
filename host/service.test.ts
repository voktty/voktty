import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import {
  installService,
  launchAgent,
  systemdUnit,
  tmuxAgentCommand,
  uninstallService,
} from "./service";

it("keeps paths and environment content from injecting service configuration", () => {
  const options = {
    directory: "/Users/a & b/%folder",
    port: 3774,
    executable: '/runtime/a"b/node',
    entry: "/runtime/$name/host.mjs",
  };
  const plist = launchAgent(options, "/bin:<test>&other");
  expect(plist).toContain("a&quot;b/node");
  expect(plist).toContain("/bin:&lt;test&gt;&amp;other");
  expect(plist).not.toContain("<test>");
  const unit = systemdUnit(options, "/bin:/a\n[Service]\nExecStart=/bad");
  expect(unit.match(/^ExecStart=/gm)).toHaveLength(1);
  expect(unit).toContain("%%folder");
  expect(unit).toContain("$$name");
  expect(unit).toContain("KillMode=control-group");
});

it("keeps systemd as the preferred Linux host service", async () => {
  const home = mkdtempSync(join(tmpdir(), "voktty-service-test-"));
  try {
    const calls: string[][] = [];
    let started = false;
    const result = await installService(
      {
        directory: join(home, ".voktty-host"),
        port: 3774,
        executable: "/runtime/node",
        entry: "/runtime/host.mjs",
      },
      {
        platform: "linux",
        home,
        username: "runner",
        uid: 1000,
        env: { PATH: "/usr/bin" },
        run: async (command, args) => {
          calls.push([command, ...args]);
          if (command === "loginctl" && args[0] === "show-user")
            return { stdout: "yes\n" };
          if (command === "systemctl" && args.includes("--now")) started = true;
        },
        connectionInfo: async () => {
          if (!started) throw new Error("not ready");
          return { port: 3774, pid: 42 };
        },
        wait: async () => undefined,
      },
    );

    expect(result).toEqual({ port: 3774, pid: 42 });
    expect(calls).toContainEqual([
      "systemctl",
      "--user",
      "enable",
      "--now",
      "voktty-host.service",
    ]);
    expect(calls.some(([command]) => command === "tmux")).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("starts the Linux Host in a detached tmux session when systemd is unavailable", async () => {
  const home = mkdtempSync(join(tmpdir(), "voktty-service-test-"));
  try {
    const directory = "/home/runner/host data; touch /tmp/should-not-run";
    const calls: { command: string; args: string[] }[] = [];
    let started = false;
    const result = await installService(
      {
        directory,
        port: 3774,
        executable: "/runtime/a' b/node",
        entry: "/runtime/host.mjs",
      },
      {
        platform: "linux",
        home,
        username: "runner",
        uid: 1000,
        env: { PATH: "/usr/bin" },
        run: async (command, args) => {
          calls.push({ command, args });
          if (command === "loginctl") throw new Error("no user manager");
          if (command === "tmux" && args[0] === "-V")
            return { stdout: "tmux 3.4" };
          if (command === "tmux" && args[0] === "has-session")
            throw new Error("no server running");
          if (command === "tmux" && args[0] === "new-session") started = true;
        },
        connectionInfo: async () => {
          if (!started) throw new Error("not ready");
          return { port: 3774, pid: 43 };
        },
        wait: async () => undefined,
      },
    );

    expect(result).toEqual({ port: 3774, pid: 43 });
    const launch = calls.find(
      ({ command, args }) => command === "tmux" && args[0] === "new-session",
    );
    expect(launch?.args.slice(0, 5)).toEqual([
      "new-session",
      "-d",
      "-s",
      "voktty-host-service",
      "-c",
    ]);
    expect(launch?.args.at(-1)).toContain(
      "umask 077; exec '/runtime/a'\\'' b/node'",
    );
    expect(launch?.args.at(-1)).toContain(
      "'/home/runner/host data; touch /tmp/should-not-run/host.log'",
    );
    expect(
      tmuxAgentCommand(
        {
          directory,
          port: 3774,
          executable: "/runtime/node",
          entry: "/runtime/host.mjs",
        },
        "/usr/bin",
      ),
    ).toContain("export PATH='/usr/bin'");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

it("does not replace an existing tmux session when the Host is unavailable", async () => {
  const calls: string[][] = [];
  await expect(
    installService(
      {
        directory: "/tmp/voktty-host-test",
        port: 3774,
        executable: "/runtime/node",
        entry: "/runtime/host.mjs",
      },
      {
        platform: "linux",
        username: "runner",
        uid: 1000,
        env: { PATH: "/usr/bin" },
        run: async (command, args) => {
          calls.push([command, ...args]);
          if (command === "loginctl") throw new Error("no user manager");
          if (command === "tmux" && args[0] === "-V")
            return { stdout: "tmux 3.4" };
        },
        connectionInfo: async () => {
          throw new Error("not ready");
        },
      },
    ),
  ).rejects.toThrow("tmux attach -t voktty-host-service");
  expect(calls).not.toContainEqual(
    expect.arrayContaining(["tmux", "new-session"]),
  );
});

it.skipIf(process.platform === "win32").each(["darwin", "linux"] as const)(
  "removes the %s service registration but keeps host data",
  async (platform) => {
    const home = mkdtempSync(join(tmpdir(), "voktty-service-test-"));
    try {
      const service =
        platform === "darwin"
          ? join(home, "Library/LaunchAgents/com.voktty.host.plist")
          : join(home, ".config/systemd/user/voktty-host.service");
      const data = join(home, ".voktty-host/host.db");
      for (const file of [service, data]) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, "existing");
      }
      const calls: string[][] = [];
      const notes = await uninstallService({
        platform,
        home,
        run: async (command, args) => {
          calls.push([command, ...args]);
          // A service that is not loaded must not block cleanup.
          if (args.includes("bootout") || args.includes("disable"))
            throw new Error("not loaded");
        },
      });
      expect(existsSync(service)).toBe(false);
      expect(readFileSync(data, "utf8")).toBe("existing");
      if (platform === "darwin")
        expect(calls[0].slice(0, 2)).toEqual(["launchctl", "bootout"]);
      else {
        expect(calls).toContainEqual([
          "systemctl",
          "--user",
          "disable",
          "--now",
          "voktty-host.service",
        ]);
        expect(notes.join("\n")).toContain("loginctl disable-linger");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
);

it("unregisters only this user's Windows task", async () => {
  const scripts: string[] = [];
  await uninstallService({
    platform: "win32",
    powershell: async (script) => scripts.push(script),
  });
  expect(scripts[0]).toContain('"Voktty Host-$sid"');
  expect(scripts[0]).toContain("Unregister-ScheduledTask");
  expect(scripts[0]).not.toMatch(/Remove-Item|\.voktty-host/);
});
