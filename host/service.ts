import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  runPowerShell,
  windowsTaskScript,
  windowsUninstallScript,
} from "./windows";

const exec = promisify(execFile);
const LABEL = "com.voktty.host";
type ServiceOptions = {
  directory: string;
  port: number;
  executable: string;
  entry: string;
};

export async function connectionInfo(
  directory: string,
): Promise<{ port: number; pid: number }> {
  const state = JSON.parse(
    await readFile(join(directory, "running.json"), "utf8"),
  );
  if (
    !Number.isInteger(state.port) ||
    state.port < 1 ||
    state.port > 65535 ||
    typeof state.secret !== "string" ||
    !/^[\w-]{43}$/.test(state.secret)
  ) {
    throw new Error("Invalid host state");
  }
  const response = await fetch(`http://127.0.0.1:${state.port}/lifecycle`, {
    method: "POST",
    headers: { Authorization: `Bearer ${state.secret}` },
    body: JSON.stringify({ action: "status" }),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error("Host is not ready");
  return { port: state.port, pid: state.pid };
}

const xml = (value: string) =>
  value.replace(
    /[<>&"']/g,
    (char) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[char]!,
  );

export function launchAgent(options: ServiceOptions, path: string): string {
  const args = [
    options.executable,
    options.entry,
    "serve",
    "--data-dir",
    options.directory,
    "--port",
    String(options.port),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LABEL}</string>
<key>ProgramArguments</key><array>${args.map((arg) => `<string>${xml(arg)}</string>`).join("")}</array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>ThrottleInterval</key><integer>10</integer>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict>
<key>StandardOutPath</key><string>${xml(join(options.directory, "host.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(options.directory, "host.log"))}</string>
</dict></plist>\n`;
}

// systemd expands % specifiers in both settings; $ variables only in ExecStart.
const unitQuote = (value: string) =>
  `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("%", "%%").replaceAll("\n", "\\n")}"`;
export function systemdUnit(options: ServiceOptions, path: string): string {
  return `[Unit]
Description=Voktty Host
After=network.target

[Service]
ExecStart=${[options.executable, options.entry, "serve", "--data-dir", options.directory, "--port", String(options.port)].map((value) => unitQuote(value.replaceAll("$", () => "$$"))).join(" ")}
Environment=${unitQuote(`PATH=${path}`)}
Restart=on-failure
RestartSec=5
UMask=0077
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=default.target
`;
}

// SSH sessions may lack the user bus variables systemctl --user needs.
const systemdEnvironment = (
  uid: number,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv => {
  const runtime = base.XDG_RUNTIME_DIR ?? `/run/user/${uid}`;
  return {
    ...base,
    XDG_RUNTIME_DIR: runtime,
    DBUS_SESSION_BUS_ADDRESS:
      base.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${runtime}/bus`,
  };
};

type RunResult = { stdout?: string } | undefined;
type Run = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<RunResult>;

const TMUX_SESSION = "voktty-host-service";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function tmuxAgentCommand(
  options: ServiceOptions,
  path: string,
): string {
  const args = [
    options.executable,
    options.entry,
    "serve",
    "--data-dir",
    options.directory,
    "--port",
    String(options.port),
  ];
  return `export PATH=${shellQuote(path)}; umask 077; exec ${args.map(shellQuote).join(" ")} >> ${shellQuote(join(options.directory, "host.log"))} 2>&1`;
}

async function startLinuxAgent(
  options: ServiceOptions,
  path: string,
  home: string,
  username: string,
  uid: number,
  baseEnv: NodeJS.ProcessEnv,
  run: Run,
): Promise<"systemd" | "tmux"> {
  const env = systemdEnvironment(uid, baseEnv);
  try {
    await run(
      "loginctl",
      ["enable-linger", username, "--no-ask-password"],
      env,
    );
    const linger = await run(
      "loginctl",
      ["show-user", username, "--property=Linger", "--value"],
      env,
    );
    if (linger?.stdout?.trim() !== "yes") throw new Error("linger disabled");

    const folder = join(home, ".config/systemd/user");
    await mkdir(folder, { recursive: true });
    const file = join(folder, "voktty-host.service");
    try {
      await readFile(file);
    } catch {
      await writeFile(file, systemdUnit(options, path), { mode: 0o600 });
    }
    await run("systemctl", ["--user", "daemon-reload"], env);
    await run(
      "systemctl",
      ["--user", "enable", "--now", "voktty-host.service"],
      env,
    );
    return "systemd";
  } catch {
    try {
      await run("tmux", ["-V"], baseEnv);
    } catch {
      throw new Error(
        `This Linux host cannot start Voktty Host through systemd. Enable systemd user services and lingering, or install tmux for container hosts. An administrator can enable lingering with: sudo loginctl enable-linger ${username}`,
      );
    }

    let sessionExists = false;
    try {
      await run("tmux", ["has-session", "-t", `=${TMUX_SESSION}`], baseEnv);
      sessionExists = true;
    } catch {
      /* No Voktty Host session is registered yet. */
    }
    if (sessionExists) {
      throw new Error(
        `The tmux session ${TMUX_SESSION} already exists but Voktty Host is not responding. Inspect it with: tmux attach -t ${TMUX_SESSION}`,
      );
    }

    try {
      await run(
        "tmux",
        [
          "new-session",
          "-d",
          "-s",
          TMUX_SESSION,
          "-c",
          home,
          tmuxAgentCommand(options, path),
        ],
        baseEnv,
      );
    } catch {
      throw new Error(
        `Voktty Host could not start in tmux. Install tmux and make sure the SSH user can create sessions; inspect ${join(options.directory, "host.log")} for startup errors.`,
      );
    }
    return "tmux";
  }
}

/**
 * Removes the login service or scheduled task so the host no longer starts
 * automatically, stopping it where the service manager owns the process.
 * Never deletes the data directory: sessions, logs and device credentials stay
 * until the user removes them explicitly. Returns follow-up notes.
 */
export async function uninstallService(
  system: {
    platform?: NodeJS.Platform;
    home?: string;
    run?: Run;
    powershell?: (script: string) => Promise<unknown>;
  } = {},
): Promise<string[]> {
  const platform = system.platform ?? process.platform;
  const home = system.home ?? homedir();
  const run: Run =
    system.run ??
    ((command, args, env = process.env) =>
      exec(command, args, { env, timeout: 30_000, maxBuffer: 128 * 1024 }));
  const ignore = () => undefined;
  if (platform === "darwin") {
    await run("launchctl", [
      "bootout",
      `gui/${process.getuid!()}/${LABEL}`,
    ]).catch(ignore);
    await rm(join(home, "Library/LaunchAgents", `${LABEL}.plist`), {
      force: true,
    });
    return [];
  }
  if (platform === "linux") {
    const user = userInfo();
    const env = systemdEnvironment(user.uid);
    await run(
      "systemctl",
      ["--user", "disable", "--now", "voktty-host.service"],
      env,
    ).catch(ignore);
    await rm(join(home, ".config/systemd/user/voktty-host.service"), {
      force: true,
    });
    await run("systemctl", ["--user", "daemon-reload"], env).catch(ignore);
    return [
      `Lingering is still enabled for ${user.username}; other user services may rely on it. To turn it off: loginctl disable-linger ${user.username}`,
    ];
  }
  if (platform === "win32") {
    await (system.powershell ?? runPowerShell)(windowsUninstallScript());
    return [];
  }
  throw new Error("Voktty Host supports Windows, Linux and macOS");
}

export async function installService(
  options: ServiceOptions,
  system: {
    platform?: NodeJS.Platform;
    home?: string;
    username?: string;
    uid?: number;
    env?: NodeJS.ProcessEnv;
    run?: Run;
    connectionInfo?: typeof connectionInfo;
    wait?: (ms: number) => Promise<void>;
  } = {},
): Promise<{ port: number; pid: number }> {
  const platform = system.platform ?? process.platform;
  const home = system.home ?? homedir();
  const env = system.env ?? process.env;
  const getConnectionInfo = system.connectionInfo ?? connectionInfo;
  const wait =
    system.wait ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  // Never replace a running host: connecting must not interrupt agent turns.
  try {
    return await getConnectionInfo(options.directory);
  } catch {
    /* install/start */
  }
  const path = [
    ...new Set([
      env.PATH ?? "",
      join(home, ".local/bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ]),
  ].join(":");
  const run: Run =
    system.run ??
    ((command, args, commandEnv = env) =>
      exec(command, args, {
        env: commandEnv,
        timeout: 15_000,
        maxBuffer: 128 * 1024,
      }));
  let linuxStartMode: "systemd" | "tmux" | undefined;
  if (platform === "darwin") {
    const domain = `gui/${process.getuid!()}`;
    try {
      await run("launchctl", ["print", domain]);
    } catch {
      throw new Error(
        "Sign in at the Mac's desktop once, then reconnect. Voktty Host runs as a login service; keep the Mac signed in and awake.",
      );
    }
    const folder = join(home, "Library/LaunchAgents");
    const file = join(folder, `${LABEL}.plist`);
    await mkdir(folder, { recursive: true });
    let loaded = false;
    try {
      await run("launchctl", ["print", `${domain}/${LABEL}`]);
      loaded = true;
    } catch {
      /* first install */
    }
    if (loaded) {
      // A loaded service already has an owner and executable. Start it without
      // rewriting its configuration or sending a kill/restart command.
      await run("launchctl", ["kickstart", `${domain}/${LABEL}`]);
    } else {
      await writeFile(file, launchAgent(options, path), { mode: 0o600 });
      await run("launchctl", ["bootstrap", domain, file]);
    }
  } else if (platform === "linux") {
    const currentUser = userInfo();
    linuxStartMode = await startLinuxAgent(
      options,
      path,
      home,
      system.username ?? currentUser.username,
      system.uid ?? currentUser.uid,
      env,
      run,
    );
  } else if (platform === "win32") {
    await runPowerShell(windowsTaskScript(options, env.PATH ?? ""));
  } else {
    throw new Error("Voktty Host supports Windows, Linux and macOS");
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return await getConnectionInfo(options.directory);
    } catch {
      /* starting */
    }
    await wait(200);
  }
  throw new Error(
    platform === "win32"
      ? `The host task did not start. Sign in to the Windows desktop as the SSH user and keep that account signed in (locking is fine), then reconnect. Check Task Scheduler and ${join(options.directory, "host.log")}.`
      : linuxStartMode === "tmux"
        ? `The host process did not become ready in tmux. Check ${join(options.directory, "host.log")} and inspect the session with: tmux attach -t ${TMUX_SESSION}`
        : `The host service was installed but did not start. Check ${join(options.directory, "host.log")}.`,
  );
}
