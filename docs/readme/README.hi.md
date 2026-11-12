<div align="center">
  <img src="../../voktty-svg.svg" width="144" height="144" alt="Voktty" />
  <h1>Voktty</h1>
  <p><strong>वह कार्यक्षेत्र जहाँ आपके कोडिंग एजेंट काम करते हैं।</strong></p>
  <p><a href="https://voktty.dev">वेबसाइट</a> · <a href="https://voktty.dev/docs">दस्तावेज़</a> · <a href="https://github.com/voktty/voktty">वेबसाइट का सोर्स कोड</a></p>

  <p>
    <img src="https://img.shields.io/github/v/release/voktty/voktty?label=version&color=blue" alt="संस्करण" />
    <img src="https://img.shields.io/github/downloads/voktty/voktty/total?label=downloads&color=blue" alt="डाउनलोड" />
    <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey" alt="प्लेटफ़ॉर्म" />
    <a href="https://discord.gg/z8mzebCzJB"><img src="https://img.shields.io/badge/Discord-5865F2?logo=discord&logoColor=white" alt="Discord" /></a>

  </p>
</div>

<p align="center">
  <a href="../../README.md">English</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.es.md">Español</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.ko.md">한국어</a> | <a href="README.pt-BR.md">Português</a> | <a href="README.pl.md">Polski</a> | <a href="README.ru.md">Русский</a> | <a href="README.id.md">Bahasa Indonesia</a>
</p>

---

Voktty AI कोडिंग एजेंटों के लिए एक ओपन-सोर्स डेस्कटॉप कार्यक्षेत्र है, जो Tauri 2, Rust और React 19 पर बना है। इसका Agent Harness Claude Code, Codex, Gemini (Antigravity के ज़रिए), Cursor, Grok, OpenCode, Pi और API से पहुँचा जा सकने वाला कोई भी मॉडल लोकल और SSH प्रोजेक्ट में चलाता है, जिसके साथ अनुमोदन, बदलावों की समीक्षा, साझा प्रोजेक्ट मेमोरी और टीम समन्वय मिलता है। इसके आसपास नेटिव टर्मिनल, कोड एडिटर, Git और लोकल, WSL, SSH, Docker, सीरियल तथा रिमोट डेस्कटॉप एनवायरनमेंट हैं। कोई खाता नहीं, कोई टेलीमेट्री नहीं। इंस्टॉलर का आकार 25 से 36 MB है (v1.0.27; Linux AppImage लगभग 118 MB)।

## स्क्रीनशॉट

स्क्रीनशॉट में स्पेनिश इंटरफ़ेस है; और स्क्रीनशॉट [गैलरी](../screenshots.md) में हैं।

<p align="center">
  <img src="../images/harness-session-review.png" width="800" alt="Agent Harness: एक एजेंट प्रोजेक्ट को संपादित करता है और उसके बदलाव ऐसे diff के रूप में दिखते हैं जिन्हें रखा या पूर्ववत किया जा सकता है" /><br/><sub>Agent Harness: एक एजेंट प्रोजेक्ट को संपादित करता है और उसके बदलाव ऐसे diff के रूप में दिखते हैं जिन्हें रखा या पूर्ववत किया जा सकता है</sub>
</p>

<p align="center">
  <img src="../images/ssh-project-terminal.png" width="800" alt="SSH प्रोजेक्ट: सर्वर पर लाइव टर्मिनल के बगल में रिमोट फ़ाइलें" /><br/><sub>SSH प्रोजेक्ट: सर्वर पर लाइव टर्मिनल के बगल में रिमोट फ़ाइलें</sub>
</p>

<p align="center">
  <img src="../images/terminal-ai-chat.png" width="800" alt="फ़्लोटिंग AI चैट जो सक्रिय टर्मिनल की डायरेक्टरी, हाल के कमांड और आउटपुट पढ़ता है" /><br/><sub>फ़्लोटिंग AI चैट जो सक्रिय टर्मिनल की डायरेक्टरी, हाल के कमांड और आउटपुट पढ़ता है</sub>
</p>

## आपको क्या मिलता है

### एजेंट

- **कई एजेंट, एक जगह।** Claude Code, Codex, Antigravity (Gemini), Cursor, Grok, OpenCode और Pi के सत्र साथ-साथ चलते हैं, हर एक अपने CLI और अपने लॉगिन के साथ।
- **कोई भी API मॉडल एजेंट के रूप में।** क्लाउड प्रदाता, कस्टम एंडपॉइंट और लोकल Ollama, LM Studio या MLX मॉडल किसी प्रोजेक्ट में पढ़, खोज, संपादित और कमांड चला सकते हैं, AI चैट जैसी ही वर्कस्पेस और गोपनीय-पथ जाँचों के साथ। एजेंट लूप और आपकी कुंजी आपके कंप्यूटर पर ही रहती हैं।
- **वे कितना कर सकते हैं, यह आप तय करते हैं।** निगरानी वाले सत्र हर लेखन या कमांड से पहले पूछते हैं; पूर्ण एक्सेस में नहीं पूछते। संपादन ऐसे diff के रूप में दिखते हैं जिन्हें आप रख या पूर्ववत कर सकते हैं।
- **आपके सर्वरों पर एजेंट।** SSH प्रोजेक्ट में Claude Code, Codex और OpenCode होस्ट पर चलते हैं और कनेक्शन टूटने से रुकते नहीं। API मॉडल रिमोट फ़ाइलें पढ़ते, खोजते और संपादित करते हैं, और रिमोट हेल्पर अद्यतन होने पर कमांड भी चलाते हैं।
- **एजेंटों की टीमें।** भूमिकाओं और नियमों वाली सूची, कौन काम कर रहा है या प्रतीक्षा में है यह दिखाने वाला बोर्ड, बाकी को शुरू करने और संदेश भेजने वाला ऑर्केस्ट्रेटर, और वे आपस में और आपसे क्या कहते हैं उसका लॉग। [एजेंट टीम गाइड](../guides/agent-teams.md) देखें।
- **मेमोरी और उपस्थिति।** किसी प्रोजेक्ट के बारे में एजेंट जो याद रखते हैं उसे देखें और बहाल करें, किसी भी खुले होस्ट पर एजेंट के आपकी प्रतीक्षा करने पर सूचना पाएँ, और वैकल्पिक Notch (अल्फ़ा) में चल रहे एजेंट देखें।

### उनके आसपास का कार्यक्षेत्र

- **टर्मिनल।** WebGL रेंडरिंग वाला नेटिव PTY, raw और ब्लॉक मोड, पैन, स्पेस और निजी टर्मिनल।
- **एडिटर।** CodeMirror 6, वैकल्पिक LSP, AI कंप्लीशन और संपादन, Quick Open, तथा पूर्वावलोकन-पहले खोज और बदलाव।
- **Git।** सोर्स कंट्रोल, कमिट ग्राफ़ वाला इतिहास, worktree और AI-सहायता वाले कमिट।
- **एनवायरनमेंट।** लोकल, WSL, SSH, Docker, सीरियल और RDP, सहेजे गए कनेक्शन, टनल और सर्वर डैशबोर्ड के साथ।
- **पूर्वावलोकन और टूल।** लोकल डेवलपमेंट सर्वर का पूर्वावलोकन (SSH पर भी), मीडिया और PDF व्यूअर, API क्लाइंट और MCP क्लाइंट।
- **फ़ोन साथी।** एक प्रीव्यू Android ऐप जो QR कोड से जुड़ता है और आपके लोकल नेटवर्क पर AI सत्र देखने और चलाने देता है।

### डिफ़ॉल्ट रूप से निजी

कोई खाता नहीं और Voktty की कोई टेलीमेट्री नहीं। प्रदाताओं की कुंजियाँ OS कीचेन में रहती हैं, नेटिव फ़ाइल सिस्टम एक्सेस हर वर्कस्पेस के लिए अधिकृत होता है, AI फ़ाइल टूल गोपनीय पथों को अस्वीकार करते हैं, और बदलाव करने वाला हर टूल कॉल पहले पूछता है, जब तक आप पूर्ण एक्सेस न दें।

सुविधाओं की पूरी सूची [docs/features.md](../features.md) (अंग्रेज़ी) में है।

## इंस्टॉल करें

नवीनतम इंस्टॉलर [Releases](https://github.com/voktty/voktty/releases/latest) पेज पर हैं। Voktty वहीं से अपने आप अपडेट होता है।

### Windows नोट्स

- डिफ़ॉल्ट शेल पहचान: `pwsh.exe` (PowerShell 7+) -> `powershell.exe` (Windows PowerShell 5.1) -> `cmd.exe`।
- WSL एक पूर्ण वर्कस्पेस एनवायरनमेंट है, केवल लिपटा हुआ सबप्रोसेस नहीं।

### Linux नोट्स

- **Arch / AUR:** `yay -S voktty-bin` या `paru`। यह नवीनतम रिलीज़ का अनुसरण करता है।
- **NixOS / Nix:** आधिकारिक flake का उपयोग करें। NixOS के बाहर `nix profile install github:voktty/voktty` चलाएँ। NixOS में flake आयात करें और `inputs.voktty.packages.${pkgs.system}.voktty` को `environment.systemPackages` में जोड़ें। आसान सेटअप के लिए `nixosModules.voktty` भी उपलब्ध है।
- **AppImage:** FUSE आवश्यक है। इसके बिना `./Voktty_*.AppImage --appimage-extract-and-run` चलाएँ। Wayland पर रेंडरिंग समस्या हो तो `WEBKIT_DISABLE_DMABUF_RENDERER=1` आज़माएँ। `.deb` / `.rpm` पैकेज सिस्टम GTK स्टैक से जुड़ते हैं और आम तौर पर अधिक सुचारु चलते हैं।

## एजेंट और AI कॉन्फ़िगर करें

1. **कोडिंग एजेंट।** जिन एजेंट CLI का आप उपयोग करते हैं (जैसे Claude Code या Codex) उन्हें इंस्टॉल करें और हमेशा की तरह साइन इन करें। Voktty उन्हें ढूँढ लेता है और उनके अपने लॉगिन का उपयोग करता है। SSH प्रोजेक्ट के लिए उन्हें सर्वर पर इंस्टॉल करें।
2. **API मॉडल।** सेटिंग्स खोलकर **AI मॉडल्स** पर जाएँ, कुंजी के साथ कोई प्रदाता या कस्टम एंडपॉइंट जोड़ें, या Voktty को लोकल LM Studio, MLX या Ollama सर्वर की ओर इंगित करें। मॉडल फिर Harness के मॉडल चयनकर्ता में **API** के अंतर्गत दिखेंगे।
3. कुंजियाँ `keyring` के ज़रिए OS कीचेन में लिखी जाती हैं, `localStorage` में कभी नहीं। जिन Linux सिस्टम पर सेशन बस या Secret Service नहीं है, वहाँ Voktty मोड 0600 वाली निजी बैकअप फ़ाइल का उपयोग करता है।

## सोर्स से बिल्ड करें

**आवश्यकताएँ**

- Rust (stable), https://rustup.rs
- Node 20+ और [pnpm](https://pnpm.io)
- आपके प्लेटफ़ॉर्म के लिए Tauri आवश्यकताएँ, https://tauri.app/start/prerequisites/

**चलाएँ**

```bash
pnpm install
pnpm tauri dev          # डेवलपमेंट
pnpm tauri build        # प्रोडक्शन बंडल
```

**जाँच**

```bash
pnpm lint
pnpm check-types
pnpm test
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings   # CI के समान Rust lint
cd src-tauri && cargo nextest run --locked                           # या cargo test --locked
```

## टेक स्टैक

Tauri 2, Rust, `portable-pty`, React 19, TypeScript, Vite, xterm.js, CodeMirror 6, Vercel AI SDK, Tailwind v4, shadcn/ui और Zustand।

## योगदान

Issues और PR का स्वागत है। समस्याएँ रिपोर्ट करें, सुविधाएँ सुझाएँ या pull request भेजें। अधिक जानकारी के लिए [CONTRIBUTING.md](https://github.com/voktty/voktty/blob/main/CONTRIBUTING.md) और [आर्किटेक्चर दस्तावेज़](../README.md) देखें। प्रोजेक्ट की दिशा [रोडमैप](../../ROADMAP.md) में है।

## प्लेटफ़ॉर्म साइनिंग की स्थिति

वर्तमान प्रीव्यू बिल्ड Windows और macOS के लिए ऑपरेटिंग सिस्टम कोड साइनिंग और नोटराइज़ेशन के बिना बनाए जाते हैं। Windows SmartScreen और macOS Gatekeeper चेतावनी दिखा सकते हैं, क्योंकि इंस्टॉलर और ऐप पैकेज अभी इन प्लेटफ़ॉर्म पर विश्वसनीय के रूप में पहचाने नहीं जाते।

ये चेतावनियाँ अपने आप में मैलवेयर का प्रमाण नहीं हैं, लेकिन केवल Voktty के आधिकारिक रिलीज़ चैनलों से डाउनलोड किए गए बिल्ड को checksum या रिलीज़ सिग्नेचर सत्यापित करने के बाद इंस्टॉल करें। Voktty updater सिग्नेचर ऑपरेटिंग सिस्टम कोड साइनिंग से अलग है और संबंधित रिलीज़ कुंजी कॉन्फ़िगर होने पर ही अपडेट की प्रामाणिकता की रक्षा करता है।

स्थिर वितरण से पहले प्लेटफ़ॉर्म प्रमाणपत्र और नोटराइज़ेशन जोड़े जाएंगे।

<br clear="left" />

## मूल और श्रेय

Voktty, Terax (Crynta) का एक स्वतंत्र फ़ॉर्क है, और इसका Agent Harness MonoCode (MIT, लेखक Nick) से व्युत्पन्न है। दोनों में से कोई भी लेखक Voktty से संबद्ध नहीं है और न ही उसका समर्थन करता है। [NOTICE](../../NOTICE) और [LICENSE](../../LICENSE) देखें।

## लाइसेंस

Voktty Apache-2.0 लाइसेंस के अंतर्गत है। निर्भरताओं की जानकारी के लिए [Apache License 2.0](https://github.com/voktty/voktty/blob/main/LICENSE) देखें।
