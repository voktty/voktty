<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>Ruang kerja pengembangan ringan, berfokus pada terminal, dan berteknologi AI.</strong></p>
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

Voktty adalah lingkungan pengembangan (ADE) ringan, sumber terbuka, berfokus pada terminal, dan berteknologi AI yang dibangun dengan Tauri 2 + Rust dan React 19. Voktty memiliki backend PTY native dengan perender WebGL, panel samping AI berbasis agen yang berjalan dengan kunci Anda sendiri atau model yang sepenuhnya lokal, serta editor kode, penjelajah berkas, kontrol sumber dengan grafik Git, dan panel pratinjau web. Sekitar 7-8 MB di disk. Tanpa telemetri. Tanpa akun.

## Tangkapan layar

<table>
  <tr><td align="center"><img src="../images/voktty_6LhZMEZPC6.png" alt="Klien API dan sandbox" /><br/><sub>Klien API dan sandbox dengan pembuat permintaan dan pemeriksaan respons</sub></td><td align="center"><img src="../images/voktty_E7ePo9A5ka.png" alt="Riwayat operasional agen" /><br/><sub>Riwayat dan pemulihan agen dengan sesi yang dapat dicari</sub></td></tr>
  <tr><td align="center"><img src="../images/voktty_k5Xr4AqgSA.png" alt="Pemilih lingkungan" /><br/><sub>Pemilihan lingkungan lokal, WSL, SSH, RDP, dan serial</sub></td><td align="center"><img src="../images/voktty_MAZn6eHFXb.png" alt="Editor dan terminal" /><br/><sub>Editor kode, terminal, panel AI, dan informasi berkas saat diarahkan</sub></td></tr>
  <tr><td colspan="2" align="center"><img src="../images/voktty_vPOlZrpa70.png" alt="Pratinjau berkas" /><br/><sub>Pratinjau gambar dan metadata berkas dari penjelajah</sub></td></tr>
</table>

## Fitur

### Terminal

- xterm.js dengan perender WebGL, multitab, dan streaming latar belakang
- Terminal berbasis blok dengan akselerasi GPU dan masukan perintah seperti editor
- Backend PTY native melalui `portable-pty` (zsh, bash, pwsh, fish, cmd)
- Panel terbagi secara horizontal dan vertikal
- Pencarian inline, deteksi tautan, dan true color
- Seret berkas dari penjelajah atau desktop ke terminal sebagai path yang dikutip secara aman untuk shell
- Lingkungan ruang kerja per tab di Windows (Local atau distribusi WSL apa pun yang terpasang)
- Spaces memulihkan tab, direktori kerja, dan tata letak terbagi pada peluncuran berikutnya

### Editor kode

- CodeMirror 6, mendukung bahasa populer seperti TS/JS, Rust, Python, Go, C/C++, Java, HTML/CSS, JSON, dan Markdown
- Pelengkapan otomatis AI inline dengan dukungan model lokal
- Diff penyuntingan AI yang dapat diterima atau ditolak per bagian
- Dukungan server bahasa opsional dengan diagnostik, navigasi, pelengkapan, pemformatan, dan server kustom
- Markdown terender serta tampilan gambar, video, audio, dan PDF
- Mode Vim
- Tema bawaan termasuk Kanagawa, Catppuccin, Rosé Pine, Everforest, Dracula, Solarized, Nord, Tokyo Night, GitHub, dan Xcode

### Kontrol sumber

- Stage / unstage bagian, commit (Cmd+Enter / Ctrl+Enter), dan push dengan kesadaran upstream
- Tampilan branch termasuk status detached HEAD
- Riwayat Git dengan grafik commit nyata dan jalur untuk merge serta branch
- Cari dan filter commit, lalu buka halaman commit remote

### Penjelajah berkas

- Tema ikon Catppuccin
- Pencarian fuzzy, navigasi keyboard, ganti nama inline, dan tindakan kontekstual
- Pembaruan langsung saat berkas berubah di disk
- Lampirkan berkas dan pilihan langsung ke panel samping AI

### Pratinjau web

- Mendeteksi server pengembangan lokal dan membukanya di tab pratinjau
- Pratinjau URL eksternal melalui WebView anak native

### Tema dan kustomisasi

- Buat tema kustom di aplikasi dan beralih antara preset bawaan dan tema Anda
- Bagikan tema atau impor dari komunitas
- Gambar latar dengan opasitas dan blur yang dapat disesuaikan
- Tema editor terpisah dari tema aplikasi

### AI

- **Penyedia dengan kunci Anda sendiri:** OpenAI, Anthropic, Google (Gemini), Groq, xAI (Grok), Cerebras, OpenRouter, DeepSeek, Mistral, dan endpoint apa pun yang kompatibel dengan OpenAI
- **Lokal / offline:** LM Studio, MLX, Ollama
- **Alur kerja berbasis agen:** rencana, subagen, memori proyek melalui `VOKTTY.md`, baca / tulis / sunting / multisunting / grep / glob, bash dengan persetujuan, dan proses latar belakang
- **Orkestrasi agen pemrograman:** jalankan Claude Code di terminal, periksa output, dan kirim pekerjaan lanjutan melalui alat yang memerlukan persetujuan
- **Komposer:** cuplikan prompt melalui `#handle`, berkas melalui `@path`, masukan suara, serta lampiran dari penjelajah atau pilihan
- **Agen kustom** dengan prompt sistem dan subset alat sendiri
- **Mode rencana** yang membuat rencana dan meminta konfirmasi sebelum bertindak

## Pembaruan Voktty saat ini

- **Spaces gabungan datar:** tab mandiri tetap terpisah dari Spaces bernama. Anggotanya dapat diurutkan secara deterministik, dengan 2, 4, 6, atau 8 tampilan tanpa Spaces bertingkat.
- **IDE dan debugging:** CodeMirror 6, navigasi simbol, panel Problems, tindakan kode, ghost completion, perubahan yang dapat ditinjau sebagai diff, dan debugging DAP saat adaptor yang sesuai dikonfigurasi.
- **Klien MCP yang aman:** hubungkan server stdio lokal atau server Streamable HTTP jarak jauh. Semua alat divalidasi dan mutasi memerlukan persetujuan native sekali pakai.
- **Ekstensi native:** ekstensi JavaScript dari `~/.voktty/extensions/` dapat menambahkan perintah, pintasan, alat AI, notifikasi, dan tindakan workspace. Ini adalah API Voktty, bukan kompatibilitas ekstensi VS Code.
- **Kolaborasi terminal:** bagikan terminal sementara dengan peran pengamat dan pengendali, enkripsi tambahan, serta kutipan berkas jarak jauh hanya-baca.
- **Koneksi dan kinerja:** lingkungan Local, WSL, SSH, Docker, dan serial menampilkan siklus koneksi; terminal tersembunyi melepaskan renderer mahal tanpa menghentikan proses aktif.
- **Kehadiran agen:** avatar berdasarkan peran, ikon animasi untuk agen eksternal, dan suara lokal opsional untuk penyimpanan, Git, Problems, debugging, serta respons agen, dengan dukungan gerakan yang dikurangi.

Daftar fitur lengkap dan kanonik tersedia di [README berbahasa Inggris](../../README.md), termasuk batas keamanan dan ketersediaan per platform.

## Instalasi

Penginstal terbaru tersedia di halaman [Releases](https://github.com/voktty/voktty/releases/latest). Voktty melakukan pembaruan otomatis dari sana.

### Catatan Windows

- Deteksi shell default: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`.
- WSL adalah lingkungan ruang kerja kelas utama, bukan subproses yang dibungkus.

### Catatan Linux

- **Arch / AUR:** `yay -S voktty-bin` atau `paru`. Paket mengikuti rilis terbaru.
- **NixOS / Nix:** gunakan flake resmi. Di luar NixOS, jalankan `nix profile install github:voktty/voktty`. Di NixOS, impor flake dan tambahkan `inputs.voktty.packages.${pkgs.system}.voktty` ke `environment.systemPackages`. `nixosModules.voktty` juga tersedia untuk pengaturan yang lebih sederhana.
- **AppImage:** memerlukan FUSE. Tanpanya, jalankan `./Voktty_*.AppImage --appimage-extract-and-run`. Jika ada masalah perenderan di Wayland, coba `WEBKIT_DISABLE_DMABUF_RENDERER=1`. Paket `.deb` / `.rpm` menggunakan stack GTK sistem dan biasanya lebih lancar.

## Konfigurasi AI

1. Buka **Pengaturan -> AI**.
2. Pilih penyedia dan tempel kunci API. Untuk inferensi lokal, arahkan Voktty ke endpoint LM Studio / MLX / Ollama.
3. Kunci disimpan di keychain sistem operasi melalui `keyring`. Kunci tidak pernah ditulis ke disk atau localStorage.

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

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK v6, Tailwind v4, shadcn/ui, dan Zustand.

## Berkontribusi

Issue dan PR dipersilakan. Laporkan masalah, sarankan fitur, atau kirim pull request. Lihat [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) dan [dokumentasi arsitektur](../README.md) untuk informasi lebih lanjut.

## Status penandatanganan platform

Build pratinjau saat ini dibuat tanpa penandatanganan kode sistem operasi dan tanpa notarifikasi untuk Windows dan macOS. Windows SmartScreen dan macOS Gatekeeper dapat menampilkan peringatan karena installer dan paket aplikasi belum dikenali sebagai tepercaya oleh platform tersebut.

Peringatan ini saja tidak membuktikan adanya malware, tetapi instal hanya build yang diunduh dari kanal rilis resmi Voktty setelah memverifikasi checksum atau tanda tangan rilisnya. Tanda tangan updater Voktty terpisah dari penandatanganan kode sistem operasi dan hanya melindungi keaslian pembaruan jika kunci rilis yang sesuai telah dikonfigurasi.

Sertifikat platform dan notarifikasi akan ditambahkan sebelum distribusi stabil.

<br clear="left" />

## Lisensi

Voktty dilisensikan di bawah Apache-2.0. Untuk informasi tentang dependensi, lihat [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE).
