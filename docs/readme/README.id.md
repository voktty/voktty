<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>Ruang kerja tempat agen pemrograman Anda bekerja.</strong></p>
  <p><a href="https://voktty.dev">Situs web</a> · <a href="https://voktty.dev/docs">Dokumentasi</a> · <a href="https://github.com/voktty/voktty">Kode sumber situs web</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="versi" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="unduhan" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="platform" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.hi.md">हिन्दी</a>
</p>

---

Voktty adalah ruang kerja desktop sumber terbuka untuk agen pemrograman AI, dibangun dengan Tauri 2, Rust, dan React 19. Agent Harness-nya menjalankan Claude Code, Codex, Gemini (lewat Antigravity), Cursor, Grok, OpenCode, Pi, dan model apa pun yang dapat Anda akses lewat API, pada proyek lokal maupun SSH, dengan persetujuan, peninjauan perubahan, memori proyek bersama, dan koordinasi tim. Di sekelilingnya ada terminal native, editor kode, Git, serta lingkungan lokal, WSL, SSH, Docker, serial, dan desktop jarak jauh. Tanpa akun, tanpa telemetri. Ukuran installer 25 hingga 36 MB (v1.0.27; AppImage Linux sekitar 118 MB).

## Tangkapan layar

Tangkapan layar memakai antarmuka bahasa Spanyol; lebih banyak lagi ada di [galeri](../screenshots.md).

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: agen mengedit proyek dan perubahannya tampil sebagai diff yang bisa dipertahankan atau dibatalkan" /><br/><sub>Agent Harness: agen mengedit proyek dan perubahannya tampil sebagai diff yang bisa dipertahankan atau dibatalkan</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="Proyek SSH: berkas jarak jauh di samping terminal langsung di server" /><br/><sub>Proyek SSH: berkas jarak jauh di samping terminal langsung di server</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="Obrolan AI mengambang yang membaca direktori, perintah terbaru, dan keluaran terminal aktif" /><br/><sub>Obrolan AI mengambang yang membaca direktori, perintah terbaru, dan keluaran terminal aktif</sub>
</p>

## Yang Anda dapatkan

### Agen

- **Banyak agen, satu tempat.** Sesi Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode, dan Pi berdampingan, masing-masing memakai CLI dan login sendiri.
- **Model API apa pun sebagai agen.** Penyedia cloud, endpoint kustom, dan model lokal Ollama, LM Studio, atau MLX dapat membaca, mencari, mengedit, dan menjalankan perintah di proyek, dengan pemeriksaan ruang kerja dan jalur rahasia yang sama seperti obrolan AI. Loop agen dan kunci Anda tetap berada di komputer Anda.
- **Anda yang menentukan batasnya.** Sesi terawasi bertanya sebelum setiap penulisan atau perintah; akses penuh tidak. Hasil edit tampil sebagai diff yang bisa dipertahankan atau dibatalkan.
- **Agen di server Anda.** Pada proyek SSH, Claude Code, Codex, dan OpenCode berjalan di host dan koneksi yang terputus tidak menghentikannya. Model API membaca, mencari, dan mengedit berkas jarak jauh, serta menjalankan perintah saat helper jarak jauh sudah terbaru.
- **Tim agen.** Daftar anggota dengan peran dan aturan, papan yang menunjukkan siapa yang bekerja atau menunggu, orkestrator yang memulai dan mengirim pesan ke yang lain, dan log tentang apa yang mereka katakan satu sama lain dan kepada Anda. Lihat [panduan tim agen](../guides/agent-teams.md).
- **Memori dan kehadiran.** Periksa dan pulihkan apa yang diingat agen tentang sebuah proyek, dapatkan pemberitahuan saat agen di host terbuka mana pun menunggu Anda, dan pantau agen yang berjalan di Notch opsional (alfa).

### Ruang kerja di sekelilingnya

- **Terminal.** PTY native dengan rendering WebGL, mode raw dan blok, panel, ruang, dan terminal privat.
- **Editor.** CodeMirror 6 dengan LSP opsional, pelengkapan dan pengeditan AI, Quick Open, serta pencarian dan penggantian dengan pratinjau.
- **Git.** Kontrol sumber, riwayat dengan grafik commit, worktree, dan commit berbantuan AI.
- **Lingkungan.** Lokal, WSL, SSH, Docker, serial, dan RDP, dengan koneksi tersimpan, tunnel, dan dasbor server.
- **Pratinjau dan alat.** Pratinjau server pengembangan lokal (juga lewat SSH), penampil media dan PDF, klien API, dan klien MCP.
- **Pendamping di ponsel.** Aplikasi Android versi pratinjau yang dipasangkan lewat kode QR untuk memantau dan mengarahkan sesi AI melalui jaringan lokal Anda.

### Privat secara bawaan

Tanpa akun dan tanpa telemetri Voktty. Kunci penyedia disimpan di keychain sistem operasi, akses sistem berkas native diotorisasi per ruang kerja, alat berkas AI menolak jalur rahasia, dan setiap pemanggilan alat yang mengubah sesuatu bertanya dulu kecuali Anda memberi akses penuh.

Daftar fitur lengkap ada di [docs/features.md](../features.md) (dalam bahasa Inggris).

## Instalasi

Penginstal terbaru tersedia di halaman [Releases](https://github.com/voktty/voktty/releases/latest). Voktty melakukan pembaruan otomatis dari sana.

### Catatan Windows

- Deteksi shell default: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL adalah lingkungan ruang kerja kelas utama, bukan subproses yang dibungkus.

### Catatan Linux

- **Arch / AUR:** `yay -S voktty-bin` atau `paru`. Paket mengikuti rilis terbaru.
- **NixOS / Nix:** gunakan flake resmi. Di luar NixOS, jalankan `nix profile install github:voktty/voktty`. Di NixOS, impor flake dan tambahkan `inputs.voktty.packages.${pkgs.system}.voktty` ke `environment.systemPackages`. `nixosModules.voktty` juga tersedia untuk pengaturan yang lebih sederhana.
- **AppImage:** memerlukan FUSE. Tanpanya, jalankan `./Voktty_*.AppImage --appimage-extract-and-run`. Jika ada masalah perenderan di Wayland, coba `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Paket `.deb` / `.rpm` menggunakan stack GTK sistem dan biasanya lebih lancar.

## Menyiapkan agen dan AI

1. **Agen pemrograman.** Pasang CLI agen yang Anda pakai (misalnya Claude Code atau Codex) dan masuk seperti biasa. Voktty menemukannya dan memakai login mereka sendiri. Untuk proyek SSH, pasang di server.
2. **Model API.** Buka pengaturan dan masuk ke **AI Models**, tambahkan penyedia beserta kuncinya atau endpoint kustom, atau arahkan Voktty ke server LM Studio, MLX, atau Ollama lokal. Model-model itu kemudian muncul di pemilih model Harness di bawah **API**.
3. Kunci ditulis ke keychain sistem operasi lewat `keyring` dan tidak pernah ke `localStorage`. Di Linux tanpa session bus atau Secret Service, Voktty memakai berkas cadangan privat dengan mode 0600.

## Build dari sumber

**Prasyarat**

- Rust (stable), https://rustup.rs
- Node 20+ dan [pnpm](https://pnpm.io)
- Prasyarat Tauri untuk platform Anda, https://tauri.app/start/prerequisites/

**Jalankan**

```bash
pnpm install
pnpm tauri dev          # pengembangan
pnpm tauri build        # paket produksi
```

**Pemeriksaan**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # lint Rust seperti CI
cd src-tauri && cargo nextest run --locked                           # atau cargo test --locked
```

## Stack teknologi

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui, dan Zustand.

## Berkontribusi

Issue dan PR dipersilakan. Laporkan masalah, sarankan fitur, atau kirim pull request. Lihat [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) dan [dokumentasi arsitektur](../README.md) untuk informasi lebih lanjut. Arah proyek ada di [peta jalan](../../ROADMAP.md).

## Status penandatanganan platform

Build pratinjau saat ini dibuat tanpa penandatanganan kode sistem operasi dan tanpa notarifikasi untuk Windows dan macOS. Windows SmartScreen dan macOS Gatekeeper dapat menampilkan peringatan karena installer dan paket aplikasi belum dikenali sebagai tepercaya oleh platform tersebut.

Peringatan ini saja tidak membuktikan adanya malware, tetapi instal hanya build yang diunduh dari kanal rilis resmi Voktty setelah memverifikasi checksum atau tanda tangan rilisnya. Tanda tangan updater Voktty terpisah dari penandatanganan kode sistem operasi dan hanya melindungi keaslian pembaruan jika kunci rilis yang sesuai telah dikonfigurasi.

Sertifikat platform dan notarifikasi akan ditambahkan sebelum distribusi stabil.

<br clear="left" />

## Asal dan atribusi

Voktty adalah fork independen dari Terax (Crynta), dan Agent Harness-nya diturunkan dari MonoCode (MIT, oleh Nick). Tidak ada dari kedua penulis yang berafiliasi dengan atau mendukung Voktty. Lihat [NOTICE](../../NOTICE) dan [LICENSE](../../LICENSE).

## Lisensi

Voktty dilisensikan di bawah Apache-2.0. Untuk informasi tentang dependensi, lihat [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
