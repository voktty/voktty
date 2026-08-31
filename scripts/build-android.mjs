import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { findJavaHome, findNdk } from "./setup-android-env.mjs";

const ARCH_CONFIGS = {
  aarch64: {
    rustTarget: "aarch64-linux-android",
    tauriTarget: "aarch64",
    ndkPrefix: "aarch64-linux-android",
    abi: "arm64-v8a",
    apkSuffix: "arm64",
  },
  x86_64: {
    rustTarget: "x86_64-linux-android",
    tauriTarget: "x86_64",
    ndkPrefix: "x86_64-linux-android",
    abi: "x86_64",
    apkSuffix: "x64",
  },
  armv7: {
    rustTarget: "armv7-linux-androideabi",
    tauriTarget: "armv7",
    ndkPrefix: "armv7a-linux-androideabi",
    abi: "armeabi-v7a",
    apkSuffix: "arm32",
  },
  i686: {
    rustTarget: "i686-linux-android",
    tauriTarget: "i686",
    ndkPrefix: "i686-linux-android",
    abi: "x86",
    apkSuffix: "x86",
  },
};

// Sync local.properties from project root to Android project directory
const rootLocalProps = join(process.cwd(), "local.properties");
const androidDir = join(process.cwd(), "src-tauri", "gen", "android");
const androidLocalProps = join(androidDir, "local.properties");
if (existsSync(rootLocalProps)) {
  console.log(`[+] Sincronizando credenciales desde local.properties...`);
  if (!existsSync(androidDir)) {
    mkdirSync(androidDir, { recursive: true });
  }
  copyFileSync(rootLocalProps, androidLocalProps);

  const content = readFileSync(rootLocalProps, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      process.env[k] = v;
    }
  }
}

const java = findJavaHome();
if (java) {
  console.log(`[+] Java JDK detectado: ${java.javaHome}`);
  process.env.JAVA_HOME = java.javaHome;
  process.env.PATH = `${java.javaBin};${process.env.PATH}`;
} else {
  console.warn(`[AVISO] No se pudo autodetectar JAVA_HOME.`);
}

const ndk = findNdk();
if (!ndk) {
  console.error("ERROR: No se encontro el Android NDK en su sistema.");
  process.exit(1);
}

console.log(`[+] Android NDK detectado: ${ndk.ndkPath}`);
console.log(`[+] Toolchain bin: ${ndk.toolchain}`);

// Add NDK toolchain bin to PATH
process.env.ANDROID_NDK_HOME = ndk.ndkPath;
process.env.NDK_HOME = ndk.ndkPath;
process.env.PATH = `${ndk.toolchain};${process.env.PATH}`;

// Configure Cargo / CC environment variables for all targets
for (const [key, cfg] of Object.entries(ARCH_CONFIGS)) {
  const clangCmd = join(ndk.toolchain, `${cfg.ndkPrefix}28-clang.cmd`);
  const arExe = join(ndk.toolchain, "llvm-ar.exe");
  const rustTargetEnv = cfg.rustTarget.toUpperCase().replaceAll("-", "_");

  process.env[`CC_${cfg.rustTarget}`] = clangCmd;
  process.env[`CC_${cfg.rustTarget.replaceAll("-", "_")}`] = clangCmd;
  process.env[`AR_${cfg.rustTarget}`] = arExe;
  process.env[`AR_${cfg.rustTarget.replaceAll("-", "_")}`] = arExe;
  process.env[`CARGO_TARGET_${rustTargetEnv}_LINKER`] = clangCmd;
  process.env[`CARGO_TARGET_${rustTargetEnv}_AR`] = arExe;
}

const targetArg = process.argv[2] || "aarch64";
const targetsToBuild =
  targetArg === "all"
    ? Object.keys(ARCH_CONFIGS)
    : [ARCH_CONFIGS[targetArg] ? targetArg : "aarch64"];

for (const t of targetsToBuild) {
  const cfg = ARCH_CONFIGS[t];
  console.log(`\n==================================================`);
  console.log(`  Compilando Voktty Android para ${t} (${cfg.abi})`);
  console.log(`==================================================\n`);

  // Ensure Rust target is installed
  console.log(`[+] Verificando target de Rust ${cfg.rustTarget}...`);
  spawnSync("rustup", ["target", "add", cfg.rustTarget], {
    stdio: "inherit",
    shell: true,
  });

  // Compile path-translate.c if needed
  const jniDir = join(
    process.cwd(),
    "src-tauri",
    "gen",
    "android",
    "app",
    "src",
    "main",
    "jniLibs",
    cfg.abi
  );
  if (!existsSync(jniDir)) {
    mkdirSync(jniDir, { recursive: true });
  }

  const soPath = join(jniDir, "libvoktty-path-translate.so");
  const cPath = join(
    process.cwd(),
    "src-tauri",
    "src",
    "modules",
    "path-translate",
    "path-translate.c"
  );
  const clangCmd = join(ndk.toolchain, `${cfg.ndkPrefix}28-clang.cmd`);

  console.log(`[+] Compilando libvoktty-path-translate.so (${cfg.abi})...`);
  const clangRes = spawnSync(
    clangCmd,
    ["-shared", "-fPIC", "-O2", "-o", soPath, cPath],
    { stdio: "inherit", shell: true }
  );
  if (clangRes.status !== 0) {
    console.warn(
      `[AVISO] No se pudo compilar path-translate con clang.cmd, intentando clang genérico...`
    );
    spawnSync(
      join(ndk.toolchain, "clang.exe"),
      ["-target", cfg.rustTarget, "-shared", "-fPIC", "-O2", "-o", soPath, cPath],
      { stdio: "inherit", shell: true }
    );
  }

  console.log(`[+] Ejecutando tauri android build (${cfg.tauriTarget})...`);
  const buildRes = spawnSync(
    "pnpm",
    ["tauri", "android", "build", "--apk", "--target", cfg.tauriTarget],
    {
      stdio: "inherit",
      shell: true,
      env: process.env,
    }
  );

  if (buildRes.status !== 0) {
    console.error(`[ERROR] Fallo el build de Tauri para ${cfg.tauriTarget}`);
    process.exit(1);
  }
}

// Copy APKs to dist-apk
const distApk = join(process.cwd(), "dist-apk");
if (!existsSync(distApk)) {
  mkdirSync(distApk, { recursive: true });
}

function findApks(dir) {
  let apks = [];
  if (!existsSync(dir)) return apks;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      apks = apks.concat(findApks(full));
    } else if (e.name.endsWith(".apk")) {
      apks.push(full);
    }
  }
  return apks;
}

const apkDir = join(
  process.cwd(),
  "src-tauri",
  "gen",
  "android",
  "app",
  "build",
  "outputs",
  "apk"
);
const found = findApks(apkDir);
console.log(`\n[+] Copiando APK(s) a 'dist-apk/'...`);
for (const apk of found) {
  const dest = join(distApk, `voktty-${apk.split(/[\\/]/).pop()}`);
  copyFileSync(apk, dest);
  console.log(`  [OK] ${dest}`);
}

console.log(`\n==================================================`);
console.log(`  COMPILACION COMPLETADA CON EXITO`);
console.log(`  Directorio: ${distApk}`);
console.log(`==================================================\n`);
