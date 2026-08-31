import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

export function findNdk() {
  const possibleRoots = [
    process.env.NDK_HOME,
    process.env.ANDROID_NDK_HOME,
    process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "ndk") : null,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "Android", "Sdk", "ndk")
      : null,
    "C:\\Android\\Sdk\\ndk",
    "C:\\Users\\" + (process.env.USERNAME || "") + "\\AppData\\Local\\Android\\Sdk\\ndk",
  ].filter(Boolean);

  for (const root of possibleRoots) {
    if (existsSync(root)) {
      try {
        const entries = readdirSync(root, { withFileTypes: true });
        // Sort descending to get newest version
        const versions = entries
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

        for (const ver of versions) {
          const ndkPath = join(root, ver);
          const toolchain = join(
            ndkPath,
            "toolchains",
            "llvm",
            "prebuilt",
            "windows-x86_64",
            "bin"
          );
          if (existsSync(toolchain)) {
            return { ndkPath, toolchain };
          }
        }
      } catch {}
      // Check if root itself is the NDK
      const directToolchain = join(
        root,
        "toolchains",
        "llvm",
        "prebuilt",
        "windows-x86_64",
        "bin"
      );
      if (existsSync(directToolchain)) {
        return { ndkPath: root, toolchain: directToolchain };
      }
    }
  }
  return null;
}

export function findJavaHome() {
  const candidates = [];

  // Priority 1: Check existing JAVA_HOME (sanitize by stripping trailing \bin or /bin)
  if (process.env.JAVA_HOME) {
    let raw = process.env.JAVA_HOME.trim();
    if (raw.endsWith("\\bin") || raw.endsWith("/bin")) {
      raw = raw.slice(0, -4);
    }
    candidates.push(raw);
  }

  // Priority 2: Eclipse Adoptium JDK 17 (most stable for Android Gradle)
  const adoptiumDir = "C:\\Program Files\\Eclipse Adoptium";
  if (existsSync(adoptiumDir)) {
    try {
      const entries = readdirSync(adoptiumDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(adoptiumDir, e.name));
      // Prioritize jdk-17
      entries.sort((a, b) => {
        if (a.includes("17") && !b.includes("17")) return -1;
        if (!a.includes("17") && b.includes("17")) return 1;
        return b.localeCompare(a);
      });
      candidates.push(...entries);
    } catch {}
  }

  // Priority 3: Android Studio bundled JBR
  candidates.push("C:\\Program Files\\Android\\Android Studio\\jbr");
  candidates.push("C:\\Program Files\\Android\\Android Studio\\jre");

  // Priority 4: Microsoft JDK / Oracle Java
  const msJdkDir = "C:\\Program Files\\Microsoft\\jdk";
  if (existsSync(msJdkDir)) {
    try {
      const entries = readdirSync(msJdkDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(msJdkDir, e.name));
      candidates.push(...entries);
    } catch {}
  }

  const javaDir = "C:\\Program Files\\Java";
  if (existsSync(javaDir)) {
    try {
      const entries = readdirSync(javaDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(javaDir, e.name));
      candidates.push(...entries);
    } catch {}
  }

  for (const dir of candidates) {
    if (existsSync(dir)) {
      const javaExe = join(dir, "bin", "java.exe");
      if (existsSync(javaExe)) {
        return {
          javaHome: dir,
          javaBin: join(dir, "bin"),
        };
      }
    }
  }

  return null;
}

const ndk = findNdk();
if (ndk) {
  console.log(`NDK_PATH=${ndk.ndkPath}`);
  console.log(`NDK_BIN=${ndk.toolchain}`);
} else {
  console.log("NDK_NOT_FOUND");
}

const java = findJavaHome();
if (java) {
  console.log(`JAVA_HOME=${java.javaHome}`);
  console.log(`JAVA_BIN=${java.javaBin}`);
} else {
  console.log("JAVA_NOT_FOUND");
}
