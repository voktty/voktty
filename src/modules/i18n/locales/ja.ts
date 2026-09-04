import { en, mergeLocale, type TranslationSchema } from "./en";

const jaBase = mergeLocale(en, {
  common: {
    textCopied: "クリップボードにコピーしました",
    textPasted: "テキストを貼り付けました",
    save: "保存",
    saved: "保存済み",
    cancel: "キャンセル",
    delete: "削除",
    edit: "編集",
    close: "閉じる",
    copy: "コピー",
    copied: "コピーしました",
    open: "開く",
    back: "戻る",
    search: "検索",
    loading: "読み込み中...",
    error: "エラー",
    success: "成功",
    discard: "破棄",
    apply: "適用",
    ok: "OK",
    confirm: "確認",
    retry: "再試行",
    select: "選択",
    remove: "削除",
    add: "追加",
    create: "作成",
    refresh: "更新",
    rename: "名前の変更",
    default: "デフォルト",
    auto: "自動",
    custom: "カスタム",
    enable: "有効にする",
    enabled: "有効",
    disabled: "無効",
    required: "必須",
    optional: "任意",
    version: "バージョン",
    browse: "参照",
    reset: "リセット",
    none: "なし",
  },
  dialog: {
    cancel: "キャンセル",
    delete: "削除",
    save: "保存",
    saving: "保存中...",
  },
  windowControls: {
    minimize: "最小化",
    maximize: "最大化",
    restore: "元に戻す",
    close: "閉じる",
  },
  settings: {
    title: "設定",
    search: {
      placeholder: "設定を検索...",
      noResults: "一致する設定がありません",
    },
    tabs: {
    revealInFileManager: "エクスプローラーで表示",
      general: "一般",
      editor: "エディター",
      themes: "テーマ",
      shortcuts: "ショートカット",
      models: "AI モデル",
      agents: "エージェント",
      extensions: "拡張機能",
      ssh: "SSH",
      rdp: "RDP",
      docker: "Docker",
      vault: "保管庫",
      aliases: "エイリアス",
      harness: "Agent Harness",
      about: "情報",
    },
    general: {
      title: "一般",
      description: "モード、ターミナル、および起動設定。",
      appearance: {
        title: "外観",
        system: "システム",
        light: "ライト",
        dark: "ダーク",
        themesHint: "テーマ、背景、カスタマイズについてはこちらを参照:",
        themesTab: "テーマ",
      },
      language: {
        title: "言語",
        description:
          "アプリケーション インターフェースの表示言語を選択します。",
      },
      zoom: {
        title: "ズーム",
        label: "UI ズームレベル",
      },
      tabs: {
        title: "タブ",
        layoutTitle: "タブのレイアウト",
        layoutDesc:
          "タブを上部バーに水平表示するか、右パネルに垂直表示します。",
        layoutHorizontal: "水平 (上部)",
        layoutVertical: "垂直 (右側)",
      },
      explorer: {
        title: "エクスプローラー",
        showHiddenTitle: "隠しファイルを表示",
        showHiddenDesc:
          "ファイルエクスプローラーと検索にドット付きファイルやフォルダー (.env, .gitignore, .config) を含めます。",
        gitDecorationsTitle: "Git デコレーション",
        gitDecorationsDesc:
          "ファイルエクスプローラーで変更されたファイルに色を付け、git で無視されたエントリを薄く表示します。",
      },
      terminal: {
        title: "ターミナル",
        shellTitle: "デフォルトのシェル",
        shellDesc: "新しいターミナルタブを開いたときに起動するシェル。",
        shellAuto: "自動検出 (pwsh > powershell > cmd)",
        fontSizeTitle: "フォントサイズ",
        fontSizeDesc: "ターミナルのテキストサイズ (ピクセル単位)。",
        fontFamilyTitle: "フォントファミリー",
        fontFamilyDesc:
          "カスタム等幅フォントファミリー。未設定時は JetBrains Mono が使用されます。",
        fontFamilyPlaceholder: "自動検出",
        fontFamilyNerdHint:
          'アイコン用の Nerd Font 名 (例: "CaskaydiaCove Nerd Font Mono")。自動検出する場合は空白のままにします。',
        fontWeightTitle: "フォントの太さ",
        fontWeightDesc: "ターミナルフォントグリフの太さ。",
        fontWeightNormal: "標準",
        fontWeightMedium: "中 (Medium)",
        fontWeightSemiBold: "中太 (Semi-Bold)",
        fontWeightBold: "太字 (Bold)",
        cursorStyleTitle: "カーソルスタイル",
        cursorStyleDesc: "ターミナルカーソルの外観スタイル。",
        cursorBar: "バー",
        cursorBlock: "ブロック",
        cursorUnderline: "アンダーライン",
        cursorBlinkTitle: "カーソルの点滅",
        cursorBlinkDesc: "アイドル時にターミナルカーソルを点滅させます。",
        letterSpacingTitle: "文字間隔",
        letterSpacingDesc: "ターミナル文字間の水平間隔 (ピクセル単位)。",
        scrollbackTitle: "スクロールバック",
        scrollbackDesc:
          "ターミナルごとに保持される履歴行数。大きくするとメモリ消費量が増加します (~3 KB / 行)。",
        scrollbackLinesUnit: "行",
        webglTitle: "GPU アクセラレーション (WebGL)",
        webglDesc:
          "WebGL によるハードウェア アクセラレーション レンダリング。無効にすると DOM レンダリングにフォールバックします。",
        confirmCloseTitle: "実行中のプロセスを終了する前に確認",
        confirmCloseDesc:
          "コマンドの実行中にターミナルタブを閉じるか終了する前に確認します。エディターの未保存の変更は常に確認されます。",
        suggestEnabledTitle: "コマンド履歴の候補表示",
        suggestEnabledDesc:
          "ターミナル入力時にコマンド履歴から候補を自動表示します。",
      },
      window: {
        title: "ウィンドウと起動",
        vibrancyTitle: "ウィンドウの背景効果 (Mica / Vibrancy)",
        vibrancyDesc:
          "サポートされている場合、ウィンドウの枠にネイティブの半透明背景効果を適用します。",
        autostartTitle: "ログイン時に起動",
        autostartDesc: "サインイン時に Voktty を自動的に開きます。",
        restoreStateTitle: "ウィンドウの位置とサイズを復元",
        restoreStateDesc:
          "終了時の状態でメインウィンドウを再度開きます。次回の起動時に適用されます。",
        defaultEnvTitle: "デフォルトのワークスペース環境",
        defaultEnvDesc: "新しいワークスペース用のデフォルトのシェル実行環境。",
        spaceViewLimitTitle: "スペースあたりの最大ビュー数",
        spaceViewLimitDesc: "視覚スペースを入れ子なしの適応グリッドに制限します。",
        startupLabel: "起動",
      },
      notifications: {
        title: "通知",
        agentsLabel: "エージェント",
        soundsLabel: "インターフェース音",
        soundEnabledTitle: "インターフェース音",
        soundEnabledDesc:
          "状態の変化や通知に、任意のオフライン音を再生します。",
        soundVolumeTitle: "音量",
        soundVolumeDesc: "Voktty のインターフェース音量を調整します。",
        soundVolumeAria: "インターフェース音量",
        testSoundButton: "音を試す",
        agentNotificationsTitle: "コーディングエージェントの通知",
        agentNotificationsDesc:
          "コーディングエージェントが入力を必要とするか完了したときに通知します。Voktty が非フォーカス時はネイティブ通知、それ以外はアプリ内通知を表示します。",
        soundTitle: "通知音",
        soundDesc: "エージェントの通知やアプリ内アラートで音を再生します。",
        testButton: "2秒後にテスト",
        switchApps: "アプリを切り替え...",
        sending: "送信中...",
        requested: "要求済み",
        blocked: "ブロック済み",
        failed: "失敗",
        switchAppsTitle:
          "ネイティブ通知の受信を確認するには、別のアプリに切り替えてください",
        requestedTitle: "ネイティブ通知が要求されました",
        blockedTitle: "システムによって通知が無効化されています",
        failedTitle: "Voktty はネイティブ通知を要求できませんでした",
        testTitle: "2秒後にネイティブのテスト通知を送信します",
        testSuccess: "通知が正常に送信されました",
        testFailed: "通知の送信に失敗しました",
      },
      backup: {
        title: "バックアップと同期",
        description:
          "ターミナル設定、環境設定、SSH サーバーを JSON としてエクスポートまたはインポートします (保存された秘密鍵やパスワードは除外されます)。",
        exportButton: "設定をエクスポート",
        exportTitle: "設定と SSH サーバーのエクスポート",
        exportDesc:
          "すべての設定、ショートカット、SSH 接続を含むポータブルな JSON ファイルをダウンロードします。",
        importButton: "設定をインポート",
        importTitle: "設定と SSH サーバーのインポート",
        importDesc:
          "JSON バックアップファイルから設定と SSH 接続を復元またはマージします。",
        copyJson: "JSON をコピー",
        copiedJson: "設定をクリップボードにコピーしました",
        exportSuccess: "設定が正常にエクスポートされました",
        importSuccess:
          "設定が正常にインポートされました: {prefs} 個の設定と {ssh} 個の SSH 接続が復元されました",
        importInvalid:
          "無効な設定形式です。有効な Voktty JSON ファイルを選択してください。",
        importError: "設定のインポートに失敗しました: {error}",
        fileHint: "JSON バックアップファイル (*.json) を選択",
      },
    },
    editor: {
      title: "エディター",
      description: "エディターの動作、保存設定、言語サーバー。",
      display: {
        title: "外観",
        fontSizeTitle: "フォントサイズ",
        fontSizeDesc: "コードエディターのテキストサイズ。",
        themeTitle: "エディターのテーマ",
        themeDesc:
          "コードエディターと差分ビューの配色設定。「自動」はアクティブなアプリテーマと一致します。",
        themeAuto: "自動 (アプリのテーマに合わせる)",
        wordWrapTitle: "折り返し",
        wordWrapDesc:
          "エディターのビューポートに合わせて長い行を折り返します。",
        minimapTitle: "ミニマップ",
        minimapDesc: "エディターの右側にコードの概要を表示します。",
        semanticHighlightingTitle: "セマンティック強調表示",
        semanticHighlightingDesc:
          "言語サーバーのトークン種別を使用して構文の色を調整します。",
        inlayHintsTitle: "インレイヒント",
        inlayHintsDesc:
          "言語サーバーが提供する推論型とパラメーター名を表示します。",
        wrapColumnTitle: "折り返し列",
        wrapColumnDesc:
          "指定した列数で折り返します (エディターの幅がそれより狭い場合はより手前で折り返し)。",
        wrapColumnUnit: "列",
        vimModeTitle: "Vim モード",
        vimModeDesc: "コードエディターで Vim のキーバインドを有効にします。",
      },
      formatting: {
        title: "フォーマットと自動保存",
        autoSaveTitle: "自動保存",
        autoSaveDesc:
          "変更されたバッファーを指定時間後に自動的にディスクへ書き込みます。",
        autoSaveDelayTitle: "自動保存の遅延時間",
        autoSaveDelayDesc: "未保存の変更が自動的に保存されるまでの待ち時間。",
        autoSaveDelayUnit: "ms",
        formatOnSaveTitle: "保存時にフォーマット",
        formatOnSaveDesc:
          "ファイル保存時に設定されたフォーマッターを自動的に実行します。",
        defaultFormatterTitle: "デフォルトのフォーマッター",
        defaultFormatterDesc:
          "言語ごとの個別設定がない場合に使用されるフォーマッター。",
        customCommandTitle: "カスタムフォーマットコマンド",
        customCommandDesc:
          "コードをフォーマットするためのシェルテンプレート。ファイルパスのプレースホルダーとして {file} を使用します。",
        languageOverridesTitle: "言語ごとのオーバーライド",
        languageOverridesDesc:
          "特定の言語に別のフォーマッターを使用します (例: Python に Ruff を使用)。",
        addOverride: "オーバーライドを追加",
        removeOverride: "オーバーライドを削除",
      },
      lsp: {
        title: "言語サーバー (LSP)",
        description:
          "コードインテリジェンス、診断、補完のためのオーバーヘッドゼロの言語サーバー統合。",
        customServers: "カスタム言語サーバー",
        addServer: "カスタムサーバーを追加",
        noServers: "カスタム言語サーバーは設定されていません。",
        serverName: "サーバー名",
        serverCommand: "コマンド",
        serverArgs: "引数 (スペース区切り)",
        serverLanguages: "言語 (拡張子)",
        serverRootMarkers: "ルートマーカー (例: package.json, Cargo.toml)",
        installDialogTitle: "{name} 言語サーバーをインストール",
        dialogNotFound:
          "PATH に {command} が見つかりませんでした。インストール後、再確認してこの言語サーバーを有効にしてください。",
        copyInstallCommand: "インストールコマンドをコピー",
        manualInstallHint:
          "このカスタムサーバーを手動でインストールし、コマンドが PATH で利用可能であることを確認してください。",
        stillNotFound:
          "まだ見つかりません。インストールを完了し、コマンドが PATH で利用可能であることを確認してください。",
        detectAgain: "再検出",
        removeServer: "サーバーを削除",
        toggleServerAria: "{name} 言語サーバーを{action}",
        customServerDialogTitle: "カスタム言語サーバー",
        languageServersLabel: "言語サーバー",
        notFoundStatus: "PATH に見つかりません",
        checkingStatus: "確認中...",
        languageIdLabel: "LSP 言語 ID",
        addServerSubmit: "サーバーを追加",
      },
      autocomplete: {
        title: "AI インライン補完",
        description:
          "ローカルまたはクラウドモデルを活用したゴーストテキスト形式のコード補完提案。",
        enabledTitle: "AI 補完を有効にする",
        enabledDesc: "入力中にインラインでコード提案を表示します。",
        triggerTitle: "トリガーモード",
        triggerDesc:
          "入力時の自動トリガー、またはショートカットキーによる手動トリガー。",
        triggerAuto: "自動",
        triggerManual: "手動",
        providerTitle: "補完プロバイダー",
        providerDesc: "インラインコード補完のサービスプロバイダー。",
        modelTitle: "補完モデル",
        modelDesc: "高速なコード生成提案に使用されるモデル。",
      },
    },
    themes: {
      title: "テーマ",
      description:
        "ウィンドウの枠、アクセントカラー、背景画像をカスタマイズします。",
      appThemes: {
        title: "アプリのテーマ",
        description:
          "組み込みテーマを選択するか、カスタムパレットを作成します。",
        presets: "テーマプリセット",
        customThemes: "カスタムテーマ",
        createTheme: "テーマを作成",
        importTheme: "テーマをインポート",
        exportTheme: "テーマをエクスポート",
      },
      background: {
        title: "背景画像",
        description:
          "エディターとターミナルの背面に、不透明度とぼかしを調整可能なカスタム背景画像を設定します。",
        kindNone: "なし",
        kindImage: "カスタム画像",
        selectImage: "画像を選択...",
        opacity: "不透明度",
        blur: "ぼかし",
        dropHint:
          "画像をここにドロップするか選択してください。ローカルに保存され、設定するまでデフォルトの外観には影響しません。",
        backdropMica: "Mica 背景",
        backdropMicaDesc:
          "ヘッダー、ステータスバー、ガターをデスクトップの壁紙とブレンドします (Windows 11 のみ)。",
        backdropVibrancy: "ウィンドウ Vibrancy",
        backdropVibrancyDesc:
          "ウィンドウの背後にある要素の上にヘッダー、ステータスバー、ガターをすりガラス状に重ねます。ペインは不透明のままです。",
      },
    },
    shortcuts: {
      title: "ショートカット",
      description: "キーボードショートカットの確認とカスタマイズ。",
      searchPlaceholder: "アクションまたはキーでショートカットを検索...",
      resetAll: "すべてリセット",
      reset: "ショートカットをリセット",
      clear: "ショートカットをクリア",
      resetDialogTitle: "すべてのショートカットをリセットしますか？",
      resetDialogDescription:
        "これにより、すべてのキーボードショートカットがデフォルトのキーバインドに戻ります。",
      recordShortcut: "ショートカットを記録",
      recording: "設定したいショートカットキーを押してください...",
      pressKeys: "設定したいショートカットキーを押してください...",
      unassigned: "未割り当て",
      noResults: "'{query}' に一致するショートカットは見つかりませんでした",
    },
    models: {
      title: "AI モデル",
      description:
        "AI プロバイダー、モデル、カスタムエージェント、指示を設定します。",
      subTabs: {
        models: "モデル",
        agents: "エージェント",
      },
      aiInactiveBanner:
        "AI は現在無効になっています。以下でモデルを接続して確認し、AI スイッチをオンにしてモデルとエージェントを設定してください。",
      providers: "プロバイダー",
      apiKey: "API キー",
      keySaved: "キーは OS のキーチェーンに安全に保存されています",
      saveKey: "キーを保存",
      deleteKey: "キーを削除",
      baseUrl: "ベース URL",
      modelId: "モデル ID",
      defaultModel: "デフォルトのチャットモデル",
      customEndpoints: "カスタム OpenAI 互換エンドポイント",
      addEndpoint: "エンドポイントを追加",
      enterApiKey: "API キーを入力してください。",
      keyPrefixError: '{label} のキーは "{prefix}" で始まります。',
      failedToSave: "保存に失敗しました: {error}",
      connected: "接続済み",
      getKey: "キーを取得",
      removeProvider: "プロバイダーを削除",
      pasteKey: "API キーを貼り付け",
      hideKey: "キーを隠す",
      showKey: "キーを表示",
      replaceKey: "置換",
      defaults: "デフォルト設定",
      chatModel: "チャットモデル",
      aiActivation: "AI",
      testAi: "モデルをテスト",
      aiHealthReady: "{latency} ミリ秒で確認しました。AI を有効にできます。",
      aiHealthFailed: "モデルの確認に失敗しました。",
      aiHealthVerified: "モデルを確認済みです。AI を有効にできます。",
      aiHealthRequired: "AI を有効にする前にモデルの確認を完了してください。",
      autocomplete: "自動補完",
      trigger: "トリガー",
      triggerAuto: "自動 (入力時)",
      triggerManual: "手動 ({shortcut})",
      notConnected: "未接続",
      providerNotConnectedHint:
        "{provider} は接続されていません — 以下で追加してください。",
      addProvider: "プロバイダーを追加",
      cloud: "クラウド",
      localCustom: "ローカルおよびカスタム",
      noProvidersConnected: "接続されているプロバイダーはまだありません。",
      noProvidersConnectedDesc:
        "「プロバイダーを追加」をクリックして、クラウドまたはローカルのモデルソースを接続してください。",
      docs: "ドキュメント",
      test: "テスト",
      testing: "テスト中…",
      reachable: "到達可能 — サーバーが応答しました。",
      unreachable: "サーバーに到達できませんでした。",
      optionalKeyPlaceholder:
        "任意 — 認証が不要なエンドポイントの場合は空白のままにします",
      tokensUnit: "トークン",
      voiceInput: "音声入力",
      provider: "プロバイダー",
      sttOpenAiDesc:
        "公式の OpenAI API キーと Whisper モデルを使用して文字起こしを行います。",
      sttGroqDesc:
        "公式の Groq API キーと Groq の Whisper エンドポイントを使用して文字起こしを行います。",
      sttWhisperCppDesc:
        "完全オフライン文字起こしのためにローカルの Whisper.cpp サーバーに接続します。",
      sttBrowserDesc:
        "ブラウザ組み込みの音声認識（Web Speech API）を使用します。無料、APIキー不要。品質はOSとWebViewエンジンに依存します。",
      contextLabel: "コンテキストウィンドウ",
    },
    agents: {
      title: "エージェント",
      description:
        "AI が使用するペルソナとスニペット。入力バーからエージェントを切り替えます。",
      customInstructionsTitle: "カスタム指示",
      customInstructionsDesc:
        "ワークフローと好みを反映させるために、すべての AI プロンプトの先頭に追加される指示。",
      customInstructionsPlaceholder:
        "例: TypeScript を優先し、余計な会話を省いて簡潔なコードを記述する...",
      terminalAgentsTitle: "ターミナル コーディング エージェント",
      terminalAgentsDesc:
        "Claude Code、Codex、Gemini CLI などのターミナルエージェントを設定および統合します。",
      enableHooks: "フック統合を有効にする",
      hooksEnabled: "フック統合が有効",
      hooksDescription:
        "Voktty がバックグラウンドの進行状況、コマンドの境界、権限の確認を追跡できるようにします。",
      agentsLabel: "エージェント",
      newAgent: "新規エージェント",
      editAgent: "エージェントを編集",
      useAgent: "エージェントを使用",
      active: "アクティブ",
      builtIn: "組み込み",
      snippets: "スニペット",
      snippetsDesc: "#handle で任意のプロンプトに挿入できる再利用可能な指示。",
      newSnippet: "新規スニペット",
      editSnippet: "スニペットを編集",
      noSnippets:
        "スニペットはまだありません。作成して AI 入力で #handle を使って挿入してください。",
      icon: "アイコン",
      name: "名前",
      namePlaceholderAgent: "例: テストエンジニア",
      namePlaceholderSnippet: "例: マージ前レビューチェックリスト",
      desc: "説明",
      descPlaceholderAgent: "1行 — エージェント選択画面に表示されます",
      descPlaceholderSnippet: "1行 — # 選択画面に表示されます",
      instructions: "指示",
      instructionsPlaceholder:
        "ペルソナとルール。Voktty のコアシステムプロンプトの末尾に追加されます。",
      handle: "ハンドル",
      handlePlaceholder: "review",
      content: "内容",
      contentPlaceholder:
        "#handle を使用したときに <snippet> ブロックとしてプロンプトに挿入されます。",
      newAgentDefaultName: "新規エージェント",
      handleRequired: "必須です。",
      handleFormat: "小文字の英字、数字、ハイフンのみ使用できます。",
      handleInUse: "既に使用されています。",
    },
    about: {
      title: "情報",
      description: "システム情報、アーキテクチャ、アップデート、クレジット。",
      subtitle: "オープンソース AI ネイティブ ターミナル エミュレーター",
      version: "Voktty バージョン",
      architecture: "アーキテクチャ",
      build: "ビルド",
      bundleId: "バンドル ID",
      license: "ライセンス",
      sourceCode: "ソースコード",
      website: "ウェブサイト",
      viewOnGithub: "GitHub で表示",
      reportIssue: "問題を報告",
      updates: "アップデート",
      checkForUpdates: "アップデートを確認",
      checking: "確認中…",
      downloading: "ダウンロード中…",
      upToDate: "最新の状態です",
      checkFailed: "確認に失敗しました — 再試行",
      restartToInstall: "再起動してインストール",
      installVersion: "v{version} をインストール",
      updateToVersion: "v{version} にアップデート",
    },
    docker: {
      title: "Docker / Podman",
      subtitle:
        "ネイティブコンテナエクスプローラー、リアルタイムリソース監視、1クリック端末アクセス。",
      enable: "Docker 統合を有効化",
      enableDesc:
        "下部ステータスバーに Docker ステータスを表示し、コンテナシェルセッションを有効にします。",
      connected: "Docker デーモン稼働中",
      disconnected: "Docker デーモンオフライン",
      testConnection: "接続テスト",
      customHost: "Docker デーモンソケット / ホスト",
      customHostDesc:
        "自動検出の場合は空のままにします（Windows Named Pipe、Unix Socket、または DOCKER_HOST）。",
      defaultShell: "デフォルトコンテナシェル",
      defaultShellDesc:
        "コンテナ内で対話型シェルを開く際に実行されるバイナリ。",
    },
  },
  docker: {
    title: "Docker サービス",
    refresh: "更新",
    searchPlaceholder: "コンテナ、イメージを検索...",
    daemonNotRunning: "Docker デーモンが実行されていないか到達不能です。",
    configureInSettings: "設定で構成",
    noMatchingContainers: "一致するコンテナはありません。",
    noContainers: "コンテナが見つかりません。",
    openTerminal: "コンテナでシェルを開く",
    viewLogs: "ログを表示",
    start: "開始",
    stop: "停止",
    restart: "再起動",
    connecting: "コンテナシェルを開いています ({name})...",
    connected: "{name} のシェルに接続しました",
    connectionFailed: "{name} でシェルを開けませんでした",
    disconnected: "コンテナシェルが切断されました",
    starting: "コンテナ {name} を開始しています...",
    stopping: "コンテナ {name} を停止しています...",
    restarting: "コンテナ {name} を再起動しています...",
    actionSuccess: "コンテナ {name} を更新しました",
    actionFailed: "アクション失敗: {error}",
  },
  header: {
    clearSearch: "検索をクリア",
    searchPlaceholder: "ファイルやコマンドを検索...",
    toggleSidebar: "サイドバーの切り替え",
    expandSidebar: "サイドバーを展開",
    collapseSidebar: "サイドバーを折りたたむ",
    switchToVerticalTabs: "垂直タブに切り替え",
    switchToHorizontalTabs: "水平タブに切り替え",
    commandPalette: "コマンドパレット",
    settings: "設定",
    notifications: "通知",
  },
  tabs: {
    revealInSideBar: "サイドバーで表示",
    revealInFileManager: "エクスプローラーで表示",
    newTab: "新しいタブ",
    closeTab: "タブを閉じる",
    closeOtherTabs: "他のタブを閉じる",
    closeTabsToRight: "右側のタブを閉じる",
    duplicateTab: "ターミナルを複製",
    reconnectSsh: "SSH を再接続",
    renameTab: "名前の変更",
    convertToAgenticTerminal: "エージェント端末に変換",
    convertToNormalTerminal: "標準端末に変換",
    pinTab: "タブをピン留め",
    autoDetectLanguage: "自動検出",
    allLanguages: "↓ すべての言語",
    fewerLanguages: "↑ 表示を減らす",
    modeLanguage: "モード: {name}",
    unsavedChanges: "未保存の変更",
    allOpenTabs: "開いているすべてのタブ",
    openFilesAndTerminals: "開いているタブ",
    searchTabs: "タブを検索...",
    noMatchingTabs: "一致するタブがありません",
    clearSearch: "検索をクリア",
    lockTab: "タブをロック",
    unlockTab: "タブのロックを解除",
    tabIsLocked: "タブはロックされています",
    tabIsLockedWarning:
      "このタブはロックされています。閉じる前にロックを解除してください。",
    cannotCloseAppWithLockedTabs:
      "ロックされたタブ（{count}件）があるためアプリケーションを閉じることができません。先にロックを解除してください。",
    hoverCard: {
      activeTime: "稼働時間",
      resources: "リソース消費",
      directory: "ディレクトリ",
      dimensions: "サイズ",
      buffer: "バッファ行数",
      agentStatus: "AI エージェント",
      agentWorking: "実行・思考中",
      agentWaiting: "入力待ち",
      agentIdle: "準備完了",
      agentFinished: "タスク完了",
      saved: "保存済み",
      unsaved: "未保存の変更",
      language: "言語",
      shell: "シェル",
      environment: "環境",
      connection: "接続",
      tcpConnections: "TCP 接続",
      loadAverage: "ロードアベレージ",
    },
  },
  spaces: {
    title: "スペース",
    newSpace: "新しいスペース",
    renameSpace: "スペースの名前を変更",
    deleteSpace: "スペースを削除",
    noTabs: "タブなし",
    standaloneTabs: "単独のタブ",
    dropToMoveHere: "ドロップしてここに移動",
    spaceName: "スペース名",
    switchSpace: "スペースに切り替え",
    overview: "スペースの概要",
    slot: "スロット {id}",
    slotActions: "スロット {id} の操作",
    rendererCapacity:
      "このビューはターミナルのレンダラー予算を超えます。ペインを減らすか、別のスペースを使用してください。",
    resizeHandle: "分割 {id} のサイズを変更",
  },
  statusbar: {
    terminal: "ターミナル",
    editor: "エディター",
    spaces: "スペース",
    serial: "シリアル",
    uptime: {
      title: "ターミナル稼働状況",
      subtitle: "スクリーンタイムと週間統計",
      activeNow: "現在稼働中",
      today: "今日",
      thisWeek: "今週",
      dailyAvg: "1日平均",
      weeklyChart: "週間アクティビティ",
      topPaths: "よく使うディレクトリ",
      takeBreak: "目を休めたりストレッチするために少し休憩しましょう！",
      noPaths: "記録されたアクティビティはありません",
    },
    stacks: {
      typescript: "TypeScript",
      javascript: "JavaScript",
      python: "Python",
      rust: "Rust",
      go: "Go",
      php: "PHP",
      cCpp: "C/C++",
      ruby: "Ruby",
      zig: "Zig",
      swift: "Swift",
      vue: "Vue",
      svelte: "Svelte",
      docker: "Docker",
      general: "プロジェクト",
    },
    encoding: "UTF-8",
    line: "行",
    col: "列",
    selection: "選択: {count}",
    positionTooltip: "行へ移動",
    selectionTooltip: "{lines} 行、{ranges} 個の選択で {characters} 文字を選択",
    spacesCount: "スペース: {count}",
    lspActive: "LSP: アクティブ",
    lspOff: "LSP: 無効",
    aiIdle: "AI: 待機中",
    aiBusy: "AI: 思考中...",
    privateHidden: "プライベート: AI から非表示",
    privateHiddenTooltip:
      "AI はこのターミナルの出力を参照できません。機密情報、SSH、またはモデルに送信したくない内容に使用してください。",
    cwd: {
      noDirectory: "ディレクトリなし",
      home: "ホーム",
      loading: "読み込み中…",
      noSubfolders: "サブフォルダーなし",
      showHidden: "隠しフォルダーを表示",
    },
  },
  sidebar: {
    explorer: "エクスプローラー",
    sourceControl: "ソース管理",
    gitHistory: "Git 履歴",
    extensions: "拡張機能",
    files: "ファイル",
    git: "Git",
    search: "検索",
    outline: "アウトライン",
    problems: "問題",
  },
  outline: {
    title: "アウトライン",
    document: "ドキュメント",
    workspace: "ワークスペース",
    lsp: "LSP",
    local: "ローカル",
    filterDocument: "シンボルを絞り込み...",
    searchWorkspace: "ワークスペースのシンボルを検索...",
    openEditor: "コードファイルを開いてシンボルを確認します。",
    loading: "シンボルを読み込み中...",
    workspaceUnavailable:
      "ワークスペースシンボルには対応する言語サーバーが必要です。",
    workspaceHint: "シンボル名を入力してワークスペースを検索します。",
    noSymbols: "一致するシンボルがありません。",
  },
  problems: {
    title: "問題",
    filterPlaceholder: "問題を絞り込み...",
    noWorkspace:
      "ローカルプロジェクトを開くと、言語サーバーの診断を収集できます。",
    empty: "一致する問題はありません。",
    errorCount: "エラー {count} 件",
    warningCount: "警告 {count} 件",
    informationCount: "情報 {count} 件",
    hintCount: "ヒント {count} 件",
    location: "{line} 行、{column} 列",
    truncated: "最初の {count} 件の問題を表示しています。",
  },
  explorer: {
    files: "ファイル",
    noFiles: "ワークスペースが開かれていません",
    newFile: "新規ファイル",
    newFolder: "新規フォルダー",
    rename: "名前の変更",
    delete: "削除",
    deleteMultiple: "削除 ({count} 項目)",
    deleteConfirmTitle: "ファイルを削除",
    deleteConfirmDesc:
      "'{name}' を削除してもよろしいですか？この操作は取り消せません。",
    deleteMultipleConfirmDesc:
      "これら {count} 項目を削除してもよろしいですか？この操作は取り消せません。",
    copyPath: "パスをコピー",
    copyPaths: "パスをコピー ({count})",
    copyRelativePath: "相対パスをコピー",
    copyRelativePaths: "相対パスをコピー ({count})",
    downloadMultiple: "({count} 項目) をコンピューターにダウンロード…",
    openInTerminal: "ターミナルで開く",
    openToSide: "横に並べて開く",
    revealInFinder: "Finder で表示",
    revealInExplorer: "ファイル エクスプローラーで表示",
    collapseAll: "すべて折りたたむ",
    refresh: "エクスプローラーを更新",
    refreshActiveTerminal: "アクティブなターミナルのパスで更新",
    parentDirectory: "親ディレクトリへ移動",
    parentDirectoryUnavailable: "親ディレクトリを利用できません",
    remoteWorkspaceBoundary: "リモートワークスペースのルートから移動できません",
    searchPlaceholder: "ファイルを検索…",
    clearSearch: "検索をクリア",
    searching: "検索中…",
    noMatches: "一致するものはありません",
    open: "開く",
    openInSourceControl: "ソース管理で開く",
    openGitHistory: "Git 履歴を開く",
    attachToAgent: "エージェントに添付",
    attachMultiple: "({count} ファイル) をエージェントに添付",
    partialResults:
      "一部の結果のみ表示されています — 検索条件を絞り込んでください。",
    downloadToLocal: "ローカルコンピューターにダウンロード",
    unsavedChanges: "未保存の変更",
  },
  git: {
    authorizeDirectory: "ディレクトリを承認",
    authorizedSuccess: "ディレクトリが正常に承認されました",
    publish: "発行",
    publishBranch: "ブランチを発行",
    publishBranchTooltip: "このブランチをリモートリポジトリに発行します",
    publishing: "発行中…",
    cloneRepo: "リポジトリをクローン",
    cloneModalTitle: "Git リポジトリをクローン",
    cloneModalDesc: "リポジトリの URL を入力し、保存先フォルダを選択してください。",
    repoUrlLabel: "リポジトリ URL",
    parentDirLabel: "保存先フォルダ",
    browseFolder: "参照",
    targetFolderPlaceholder: "my-repo",
    targetFolderLabel: "フォルダ名",
    cloneAction: "クローン",
    cloning: "クローン中…",
    cloneSuccess: "リポジトリを {path} に正常にクローンしました。",
    cloneFailed: "リポジトリのクローンに失敗しました。",
    undoCommit: "コミットを元に戻す",
    undoCommitTooltip: "変更をステージに残したまま直前のローカルコミットを取り消します (git reset --soft HEAD~1)",
    undoingCommit: "元に戻しています…",
    pullCommits: "プル ({count})",
    pullTooltip: "{count} 件のリモートコミットをプル",
    pushCommits: "プッシュ ({count})",
    sourceControl: "ソース管理",
    changes: "変更",
    stagedChanges: "ステージされた変更",
    stageAll: "すべてステージ",
    unstageAll: "すべてのステージを解除",
    stage: "ファイルをステージ",
    unstage: "ファイルのステージを解除",
    discard: "変更を破棄",
    discardConfirm: "'{name}' の変更を破棄しますか？",
    commit: "コミット",
    commitPlaceholder: "コミットメッセージ (Ctrl+Enter でコミット)",
    commitAndPush: "コミットしてプッシュ",
    push: "プッシュ",
    pull: "プル",
    fetch: "フェッチ",
    branch: "ブランチ",
    noChanges: "変更は検出されませんでした",
    noRepoTitle: "Git リポジトリが見つかりません",
    noRepoDesc:
      "現在のフォルダーは Git リポジトリではありません。初期化して変更の追跡、ステージング、ブランチ管理を開始します。",
    initializeRepo: "リポジトリを初期化",
    initRepoSuccess: "Git リポジトリが正常に初期化されました。",
    dubiousOwnershipTitle: "セキュリティのためリポジトリが制限されています",
    dubiousOwnershipDesc:
      "所有者が異なるため、Git は '{path}' へのアクセスに明示的な権限を必要とします。",
    trustRepository: "このリポジトリを信頼する",
    trustRepositorySuccess:
      "リポジトリを safe.directory に正常に追加しました。",
    history: "コミット履歴",
    commitGraph: "コミットグラフ",
    commitDetails: "コミットの詳細",
    diff: "差分",
    waitActionFinish: "現在の Git アクションが完了するまでお待ちください。",
    stageToCommit: "コミットを有効にするには変更をステージしてください。",
    enterCommitMsg:
      "コミットを有効にするにはコミットメッセージを入力してください。",
    commitWithShortcut: "{shortcut} でコミット。",
    pushUnavailable: "現在プッシュは利用できません。",
    waitRepoLoading:
      "選択したリポジトリの読み込みが完了するまでお待ちください。",
    configureBranchToPush:
      "プッシュを有効にするには、ターミナルでこのブランチを設定または公開してください。",
    pullBeforePush:
      "ローカルコミットをプッシュする前にリモートの変更をプルしてください。",
    noCommitsToPush: "{upstream} にプッシュするローカルコミットはありません。",
    pushesTo: "{upstream} にプッシュします。",
    waitAiAction: "現在の AI アクションが完了するまでお待ちください",
    generateCommitMsg: "コミットメッセージを生成",
    generateInEditorLanguage:
      "エディタの言語でコミットメッセージを生成 ({lang})",
    semanticStaging: "セマンティック ステージング",
    semanticStagingTitle: "AI で変更をグループ化してステージ",
    semanticGroupsCount: "グループ",
    applyGroup: "ステージして適用",
    noStagedChanges: "ステージされた変更はありません",
    noUnstagedChanges: "ステージされていない変更はありません",
    diffBinaryFallback: "バイナリ / パッチ表示",
    diffLargeFile: "大きなファイル / パッチ表示",
    diffUnavailable: "このファイルでは差分プレビューを利用できません。",
    markReviewed: "確認済みに設定",
    markUnreviewed: "確認済みを解除",
    reviewed: "確認済み",
    changesSinceReview: "確認後の変更",
    unreviewedDelta: "未確認の差分",
    fullDiff: "全体の差分",
    incrementalReview: "増分レビュー",
    walkthrough: "ウォークスルー",
    generateWalkthrough: "AI で変更を解説",
    generatingWalkthrough: "変更を分析中...",
    coverage: "カバレッジ",
    copyMarkdown: "Markdown をコピー",
    markdownCopied: "ウォークスルーをクリップボードにコピーしました",
    unmentionedFilesCount: "未言及のファイル {count} 件",
    noChangesToExplain: "解説する変更がありません。",
    viewMode: "変更の表示",
    listView: "リスト表示",
    treeView: "ツリー表示",
    collapseFolder: "{name}を折りたたむ",
    expandFolder: "{name}を展開",
    changedFiles: "変更されたファイル",
  },
  activeTabs: {
    title: "アクティブタブ ランチャー",
    placeholder: "すべてのスペースのタブを検索 (名前、パス、スペース)...",
    noTabs: "検索に一致する開いているタブはありません",
    tryAnotherQuery:
      "ファイル名、コマンド、またはスペース名で検索してみてください",
    all: "すべて",
    terminals: "ターミナル",
    terminal: "ターミナル",
    editors: "エディター",
    editor: "ファイル",
    previews: "プレビュー",
    tools: "ツール",
    activeBadge: "アクティブ",
    dirtyBadge: "未保存",
    navigate: "移動",
    switch: "切り替え",
    closeTab: "閉じる",
  },
  projectToolkit: {
    buttonAria: "プロジェクトツールを開く",
    buttonTooltip: "プロジェクトツールと言語サーバー",
    directory: "ディレクトリ",
    currentWorkingDirectory: "現在の作業ディレクトリ",
    editToolsTitle: "JSON ファイルでツールを編集（エディターで開く）",
    searchPlaceholder: "ツール、LSP、AI スキルを検索...",
    aiTab: "AI スキル（{count}）",
    lspTab: "LSP（{count}）",
    setupTab: "セットアップ（{count}）",
    aiSection: "AI スキルとエージェントキット",
    editJson: "JSON を編集",
    setupSection: "初期化とツール",
    lspSection: "言語サーバー（LSP）",
    customServers: "カスタム",
    editTools: "JSON でツールを編集",
    lspSettings: "LSP 設定",
    recommended: "おすすめ",
    copyCommand: "コマンドをコピー",
    runInActiveTerminal: "アクティブなターミナルで実行",
    sent: "送信済み",
    run: "実行",
    detectedAt: "{path} で検出",
    notDetectedPath: "PATH に見つかりません",
    detectedInRepo: "リポジトリで検出",
    colorNames: {
      red: "赤",
      amber: "アンバー",
      emerald: "エメラルド",
      cyan: "シアン",
      blue: "青",
      purple: "紫",
      pink: "ピンク",
    },
    setColor: "ラベルの色を設定: {name}",
  },
  projectTools: {
    agKitInstall: {
      name: "Agentic Kit をインストール",
      description: "エージェントキットをインストール",
    },
    agKitInit: {
      name: "Agentic Kit を初期化",
      description: "エージェントキットの設定を初期化",
    },
    uiproInstall: {
      name: "UI Pro をインストール",
      description: "UI Pro インターフェースキットをインストール",
    },
    uiproInitGemini: {
      name: "UI Pro Gemini を初期化",
      description: "Gemini 用に UI Pro を初期化",
    },
    agentsSkillsInit: {
      name: "エージェントスキルを初期化",
      description: "エージェントスキルをプロジェクトに追加",
    },
    agentsMdScaffold: {
      name: "AGENTS.md を作成",
      description: "プロジェクトのエージェント指示を作成",
    },
    gitAiCommit: {
      name: "AI Git コミット",
      description: "AI でコミットメッセージを生成",
    },
    phpComposerInit: {
      name: "Composer を初期化",
      description: "Composer PHP プロジェクトを作成",
    },
    phpComposerInstall: {
      name: "PHP 依存関係をインストール",
      description: "Composer の依存関係をインストール",
    },
    phpServe: {
      name: "PHP プロジェクトを起動",
      description: "PHP 開発サーバーを起動",
    },
    pyVenvUv: {
      name: "Python 環境を作成（uv）",
      description: "uv で Python 仮想環境を作成",
    },
    pyVenvStd: {
      name: "Python 環境を作成",
      description: "Python 仮想環境を作成",
    },
    pyPipInstall: {
      name: "Python パッケージをインストール",
      description: "pip でパッケージをインストール",
    },
    nodePnpmInit: {
      name: "pnpm を初期化",
      description: "pnpm で Node.js プロジェクトを作成",
    },
    nodeTscInit: {
      name: "TypeScript を初期化",
      description: "tsconfig.json を作成",
    },
    nodePnpmInstall: {
      name: "Node 依存関係をインストール",
      description: "pnpm で依存関係をインストール",
    },
    rustCargoInit: {
      name: "Rust を初期化",
      description: "Cargo で Rust プロジェクトを作成",
    },
    rustCargoCheck: {
      name: "Rust を確認",
      description: "Rust プロジェクトを確認",
    },
    goModInit: {
      name: "Go モジュールを初期化",
      description: "Go モジュールを作成",
    },
    goModTidy: {
      name: "Go 依存関係を整理",
      description: "Go モジュールの依存関係を同期",
    },
    gitInitRepo: { name: "Git を初期化", description: "Git リポジトリを作成" },
    dockerInitProject: {
      name: "Docker を初期化",
      description: "プロジェクトの Docker ファイルを作成",
    },
  },
  commandPalette: {
    placeholder: "コマンドを入力、履歴は >、ファイル内検索は #",
    placeholderThemes: "テーマを検索...",
    placeholderContent: "ファイル内のテキストを検索...",
    placeholderHistory: "コマンド履歴を検索...",
    title: "コマンドパレット",
    description:
      "コマンドの実行、テーマの切り替え、ワークスペースの検索を行います。",
    noResults: "一致するコマンドが見つかりません。",
    status: {
      noWorkspaceRoot: "ワークスペースのルートがありません",
      minQueryChars: "2文字以上入力してください",
      noMatches: "一致する結果はありません",
      openTerminalForHistory: "履歴を実行するにはターミナルを開いてください",
      noHistory: "履歴がありません",
      searchFailed: "検索に失敗しました",
      searching: "検索中...",
      noThemes: "テーマがありません",
      emptyHint:
        "コマンドが見つかりません。検索モードを表示するには ? を入力してください。",
      back: "戻る",
    },
    modeHints: {
      history: "コマンド履歴を検索",
      content: "ファイル内のテキストを検索",
    },
    groups: {
      general: "一般",
      spaces: "スペース",
      tabs: "タブ",
      panes: "ペイン",
      git: "Git",
      search: "検索",
      view: "表示",
      ai: "AI",
      editor: "エディター",
      contents: "コンテンツ",
      commandHistory: "コマンド履歴",
      themes: "テーマ",
    },
    commands: {
      openFile: "ファイルを開く...",
      quickOpen: "クイックオープン...",
      openActiveTabs: "アクティブなタブを開く",
      openSettings: "設定を開く",
      changeTheme: "テーマを変更...",
      keyboardShortcuts: "キーボードショートカット",
      spacesOverview: "スペース: 概要",
      newSpace: "新しいスペース",
      switchToSpace: "{name} に切り替え",
      openHarness: "Agent Harness",
      newTerminal: "新しいターミナル",
      dropPrompt: "ファイルまたはフォルダをここにドロップして開く",
      dropSubtitle: "ファイルはエディタで、フォルダはターミナルで開かれます",
      newBlockTerminal: "新しいブロックターミナル",
      newPrivateTerminal: "新しいプライベートターミナル",
      connectSerial: "シリアルポートに接続...",
      newEditorTab: "新しいエディタータブ",
      newWebPreview: "新しい Web プレビュー",
      closeTabOrPane: "タブまたはペインを閉じる",
      editorReopenClosed: "エディター: 閉じたエディターを再度開く",
      lockTab: "アクティブなタブをロック",
      unlockTab: "アクティブなタブのロックを解除",
      splitPaneRight: "ペインを右に分割",
      splitPaneDown: "ペインを下に分割",
      openGitGraph: "Git グラフを開く",
      cloneRepo: "Git: リポジトリをクローン...",
      toggleSourceControl: "ソース管理の切り替え",
      findInFiles: "ファイル内のテキストを検索",
      searchHistory: "コマンド履歴を検索",
      findInCurrentTab: "現在のタブで検索",
      editorFind: "エディター: 検索と置換",
      editorGotoLine: "エディター: 行へ移動",
      editorNavigateBack: "エディター: 戻る",
      editorNavigateForward: "エディター: 進む",
      editorOutline: "エディター: アウトラインを表示",
      editorProblems: "エディター: 問題を表示",
      editorFormatDocument: "エディター: ドキュメントをフォーマット",
      editorQuickFix: "エディター: コードアクションを表示",
      editorSignatureHelp: "エディター: シグネチャヘルプを表示",
      editorGoToDefinition: "エディター: 定義へ移動",
      editorPeekDefinition: "エディター: 定義をインライン表示",
      editorGoToTypeDefinition: "エディター: 型定義へ移動",
      editorGoToImplementation: "エディター: 実装へ移動",
      editorFindReferences: "エディター: 参照を検索",
      editorInlineAi: "エディター: AI で編集",
      editorAiComplete: "エディター: AI 補完を起動",
      editorCodeComplete: "エディター: コード補完を起動",
      editorAcceptAiCompletion: "エディター: AI 補完をすべて確定",
      editorAcceptAiLine: "エディター: AI 補完を次の行まで確定",
      editorAcceptAiToken: "エディター: AI 補完を次の要素まで確定",
      editorDismissAiCompletion: "エディター: AI 補完を破棄",
      editorAddCursorAbove: "エディター: 上にカーソルを追加",
      editorAddCursorBelow: "エディター: 下にカーソルを追加",
      editorClearMultipleCursors: "エディター: 複数カーソルを解除",
      editorMoveLineUp: "エディター: 行を上へ移動",
      editorMoveLineDown: "エディター: 行を下へ移動",
      editorCopyLineUp: "エディター: 行を上へコピー",
      editorCopyLineDown: "エディター: 行を下へコピー",
      editorExpandSelection: "エディター: 選択範囲を拡張",
      editorSplitGroupRight: "エディター: グループを右に分割",
      editorSplitGroupDown: "エディター: グループを下に分割",
      editorFocusNextGroup: "エディター: 次のグループに移動",
      editorCloseGroup: "エディター: アクティブなグループを閉じる",
      editorEmptyGroup: "このグループでファイルを選択または開いてください",
      editorSaveToPreview:
        "プレビューを有効にするにはファイルを保存してください",
      searchFiles: "ファイル名で検索",
      toggleExplorer: "ファイルエクスプローラーの切り替え",
      toggleHiddenFiles: "隠しファイルの表示切り替え",
      toggleAi: "AI エージェントの切り替え",
      askAiSelection: "選択範囲について AI に質問",
      exportConfig: "設定をエクスポート (JSON)...",
      importConfig: "設定をインポート (JSON)...",
      lockVault: "キー保管庫をロック",
      zoomIn: "拡大",
      zoomOut: "縮小",
      zoomReset: "ズームをリセット",
    },
    disabled: {
      noTerminalTab: "ターミナルタブがありません",
      paneLimit: "ペイン数の上限です",
      lastTab: "最後のタブです",
      tabLocked: "タブがロックされています",
      noWorkspaceRoot: "ワークスペースのルートがありません",
      noSearchableView: "検索可能なビューがありません",
      currentSpace: "現在のスペース",
      noActiveTab: "アクティブなタブがありません",
      noEditorTab: "アクティブなエディターがありません",
      noPreviousLocation: "前のエディター位置がありません",
      noNextLocation: "次のエディター位置がありません",
    },
  },
  ai: {
    title: "AI アシスタント",
    composerPlaceholder:
      "質問を入力、コードの変更を依頼、またはスニペットに # を使用...",
    composerAttach: "ファイルまたは選択範囲を添付",
    composerVoice: "音声入力",
    composerSend: "プロンプトを送信",
    composerStop: "生成を停止",
    models: "モデル",
    sessions: "セッション",
    newSession: "新しいチャット",
    clearHistory: "履歴をクリア",
    tools: {
      status: {
        awaitingApproval: "承認待ち",
        responded: "応答済み",
        preparing: "準備中",
        running: "実行中",
        done: "完了",
        denied: "拒否済み",
        error: "エラー",
        failed: "失敗",
      },
      labels: {
        input: "入力",
        output: "出力",
        error: "エラー",
        read: "読み取り",
        empty: "空",
        noMatches: "一致なし",
        truncated: "切り詰められました",
        timedOut: "タイムアウト",
        created: "作成済み",
        wrote: "書き込み済み",
        running: "実行中",
        filesScanned: "· {count} 個のファイルをスキャン済み",
        filesCount: "· {count} 個のファイル",
        hitsCount: "{count} 件の一致",
        replacementCount: "{count} 箇所の置換",
        insert: "挿入",
        inserted: "挿入済み",
        insertAria: "アクティブなターミナルに挿入",
      },
    },
    approvals: {
      writeFileTitle: "ファイルの書き込みリクエスト",
      runCommandTitle: "コマンドの実行リクエスト",
      deleteTitle: "削除リクエスト",
      renameTitle: "名前の変更リクエスト",
      allow: "許可",
      deny: "拒否",
      rememberChoice: "このセッション中はこの選択を記憶する",
      writeFile: "ファイルを書き込み",
      editFile: "ファイルを編集",
      editBatch: "ファイルを編集 (一括)",
      createDir: "ディレクトリを作成",
      runShell: "シェルコマンドを実行",
      spawnBackground: "バックグラウンドプロセスを生成",
      needsApproval: "承認が必要です",
      reviewInDiffTab: "差分タブで確認",
      replaceAll: "· すべて置換",
      linesReview: "{lines} 行 · 差分タブで確認",
      diffStatsReview: "−{removed} / +{added} 行 · 差分タブで確認",
      editsReview: "{count} 件の編集 · 差分タブで確認",
    },
    planReview: {
      title: "プランの確認",
      pendingChanges: "{count} 件の保留中の変更",
      newBadge: "新規",
      noLineChanges: "行レベルの変更はありません",
      moreChanges: "… 他 {count} 件の変更",
      multiEdit: "複数箇所の編集",
      createDir: "ディレクトリを作成",
    },
    diff: {
      accept: "ハンクを採用",
      reject: "ハンクを破棄",
      acceptAll: "すべての差分を採用",
      rejectAll: "すべての差分を破棄",
    },
    emptyTitle: "Voktty に何でも質問してください",
    emptyDescription:
      "コマンド出力の説明、エラーの修正、スニペットの生成、タスクの実行などを行えます。",
    thinking: "思考中\u2026",
    requestFailed: "リクエストに失敗しました。",
    dismiss: "閉じる",
    continueLabel: "続行",
    stepLimitHit:
      "ステップの上限に達しました。続けるには「続行」を押してください。",
    compactionNotice:
      "コンテキストが圧縮されました \u2014 トークンを節約するため、古いツール結果 {count} 件が省略されました。",
    readLabel: "読み取り",
    fileCount: "{count} 個のファイル",
    editorSelection: "エディターの選択範囲",
    terminalSelection: "ターミナルの選択範囲",
    inputBarConnect:
      "AI プロバイダーを接続 (またはローカルモデルを使用) \u2014 キーは OS のキーチェーンに安全に保持されます。",
    inputBarConnectButton: "プロバイダーを接続",
    inputPlaceholder:
      "Voktty に何でも質問   -   スニペット/コマンドは #、ファイルは @",
    listening: "聞き取り中\u2026",
    transcribing: "文字起こし中\u2026",
    openAgent: "AI エージェントを開く",
    closePanel: "AI パネルを閉じる",
    attachFile: "ファイルまたは画像を添付",
    voiceNeedsKey: "音声入力には {provider} のキーが必要です",
    stopTranscribe: "停止して文字起こし",
    send: "送信",
    sendEnter: "送信 (Enter)",
    stop: "停止",
    searchModels: "モデル、プロバイダー、機能を検索\u2026",
    tabAll: "すべて",
    tabFavorites: "お気に入り",
    tabRecent: "履歴",
    allProviders: "すべてのプロバイダー",
    openAiCompatible: "OpenAI 互換",
    notConfigured: "{label} \u2014 未設定",
    modelLabel: "モデル: {label}",
    modelNoKey: "{label} \u2014 キーが設定されていません",
    configureProvider:
      "これらのモデルを使用するには {label} を設定してください。",
    noFavorites:
      "お気に入りはまだありません \u2014 モデルにスターを付けてここに固定してください。",
    noRecent: "最近使用したモデルはありません。",
    noModelsMatch: "一致するモデルはありません。",
    favorite: "お気に入りに追加",
    unfavorite: "お気に入りから削除",
    intelligence: "知能",
    speed: "速度",
    affordability: "コストパフォーマンス",
    miniChat: "AI チャットウィンドウを開く",
    loadingSessions: "セッションを読み込み中\u2026",
    closeEsc: "閉じる (Esc)",
    switchSession: "セッションを切り替え",
    newChat: "新しいチャット",
    newSessionLabel: "新規セッション",
    deleteSession: "セッションを削除",
    emptyStateDesc:
      "Voktty はアクティブなターミナル (カレントディレクトリ、最近のコマンド、出力) を認識しています。",
    suggestExplainError: "直前のエラーを説明",
    suggestExplainErrorHint: "ターミナルバッファーを読み取る",
    suggestGenerateCmd: "コマンドを生成",
    suggestGenerateCmdHint: "実行したいことを入力",
    suggestSummarize: "バッファーを要約",
    suggestSummarizeHint: "最近のアクティビティを振り返る",
    planMode: "プランモード",
    planQueued: "\u00b7 {count} 件がキューに入っています",
    planNoEdits: "\u00b7 キューに入っている変更はありません",
    planExit: "終了",
    contextModel: "モデル",
    contextLastRequest: "最後のリクエスト",
    contextEstimated: "推定コンテキスト",
    contextCached: "うちキャッシュ済み",
    contextSessionInput: "セッション入力",
    contextSessionOutput: "セッション出力",
    contextCacheHit: "キャッシュヒット",
    contextSessionCost: "セッションコスト",
    contextWindow: "コンテキストウィンドウ",
    contextFooterReported:
      "最後のリクエストは現在のコンテキストサイズを反映しています。セッション合計は累積値です。",
    contextFooterEstimated: "トークン数は概算です (文字数 / 4)。",
    filePicker: {
      title: "ワークスペースファイル",
      noWorkspace: "ワークスペースが開かれていません",
      indexing: "ワークスペースのインデックス作成中\u2026",
      noMatches: "一致するファイルはありません",
      truncated:
        "ワークスペースが大きすぎます \u2014 検索条件を絞り込んでください。",
      remoteWarning:
        "これらのファイルはホストから取得されます。引用したファイルは、この端末で選択した AI プロバイダーに送信される場合があります。",
      remoteUnavailable:
        "ホストはこのセッションのファイル引用を有効にしていません。",
      remoteError: "ホストはファイル要求を完了できませんでした。",
    },
    snippetPicker: {
      noMatches:
        "一致なし。設定 \u2192 エージェント でスニペットを追加してください。",
      preBuilt: "組み込みスニペット",
      snippets: "スニペット",
    },
    todos: "ToDo",
    agentStatus: {
      openLog: "AI ログを開く",
      error: "エラー",
      thinking: "思考中\u2026",
    },
    selection: {
      askVoktty: "Voktty に質問",
    },
    chips: {
      removeCommand: "コマンドを削除",
      removeSnippet: "スニペットを削除",
    },
  },
  agents: {
    notificationsTitle: "エージェントのアクティビティ",
    attention: "要確認",
    working: "処理中...",
    finished: "タスク完了",
    started: "開始済み",
    exited: "終了済み",
    noNotifications: "最近のエージェントアクティビティはありません。",
    clearAll: "すべてクリア",
    launchAgent: "エージェントを起動",
    backToMenu: "新しいタブメニューに戻る",
    oneWorkspacePanes: "1つのワークスペース、最大4つのペイン",
    instances: "インスタンス",
    instanceCount: "{count} 個のインスタンス",
    instancesCount: "{count} 個のインスタンス",
    startCommand: "起動コマンド",
    aliasesFlagsSupported: "エイリアスとフラグがサポートされています。",
    resetToDefault: "{command} にリセット",
    timeJustNow: "たった今",
    timeMinAgo: "{m}分前",
    timeHourAgo: "{h}時間前",
    timeDayAgo: "{d}日前",
    statusWaiting: "待機中",
    statusWorking: "処理中",
    notifNeedsInput: "入力待ち",
    notifFinished: "完了",
    notifFailed: "失敗",
    hookEnabled: "有効",
    hookEnable: "有効化",
    hookEnabling: "有効化中",
    activeBadge: "{count} 件アクティブ",
    agentAlerts: "エージェントのアラート",
    alertsOnBadge: "{count} 件オン",
    dismissNotification: "通知を閉じる",
    diffFiles: "{count} 件の変更ファイル",
    diffPreview: "変更のプレビュー",
    diffMoreFiles: "その他 {count} 件のファイル",
    viewDiff: "変更を表示",
    discardAndRevert: "破棄して元に戻す",
    reverted: "元に戻しました",
    discard: "破棄",
    stageChanges: "変更をステージ",
    staged: "ステージ済み",
    stage: "ステージ",
  },
  editor: {
    highlightText: "選択範囲をハイライト",
    highlightColorYellow: "イエロー",
    highlightColorGreen: "グリーン",
    highlightColorBlue: "ブルー",
    highlightColorPink: "ピンク",
    highlightColorPurple: "パープル",
    removeHighlight: "ハイライトを解除",
    clearAllHighlights: "すべてのハイライトを消去",
    highlightAdded: "ハイライトを保存しました",
    highlightRemoved: "ハイライトを解除しました",
    highlightsCleared: "すべてのハイライトを消去しました",
    viewSourceCode: "ソースコードを表示",
    dialog: {
      nameRequired: "名前は必須です",
      pathMustBeRelative: "相対パスである必要があります",
      noWorkspaceRoot: "ワークスペースのルートがありません",
      description:
        "ファイル名 (ワークスペースルートからの相対パス)。拡張子によって言語モードが決まります。",
    },
    status: {
      binaryFile: "バイナリファイル",
      fileTooLarge: "ファイルが大きすぎます",
      syntaxDisabled: "構文機能は無効です",
      previewNotSupported: "プレビューはサポートされていません",
      openAnyway: "それでも開く",
    },
    context: {
      aiActions: "AI Copilot",
      explain: "コードを説明",
      explainPrompt:
        "このコードのロジックと構造を詳しく分解して説明してください:",
      fix: "修正とデバッグ",
      fixPrompt:
        "このコードのバグ、エラー、エッジケースを分析し、修正されたバージョンを提供してください:",
      improve: "リファクタリングと最適化",
      improvePrompt:
        "このコードのクリーンな最適化、パフォーマンスの改善、リファクタリングを提案してください:",
      document: "ドキュメントを追加",
      documentPrompt:
        "このコードに明確なドキュメント、docstring、型定義、説明的なコメントを追加してください:",
      tests: "単体テストを生成",
      testsPrompt:
        "標準的なテスト規約を使用して、このコードの包括的な単体テストスイートを生成してください:",
      askAi: "これについて AI に質問...",
      askPrompt:
        "このコードについて何を知りたいですか？または何をしたいですか？",
      cut: "切り取り",
      copy: "コピー",
      paste: "貼り付け",
      find: "検索と置換",
      format: "ドキュメントのフォーマット",
    },
  },
  quickOpen: {
    title: "クイックオープン",
    description: "現在のワークスペースからファイルを検索して開きます。",
    placeholder: "名前またはパスでファイルを検索...",
    remote: "SSH",
    status: {
      noWorkspace: "ファイルを検索するワークスペースを開いてください",
      unsupportedWorkspace:
        "このワークスペースではクイックオープンを利用できません",
      indexing: "ワークスペースのファイルを索引中...",
      failed: "ワークスペースのファイルを索引できませんでした",
      noMatches: "一致するファイルはありません",
    },
    groups: {
      recent: "最近開いたファイル",
      files: "ワークスペースのファイル",
      matches: "一致",
    },
    footer: {
      open: "Enter で開く",
      pin: "{shortcut} で開いたままにする",
      truncated: "結果は制限されています",
    },
  },
  workspaceSearch: {
    title: "ワークスペース検索",
    queryLabel: "検索テキスト",
    queryPlaceholder: "すべてのファイルを検索",
    matchCase: "大文字と小文字を区別",
    wholeWord: "単語全体",
    regex: "正規表現を使用",
    clear: "検索をクリア",
    filters: "含めるまたは除外するファイル",
    includeLabel: "含めるファイル",
    includePlaceholder: "src/**, **/*.ts",
    excludeLabel: "除外するファイル",
    excludePlaceholder: "dist/**, **/*.snap",
    summary: "{files} ファイル内に {matches} 件",
    filesScanned: "{count} ファイルを検索",
    partial: "制限あり",
    replace: {
      toggle: "置換を切り替え",
      label: "置換テキスト",
      placeholder: "置換後の文字列",
      preview: "プレビュー",
      preparing: "準備中...",
      dirtyBlocked:
        "置換前に一致する開いている {count} ファイルを保存してください",
      truncatedBlocked: "制限された結果を置換する前に検索を絞り込んでください",
      applied: "{files} ファイルに {replacements} 件の置換を適用しました",
      conflict:
        "プレビュー後に {count} ファイルが変更されたため、上書きしませんでした",
      rollbackFailed:
        "{count} ファイルを復元できませんでした。今すぐ確認してください",
      selectFile: "{file} を含める",
      moreOccurrences: "このプレビューに表示されていない置換も含まれます",
      applying: "適用中...",
      confirm: "{files} ファイルの {replacements} 件を置換",
    },
    status: {
      noWorkspace: "内容を検索するワークスペースを開いてください",
      unsupported: "このワークスペースでは検索を利用できません",
      enterQuery: "ワークスペースを検索するテキストを入力してください",
      searching: "検索中...",
      failed: "ワークスペース検索に失敗しました",
      noMatches: "結果が見つかりません",
    },
  },
  shortcuts: {
    unassigned: "未割り当て",
    filterPlaceholder: "ショートカットをフィルター...",
    labels: {
      commandPaletteOpen: "コマンドパレットを開く",
      commandPaletteContent: "ファイル内を検索",
      fileQuickOpen: "クイックオープン",
      tabsLaunchpad: "アクティブなタブを開く",
      settingsOpen: "設定を開く",
      tabNew: "新しいタブ",
      tabNewBlock: "新しいブロックターミナル",
      tabNewPrivate: "新しいプライベートターミナル",
      tabNewPreview: "新しい Web プレビュー",
      tabNewHarness: "Agent Development Harness",
      tabNewEditor: "新しいエディタータブ",
      tabClose: "タブまたはペインを閉じる",
      paneSplitRight: "ペインを右に分割",
      paneSplitDown: "ペインを下に分割",
      paneFocusNext: "次のペインにフォーカス",
      paneFocusPrevious: "前のペインにフォーカス",
      paneSwapLeft: "ペインを左に入れ替え",
      paneSwapRight: "ペインを右に入れ替え",
      paneSwapUp: "ペインを上に入れ替え",
      paneSwapDown: "ペインを下に入れ替え",
      paneSource: "ソースパネルを切り替え",
      terminalClear: "ターミナルをクリア",
      terminalCopilot: "インラインターミナル Copilot",
      terminalToggleInput: "Shell / AI 入力を切り替え",
      terminalHistory: "コマンド履歴",
      blocksPrevious: "前のコマンドブロック",
      blocksNext: "次のコマンドブロック",
      tabNext: "次のタブ",
      tabPrevious: "前のタブ",
      tabSelectByIndex: "タブ 1–9 に移動",
      spaceNext: "次のスペース",
      spacePrevious: "前のスペース",
      spaceOverview: "スペースを開く",
      explorerSearch: "ファイルを検索",
      searchFocus: "タブ内を検索",
      aiToggle: "AI エージェントを切り替え",
      aiToggleMini: "AI チャットウィンドウを切り替え",
      aiAskSelection: "選択範囲について AI に質問",
      agentHistoryOpen: "エージェントの操作履歴",
      agentFocusAttention: "注意が必要なエージェントへ移動",
      sidebarToggle: "ファイルエクスプローラーを切り替え",
      sourceControlToggle: "ソース管理の切り替え",
      explorerFocus: "エクスプローラーのフォーカスを切り替え",
      explorerToggleHidden: "隠しファイルを切り替え",
      viewZoomIn: "ズームイン",
      viewZoomOut: "ズームアウト",
      viewZoomReset: "ズームをリセット",
      viewZenMode: "Zen モードを切り替え",
      editorUndo: "元に戻す",
      editorRedo: "やり直す",
      editorAiComplete: "AI 補完を起動",
      editorCodeComplete: "コード補完を起動",
      editorGotoLine: "行へ移動",
      editorFormatDocument: "ドキュメントをフォーマット",
      editorQuickFix: "コードアクションを表示",
      editorSignatureHelp: "シグネチャヘルプを表示",
      editorGoToDefinition: "定義へ移動",
      editorPeekDefinition: "定義をインライン表示",
      editorGoToTypeDefinition: "型定義へ移動",
      editorGoToImplementation: "実装へ移動",
      editorFindReferences: "参照を検索",
      editorOpenFile: "ファイルを開く",
      editorNavigateBack: "戻る",
      editorNavigateForward: "進む",
      editorOutline: "アウトラインを表示",
      editorOpenFolder: "フォルダーを開く",
    },
    groups: {
      general: "一般",
      tabs: "タブ",
      spaces: "スペース",
      panes: "ペイン",
      terminal: "ターミナル",
      search: "検索",
      ai: "AI",
      view: "表示",
      editor: "エディター",
    },
  },
  gitHistory: {
    title: "Git 履歴",
    loading: "コミットを読み込み中\u2026",
    couldNotLoad: "履歴を読み込めませんでした",
    noCommits: "コミットはまだありません",
    noCommitsDesc: "このブランチにはコミットがありません。",
    loadingMore: "さらに読み込み中\u2026",
    allLoaded: "すべてのコミットを読み込みました",
    copySha: "SHA をコピー",
    copied: "コピーしました",
    loadingFiles: "ファイルを読み込み中\u2026",
    noFileChanges: "ファイルの変更はありません。",
    unknownAuthor: "不明",
    filesChangedCount: "{count} 個のファイルが変更されました",
    noSubject: "(件名なし)",
    headers: {
      subject: "件名",
      author: "作成者",
      date: "日付",
      changes: "変更",
    },
  },
  updater: {
    title: "アップデート",
    updateReady: "アップデートの準備完了",
    downloading: "アップデートをダウンロード中\u2026",
    versionAvailable: "Voktty v{version} が利用可能です",
    restartToFinish: "インストールを完了するには Voktty を再起動してください。",
    manualDescription:
      "現在 v{currentVersion} を使用しています。ディストリビューションを選択してコマンドを実行するか、GitHub からパッケージを取得してください。",
    newVersionReady: "新しいバージョンをインストールする準備が整いました。",
    later: "後で",
    installAndRestart: "インストールして再起動",
    downloadPackage: "パッケージをダウンロード",
  },
  closeDialogs: {
    dirtyOne: "1 個のファイルに未保存の変更があります",
    dirtyMany: "{count} 個のファイルに未保存の変更があります",
    processAndDirty:
      "プロセスが実行中であり、{dirty}。終了するとプロセスが停止し、変更は破棄されます。",
    dirtyQuit: "{dirty}。終了するとこれらは破棄されます。",
    processQuit: "ターミナルでプロセスがまだ実行中です。終了すると停止します。",
    dontAskProcess: "実行中のプロセスについて今後確認しない",
    discardAndQuit: "破棄して終了",
    quit: "終了",
    confirmQuit: "Voktty を終了しますか？",
    closeTabDirty: '"{title}" には未保存の変更があります。それでも閉じますか？',
    closeTabBusy: '"{title}" でコマンドがまだ実行中です。それでも閉じますか？',
    closeTabTitle: "タブを閉じますか？",
    closeAnyway: "それでも閉じる",
  },
  preview: {
    openInBrowser: "ブラウザーで開く",
    reload: "再読み込み",
    devServerDetected: "{url} で開発サーバーが検出されました",
    openPreview: "プレビューを開く",
    xfoHint:
      "多くの公開サイトは埋め込みを拒否します (X-Frame-Options)。ページが空白の場合は、外部ブラウザーで開いてください。",
    title: "プレビュー",
    suspendedTitle: "プレビューが一時停止されました",
    suspendedDesc:
      "バックグラウンドでアイドル状態になったため、メモリを解放しました。",
    emptyTitle: "プレビューするものがありません",
    emptyDesc:
      "上に URL を入力するか、ポートドロップダウンを開いて実行中の開発サーバーに直接ジャンプしてください。公開サイトは埋め込みをブロックすることが多いので、空白のページが表示された場合はリンクアイコンからブラウザーで開いてください。",
    portsDropdownTitle: "一般的な開発サーバーのポート",
    ports: "ポート",
    checkingPort: "確認中\u2026",
    addressPlaceholder: "http://localhost:3000",
    openInBrowserTooltip: "システムのブラウザーで開く",
    noServerListening: ":{port} でリッスンしているサーバーはありません。",
    enterUrlNotice: "URL を入力するか、ポートプリセットを選択してください。",
  },
  workspace: {
    environment: "ワークスペース環境",
    localEnvironments: "ローカル環境",
    windowsLocal: "Windows ローカル",
    localShell: "ローカルシェル",
    loadingWsl: "WSL ディストリビューションを読み込み中...",
    wslUnavailable: "WSL は利用できません",
    noWslDistros: "WSL ディストリビューションが見つかりません",
    empty: {
      title: "開いているタブはありません",
      description:
        "{project} でファイルやフォルダーを開くか、新しいターミナルを起動して開始してください。",
      openFile: "ファイルを開く",
      openFolder: "フォルダーを開く",
      newFile: "新規ファイル",
      openHarness: "Agent Harness",
      newTerminal: "新規ターミナル",
      dropPrompt: "ファイルまたはフォルダをここにドロップして開く",
      dropSubtitle: "ファイルはエディタで、フォルダはターミナルで開かれます",
    },
  },
  ssh: {
    title: "SSH 接続",
    description:
      "リモート SSH サーバーを管理し、1クリックでターミナルにアクセスします。",
    noConnections: "保存された接続はありません",
    newConnection: "新しい SSH 接続",
    manageConnections: "SSH 接続を管理",
    importConfig: "~/.ssh/config からインポート",
    importSuccess:
      "{imported} 個の新しいホストをインポートしました (設定内に合計 {total} 個検出)。",
    noConfigFound: "~/.ssh/config にホストが見つかりませんでした。",
    noConnectionsTitle: "SSH 接続はまだありません",
    noConnectionsDesc:
      "リモートサーバーを追加するか、~/.ssh/config からホストをインポートしてワンクリックで接続できるようにします。",
    connecting: "{name} に接続中...",
    connected: "{name} に接続しました",
    connectionFailed: "{name} への接続に失敗しました",
    disconnected: "{name} から切断されました",
    reconnecting: "{name} に再接続中...",
    reconnect: "再接続",
    dialog: {
      newTitle: "新しい SSH 接続",
      editTitle: "SSH 接続を編集",
      description: "リモートサーバーアクセスのための接続詳細を設定します。",
      name: "接続名",
      host: "ホストまたは IP",
      port: "ポート",
      user: "ユーザー",
      identityFile: "秘密鍵 (Identity File)",
      extraArgs: "追加の引数",
      initialDirectory: "初期リモートディレクトリ",
      initialDirectoryDescription:
        "ワークスペース、エクスプローラー、ターミナルをこのディレクトリで開始します。リモートのホームディレクトリを使用する場合は空白のままにします。",
      saveAndConnect: "保存して接続",
      fromVault: "保管庫から",
      multiplexerTitle: "リモートセッション永続化",
      multiplexerBadge: "tmux / screen",
      multiplexerDescription: "tmux / screen を使用して、接続切断時や再接続時でもバックグラウンド処理を維持します。",
      multiplexerDisabled: "無効",
      multiplexerAuto: "自動 (tmux)",
      multiplexerAsk: "接続時に確認",
      tmuxSessionName: "セッション名 / プレフィックス (任意)",
    },
    connect: "接続",
    errors: {
      hostRequired: "ホストまたは IP アドレスは必須です",
    },
    sessionPicker: {
      title: "リモートセッションを検出",
      description: "接続方法を選択してください：",
      activeSessionsTitle: "ホスト上のアクティブセッション",
      windows: "ウィンドウ",
      attached: "他のクライアントで使用中",
      detached: "デタッチ済み (利用可能)",
      joinShared: "参加 (共有)",
      takeControl: "排他制御を取得",
      resume: "セッションを再開",
      noExistingSessions: "このホスト上に既存のセッションは見つかりませんでした。",
      newSession: "新しい独立セッション",
      directShell: "tmux なしで接続 (直接シェル)",
      refresh: "セッションを更新",
      customSessionPlaceholder: "セッション名 (例: dev, work-2)",
      createAndConnect: "作成して接続",
      manageSessions: "セッションを選択...",
    },
    subtabs: {
      servers: "SSH サーバー",
      tunnels: "ポート転送",
    },
    tunnels: {
      title: "ポート転送 & SSH トンネル",
      description:
        "安全な SSH トンネル (-L, -R, -D) を介してローカルまたはリモートのポートを転送します。",
      newButton: "新規トンネル",
      stopAllButton: "すべて停止",
      filterAll: "すべて",
      filterActive: "アクティブ",
      typeLocal: "ローカル",
      typeRemote: "リモート",
      typeDynamic: "ダイナミック",
      searchPlaceholder: "トンネルを検索...",
      emptyTitle: "トンネルルールが設定されていません",
      emptySubtitle:
        "最初の SSH トンネルを作成して、安全にポートをマッピングしましょう。",
      noMatches: "トンネルが見つかりません",
      noMatchesSubtitle: "検索キーワードやフィルターを変更してください。",
      startTunnel: "トンネルを開始",
      stopTunnel: "トンネルを停止",
      copyAddressTooltip: "ローカルアドレスをコピー",
      copyCommandTooltip: "SSH コマンドをコピー",
      editTunnel: "トンネルルールを編集",
      deleteTunnel: "ルールを削除",
      deleteConfirmTitle: "このトンネルルールを削除しますか？",
      deleteConfirmDescription:
        "トンネル設定が完全に削除されます。アクティブな場合は直ちに切断されます。",
      toast: {
        deleted: "トンネルルールを削除しました",
        copiedCommand: "SSH コマンドをクリップボードにコピーしました",
        copiedAddress: "ローカルアドレスをクリップボードにコピーしました",
      },
    },
    tunnelDialog: {
      newTitle: "新規ポート転送ルール",
      editTitle: "ポート転送ルールの編集",
      description:
        "ローカル、リモート、またはダイナミック SOCKS5 トラフィックを転送する SSH トンネルを設定します。",
      nameLabel: "トンネル名",
      typeLabel: "転送モード",
      typeLocal: "ローカル (-L)",
      typeLocalDesc: "クライアントからサーバー",
      typeRemote: "リモート (-R)",
      typeRemoteDesc: "サーバーからクライアント",
      typeDynamic: "ダイナミック (-D)",
      typeDynamicDesc: "SOCKS5 プロキシ",
      serverLabel: "対象 SSH サーバー",
      customServerOption: "カスタムサーバー...",
      endpointsHeading: "ポートマッピング",
      localBind: "ローカルバインド",
      remoteDest: "リモート宛先",
      remoteBindPort: "リモートポート",
      localDest: "ローカル宛先",
      socksPortLabel: "ローカル SOCKS5 ポート",
      validation: {
        nameRequired: "トンネル名は必須です",
        hostRequired: "SSH サーバーのホストは必須です",
        invalidLocalPort:
          "ローカルポートは 1 から 65535 の間である必要があります",
        invalidRemotePort:
          "リモートポートは 1 から 65535 の間である必要があります",
      },
      toast: {
        created: "ポート転送ルールを作成しました",
        updated: "ポート転送ルールを更新しました",
      },
    },
  },
  serial: {
    modalTitle: "シリアルポートに接続",
    modalSubtitle:
      "シリアル/COM デバイスに接続された対話型ターミナルセッションを開きます。",
    port: "ポート",
    refresh: "ポートをスキャン",
    customPort: "手動ポートパス...",
    noPortsDetected:
      "シリアルデバイスが自動検出されませんでした。パスを手動で入力してください。",
    baudRate: "ボーレート (Baud Rate)",
    default: "デフォルト",
    customBaud: "カスタム...",
    showAdvanced: "詳細設定 (8N1 / フロー制御)",
    hideAdvanced: "詳細設定を非表示",
    selectPort: "ポートを選択...",
    advanced: {
      dataBits: "データビット",
      bits: "{count} ビット",
      bit: "{count} ビット",
      parity: "パリティ",
      none: "なし",
      even: "偶数",
      odd: "奇数",
      stopBits: "ストップビット",
      flowControl: "フロー制御",
      hardware: "RTS/CTS（ハードウェア）",
      software: "XON/XOFF（ソフトウェア）",
    },
    connect: "接続",
    connectSerial: "シリアルポートを接続 (COM / TTY)...",
    resetBoard: "リセット",
    connecting: "シリアルポート {port} を開いています...",
    connected: "{port} に接続しました",
    connectionFailed: "{port} への接続に失敗しました",
    disconnected: "シリアルポート {port} が切断されました",
    errors: {
      portRequired: "ポート名は必須です",
      invalidBaudRate: "有効なボーレートが必要です",
    },
  },
  lsp: {
    enableServer: "{name} LSP を有効にする",
    startForWorkspace: "このワークスペース用に {command} を起動",
    stoppedTitle: "言語サーバーが停止しました",
    serverStopped: "{name} 言語サーバーが停止しました",
    restart: "再起動",
    disable: "無効化",
    dismissTooltip: "閉じる (設定から再度有効にできます)",
    installServer: "{name} LSP をインストール",
    serverHeader: "{name} 言語サーバー",
    notFoundPath:
      "PATH に {command} が見つかりませんでした。インストール後、再確認してください:",
    copyCommand: "コマンドをコピー",
    documentation: "ドキュメント",
    checkAgain: "再確認",
    checking: "確認中...",
    activeTitle: "言語サーバーがアクティブ",
    startingTitle: "言語サーバーを起動中",
    isRunning: "このワークスペース用に {command} が実行中です。",
    isStarting: "このワークスペース用に {command} を起動しています。",
  },
  terminal: {
    scrollToBottom: "一番下までスクロール",
    lastOutput: "最新の出力",
    linesAbove: "上部に{count}行",
    history: {
      title: "グローバルコマンド履歴",
      subtitle: "SSH、Linux、WSL、PowerShellセッション間で統一されたコマンド履歴",
      searchPlaceholder: "名前、引数、またはパスでコマンドを検索...",
      filterAll: "すべて",
      filterUnix: "Linux / SSH / WSL",
      filterPowershell: "PowerShell",
      sortRecent: "最近使用",
      sortFrequent: "よく使う",
      import: "インポート",
      export: "エクスポート",
      clearAll: "履歴を消去",
      noResults: "コマンドが見つかりません",
      copy: "コマンドをコピー (ダブルクリック)",
      insert: "アクティブなターミナルに挿入",
      run: "コマンドを実行",
      delete: "履歴から削除",
      countLabel: "件のコマンド",
      hintInsert: "挿入",
      hintRun: "実行",
      hintCopy: "コピー",
      copiedToast: "コマンドをクリップボードにコピーしました",
      insertedToast: "ターミナルに挿入しました",
      executedToast: "ターミナルで実行中",
      deletedToast: "履歴からコマンドを削除しました",
      clearedToast: "履歴を消去しました ({count} 件)",
      exportedToast: "履歴を正常にエクスポートしました",
      importedToast: "{count} 件のコマンドを正常にインポートしました",
      loading: "読み込み中...",
      copyError: "コピーに失敗しました",
      exportError: "履歴のエクスポートに失敗しました",
      importError: "ファイルのインポートに失敗しました",
    },
    block: {
      commandFallback: "コマンド",
      exitCode: "終了コード {code}",
      runAgain: "再実行",
      blockActions: "ブロックアクション",
      copyCommand: "コマンドをコピー",
      commandCopied: "コマンドをコピーしました",
      copyOutput: "出力をコピー",
      outputCopied: "出力をコピーしました",
      copyCommandAndOutput: "コマンドと出力をコピー",
      blockCopied: "ブロックをコピーしました",
      attachToAi: "AI チャットに添付",
      fixWithAi: "AI で修正",
      fixWithAiTitle: "AI にこのコマンドエラーの分析と修正を依頼する",
      fixErrorPrompt:
        "ターミナルコマンドが終了コード {code} で失敗しました:\n```\n{output}\n```\nこのエラーを修正するにはどうすればよいですか？修正したコマンドが必要な場合は提案してください。",
      fixCommandErrorPrompt:
        "コマンド `{command}` が終了コード {code} で失敗しました:\n```\n{output}\n```\nこのエラーを修正するにはどうすればよいですか？修正したコマンドが必要な場合は提案してください。",
      explainError: "AI でエラーを説明",
      explainErrorPrompt:
        "このエラーの意味と発生原因を説明してください:\n```\n{output}\n```",
      findInBlock: "ブロック内を検索",
      findPlaceholder: "ブロック内を検索",
      prev: "前へ",
      next: "次へ",
      close: "閉じる",
    },
    copilot: {
      title: "ターミナル Copilot",
      placeholder:
        "実行したいことを説明してください (例: サイズの大きいすべてのログファイルを検索)...",
      generating: "コマンドを生成中...",
      insert: "挿入",
      execute: "実行",
      copied: "コマンドをコピーしました",
      regenerate: "再生成",
      cancel: "キャンセル",
      noModelConfigured:
        "AI モデルが設定されていません。設定 → モデル を開いてください。",
      errorGenerating: "コマンドの生成に失敗しました。",
    },
    watermark: {
      historyHint: "コマンド履歴を参照",
      autocompleteHint: "パスやコマンドを自動補完",
      switchHint: "シェルと AI の切り替え",
      openAiHint: "AI アシスタントを開く",
    },
    shellInputPlaceholder:
      "コマンドを実行  -  \u2191 履歴  {shortcut} で AI に切り替え",
    scripts: {
      title: "プロジェクトスクリプト",
      run: "実行",
      runInSplit: "分割ペインで実行",
      runInBackground: "バックグラウンドで実行",
      noScripts: "スクリプトが見つかりません",
      toggleHud: "プロジェクトスクリプト HUD の切り替え",
      pasteToPrompt: "プロンプトに貼り付け",
      copyCommand: "コマンドをコピー",
    },
  },
  onboarding: {
    title: "Voktty へようこそ",
    subtitle:
      "ターミナルと AI ワークスペースをすばやくセットアップしましょう。",
    skip: "スキップ",
    back: "戻る",
    next: "次へ",
    finish: "Voktty を起動",
    step1Title: "言語とタブ",
    step1Desc: "表示言語とタブのレイアウトを選択してください。",
    step2Title: "テーマとフォント",
    step2Desc: "外観、フォントサイズ、視認性をカスタマイズします。",
    step3Title: "AI & DeepSeek",
    step3Desc:
      "AI API キーを接続してコード生成とターミナルエージェントを有効化します。",
    step4Title: "準備完了！",
    step4Desc: "設定が保存され、すぐに使用できます。",
    tabLayout: "タブルート",
    tabHorizontal: "水平",
    tabHorizontalDesc: "クラシックな上部バーナビゲーション",
    tabVertical: "垂直",
    tabVerticalDesc: "モダンなサイドバータブ (推奨)",
    themeLabel: "カラーテーマ",
    terminalFontSize: "ターミナルのフォントサイズ",
    editorFontSize: "エディターのフォントサイズ",
    compact: "コンパクト (12px)",
    standard: "標準 (14px)",
    large: "大 (16px)",
    extra: "特大 (18px)",
    deepseekApiKey: "DeepSeek API キー",
    deepseekKeyPlaceholder: "sk-...",
    getDeepseekKey: "platform.deepseek.com でキーを取得",
    keySavedNotice: "キーは OS のキーチェーンに安全に保存されます。",
    otherProviders: "その他の AI プロバイダー",
    configureLater: "キーは設定画面でいつでも変更できます。",
    summaryLanguage: "言語",
    summaryTabs: "タブ",
    summaryTheme: "テーマ",
    summaryFontSize: "フォントサイズ",
    summaryAi: "AI プロバイダー",
    aiConnected: "接続済み",
    aiNotConnected: "未設定 (後で設定可能)",
    setupBadge: "セットアップ",
    workspaceTitle: "ターミナルと AI のワークスペース",
    stepRail1: "UI とレイアウト",
    stepRail2: "テーマとフォント",
    stepRail3: "DeepSeek BYOK",
    stepRail4: "確認して起動",
    stepLabel: "ステップ {step} / 4",
    terminalPreview: "ターミナルプレビュー",
    environmentReady: "アクティブなテーマで環境を初期化しました。",
    deepseekTitle: "DeepSeek API (BYOK)",
    recommended: "おすすめ",
    deepseekDescription: "高速で経済的、高度な推論機能を備えています。",
    showKey: "表示",
    hideKey: "非表示",
    saved: "保存済み",
    save: "保存",
    defaultModel: "既定: {model}",
    providerApiKey: "{provider} API キー",
    apiKeyPlaceholder: "API キー...",
    shortcutsTitle: "基本ショートカット:",
    shortcutChat: "AI チャット",
    shortcutNewTab: "新しいタブ",
    shortcutCommands: "コマンド",
  },
  vault: {
    title: "キー保管庫",
    description:
      "マスターパスワード (AES-256-GCM) で保護された、暗号化された SSH 秘密鍵、パスフレーズ、API トークンを保存します。",
    searchPlaceholder: "名前、説明、タグでキーを検索...",
    copiedToast: "{label} をクリップボードにコピーしました",
    copyError: "クリップボードへのコピーに失敗しました",
    downloadedToast: "{filename} をダウンロードしました",
    addedToast: "キーを保管庫に保存しました",
    updatedToast: "キーを更新しました",
    deletedToast: "キーを保管庫から削除しました",
    wipedToast: "すべてのキーが削除され、保管庫が初期化されました",
    hideSecret: "シークレットを隠す",
    showSecret: "シークレットを表示",
    copySecret: "シークレットをコピー",
    copyPublicKey: "公開鍵をコピー",
    downloadPem: "秘密鍵をダウンロード (.pem)",
    downloadPub: "公開鍵をダウンロード (.pub)",
    types: {
      ssh_key: "SSH 秘密鍵",
      ssh_passphrase: "SSH パスフレーズ",
      api_key: "API キー",
      token: "トークン / シークレット",
      generic_secret: "汎用シークレット",
    },
    filters: {
      all: "すべて",
    },
    status: {
      unlocked: "保管庫のロック解除中",
      autoLock: "自動ロック",
      never: "無効",
      itemSingle: "件のキーが保存されています",
      itemPlural: "件のキーが保存されています",
    },
    actions: {
      addKey: "キーを追加",
      lockNow: "ロック",
      changePass: "パスワード変更",
      wipeAll: "保管庫を消去",
      wipeAllTitle: "すべてのキーを削除して保管庫を初期化",
    },
    empty: {
      title: "保管庫にキーがありません",
      description:
        "暗号化された SSH 秘密鍵、パスフレーズ、API トークンをここに安全に保管します。",
      noFilterResults: "一致するキーが見つかりません",
      filterDescription: "検索キーワードやフィルターを変更してみてください。",
    },
    setup: {
      cardTitle: "マスターパスワードの設定",
      cardDescription:
        "マスターパスワードはすべてのキーを AES-256-GCM でローカルに暗号化します。外部に送信されることはなく、紛失時の復元はできません。",
      masterPasswordLabel: "マスターパスワード",
      confirmPasswordLabel: "マスターパスワード (確認)",
      initializeButton: "保管庫を初期化",
      initializing: "初期化中...",
      errorMinLength: "マスターパスワードは6文字以上である必要があります。",
      errorMismatch: "パスワードが一致しません。",
      errorGeneric: "保管庫の初期化に失敗しました。",
      successToast: "保管庫が正常に初期化されました",
    },
    unlock: {
      cardTitle: "保管庫はロックされています",
      cardDescription:
        "保存されているキーにアクセスするにはマスターパスワードを入力してください。",
      inputPlaceholder: "マスターパスワードを入力...",
      button: "保管庫のロック解除",
      unlocking: "解除中...",
      errorIncorrect: "マスターパスワードが正しくありません。",
      successToast: "保管庫のロックを解除しました",
      forgotPrompt: "マスターパスワードをお忘れですか？",
      wipeOption: "保管庫を消去して初期化",
    },
    wipe: {
      title: "すべてのキーを消去して保管庫を初期化",
      warningDescription:
        "この操作は取り消せません。暗号化されたすべての SSH 鍵とシークレットが完全に破棄されます。",
      cautionHeader: "完全削除の警告",
      cautionDetails:
        "消去すると暗号化データベースがクリアされ、マスターパスワードがリセットされます。保管庫の鍵を使用する接続は再設定が必要になります。",
      confirmButton: "すべてを完全に消去",
      wiping: "消去中...",
    },
    changePass: {
      title: "マスターパスワードの変更",
      description: "新しいマスターパスワードで保管庫全体を再暗号化します。",
      oldPassLabel: "現在のマスターパスワード",
      newPassLabel: "新しいマスターパスワード",
      confirmPassLabel: "新しいパスワードの確認",
      submitButton: "パスワードを更新",
      saving: "更新中...",
      errorOldRequired: "現在のパスワードを入力してください。",
      errorMinLength: "新しいパスワードは6文字以上である必要があります。",
      errorMismatch: "新しいパスワードが一致しません。",
      errorCurrentWrong: "現在のマスターパスワードが正しくありません。",
      successToast: "マスターパスワードを正常に更新しました",
    },
    dialog: {
      newTitle: "保管庫にキーを新規追加",
      editTitle: "保管庫のキーを編集",
      description:
        "暗号化された SSH 鍵、パスフレーズ、またはシークレットを保存します。",
      nameLabel: "キー名",
      typeLabel: "キーの種類",
      secretLabel: "シークレット値",
      privateKeyLabel: "秘密鍵 (PEM)",
      publicKeyLabel: "公開鍵 (任意)",
      descriptionLabel: "説明",
      tagsLabel: "タグ (カンマ区切り)",
      addButton: "保管庫に保存",
      generatePassword: "シークレット生成",
      generateRsa: "RSA生成 (2048)",
      generateEcdsa: "ECDSA生成",
      generatedSecretSuccess: "強力なシークレットを生成しました",
      generatedSshSuccess: "SSH 鍵ペアを生成しました",
      generatedSshError: "SSH 鍵ペアの生成に失敗しました",
      validationError: "名前とシークレットは必須です。",
    },
  },
  feedback: {
    undoCommitSuccess: "直前のコミットを元に戻しました。変更はステージされています。",
    unexpectedError: "予期しないエラーが発生しました",
    somethingWentWrong: "問題が発生しました",
    errorIn: "{name} でエラーが発生しました",
    tryAgain: "もう一度試す",
    stackTrace: "スタックトレース",
    editorLanguageServerFormatFailed:
      "言語サーバーのフォーマットに失敗しました",
    editorFormatOnSaveSkipped: "保存時のフォーマットをスキップしました",
    editorNoFormatter:
      "アクティブな言語サーバーにフォーマッターがありません。設定で Ruff、Prettier、rustfmt などの外部フォーマッターを選択してください。",
    editorFormatFailed: "フォーマットに失敗しました",
    editorNoLanguageServer:
      "このファイルにアクティブな言語サーバーがありません。ステータスバーで有効にするか、設定で外部フォーマッターを選択してください。",
    formatterFormatFailed: "{formatter} によるフォーマットに失敗しました",
    fileChangedOnDisk: "ディスク上のファイルが変更されました",
    fileChangedDescription:
      "未保存の変更がある間に別のプログラムが {name} を変更しました。上書きして自分のバージョンを保持します。",
    overwrite: "上書き",
    uploadSuccess: "{fileName} を {dir} にアップロードしました",
    uploadStarting: "{fileName} を {dir} にアップロード中...",
    sshUploadFailed: "SSH アップロードに失敗しました: {error}",
    copyFailed: "コピーに失敗しました: {error}",
    downloadStarting: "{host} から {label} をダウンロード中...",
    downloadSuccess: "{label} を {dir} にダウンロードしました",
    downloadFailed: "ダウンロードに失敗しました: {error}",
    rdpConnecting: "{host}:{port} に接続中...",
    rdpDisconnected: "切断されました: {reason}",
    safeDirectoryAdded: "リポジトリを safe.directory に追加しました: {path}",
    safeDirectoryFailed: "safe.directory の例外追加に失敗しました: {error}",
    noGitRepository: "このフォルダーに Git リポジトリはありません。",
    resolveGitRepositoryFailed: "Git リポジトリを解決できませんでした",
    lspStartFailed: "{name} 言語サーバーの起動に失敗しました",
    lspStopped: "{name} 言語サーバーが停止しました",
    lspCrashing: "{name} 言語サーバーが繰り返しクラッシュしています",
    lspExited: "{name} 言語サーバーが終了しました",
    commandCopied: "コマンドをクリップボードにコピーしました",
    speechRecognitionFailed: "音声認識に失敗しました",
    transcriptionFailed: "文字起こしに失敗しました",
    microphoneAccessFailed: "マイクへのアクセスに失敗しました",
    markdownReadFailed: "ファイルの読み込みに失敗しました: {error}",
    markdownBinary: "バイナリファイルは Markdown として表示できません。",
    markdownTooLarge: "ファイルは {size} バイトです。上限は {limit} です。",
    themeNotImage: "{file}: 画像ではありません",
    themeReadFailed: "{file}: 読み込みに失敗しました",
    themeImportFailed: "画像のインポートに失敗しました",
    waitAiAction: "現在の AI 操作が完了するまでお待ちください",
    connectAiForSemanticStaging:
      "AI プロバイダーに接続してセマンティックステージングを使用してください",
    noCommitGroups: "具体的なコミットグループは提案されませんでした。",
    stagedFiles: "{message} 用に {count} ファイルをステージしました",
    committed: "コミット {sha} {summary}",
    pushed: "{upstream} にプッシュしました",
    pushCompleted: "プッシュが完了しました",
    remoteSessionFailed: "リモートセッションを確立できませんでした",
    shellOpenFailed: "{name} でシェルを開けませんでした",
    serialConnectionFailed: "{port} に接続できませんでした",
    invalidCommitMessage:
      "AI が無効なコミットメッセージを返しました。もう一度試すかモデルを変更してください。",
    lspCrashDescription: "サーバーが繰り返しクラッシュしています。",
    lspGivingUpDescription: "このワークスペースでは再試行を停止します。",
  },
  tooltips: {
    runInActiveTerminal: "アクティブなターミナルで実行",
    sent: "送信済み",
    copyCode: "コードをコピー",
    previousBranch: "前のブランチ",
    nextBranch: "次のブランチ",
    modelContextUsage: "モデルコンテキストの使用量",
    reasoning: "推論",
    cache: "キャッシュ",
    refreshMetrics: "メトリクスを更新",
    openLivePreview: "ライブプレビューを開く",
    livePreview: "ライブプレビュー",
    changeTabColor: "タブの色を変更",
    changeColorTag: "カラータグを変更",
    colorTag: "カラータグ",
    renameTab: "タブの名前を変更",
    clearColor: "色をクリア",
    clearTabTagColor: "タブタグの色をクリア",
    refreshPings: "Ping を更新",
    connecting: "接続中...",
    checkingConnection: "接続を確認中...",
    online: "オンライン",
    offline: "オフライン / 到達不可",
    toggleDiff: "差分を切り替え",
    sendCtrlAltDel: "Ctrl+Alt+Del を送信",
    sendWindowsKey: "Windows キーを送信",
  },
  extensions: {
    title: "拡張機能",
    description:
      "VS Code 互換の外部モジュールとプラグインを動的に読み込み、ターミナルと AI を拡張します。",
    reload: "再読み込み",
    openFolder: "フォルダーを開く",
    searchPlaceholder: "インストール済みの拡張機能を検索...",
    noInstalled: "拡張機能がインストールされていません",
    noMatches: "検索に一致する拡張機能はありません",
    storageHint: "拡張機能の場所:",
    packageHint: "各フォルダーには",
    openExtensionsFolder: "拡張機能フォルダーを開く",
    byPublisher: "{publisher} 作",
    reloadExtension: "拡張機能を動的に再読み込み",
    removeExtension: "拡張機能を削除",
    loadError: "拡張機能の読み込みに失敗しました",
    commandsCount: "コマンド {count} 件",
    toolsCount: "AI ツール {count} 件",
    shortcutsCount: "ショートカット {count} 件",
  },
  rdp: {
    newConnection: "リモートデスクトップ (RDP)",
    connectSubtitle:
      "Windows Server、ワークステーション、または XRDP ホストに接続",
    host: "ホスト / IP アドレス",
    port: "ポート",
    username: "ユーザー名",
    domain: "ドメイン",
    password: "パスワード",
    resolution: "ディスプレイ解像度",
    ignoreCert: "自己署名証明書を許可する (LAN推奨)",
    connect: "デスクトップに接続",
    connecting: "接続中...",
    connectingTo: "リモートデスクトップに接続しています...",
    connectionFailed: "接続に失敗しました",
    disconnect: "切断",
    manageInSettings: "設定で管理",
    savedProfiles: "保存済み接続",
    noConnectionsTitle: "保存された RDP 接続はありません",
    noConnectionsSubtitle:
      "RDP 接続プロファイルを追加すると、どのワークスペースからもすぐにアクセスできます。",
    addFirstConnection: "最初の接続を追加",
    saveToProfiles: "すぐにアクセスできるよう RDP 接続プロファイルに保存",
    section: {
      title: "リモートデスクトップ (RDP)",
      description:
        "保存済みのリモートデスクトップ接続を管理し、Windows または XRDP ホストに接続します。",
    },
    dialog: {
      newTitle: "新しい RDP 接続",
      editTitle: "RDP 接続を編集",
      description:
        "再利用できるリモートデスクトップ接続プロファイルを保存します。",
      nameLabel: "接続名",
      colorTag: "カラータグ",
      hostRequired: "ホストは必須です",
      saveAndConnect: "保存して接続",
    },
    pane: {
      noUsername: "既定のユーザーなし",
      protocol: "RDP プロトコル (CredSSP/NLA)",
      checkingPort: "ポートを確認中...",
      portActive: "ポート {port} は有効です",
      portUnavailable: "ポートに接続できません",
      checkConnectivity: "接続を再確認",
      reopenNative: "リモート デスクトップで再度開く (mstsc)",
      openNative: "リモート デスクトップで開く (mstsc)",
      commandCopied: "コマンドをコピーしました",
      copyCli: "CLI コマンドをコピー",
      editProfile: "プロファイルを編集",
      serverDetails: "サーバーの詳細",
      hostIp: "ホスト / IP アドレス:",
      rdpPort: "RDP ポート:",
      assignedUser: "割り当てられたユーザー:",
      promptOnConnect: "（接続時に確認）",
      noneValue: "（なし）",
      nativeClient: "推奨ネイティブクライアント:",
      usefulShortcuts: "便利な RDP キーボードショートカット",
      remoteCtrlAltDel: "Ctrl + Alt + Del（リモート）",
      fullscreenWindow: "全画面 / ウィンドウ",
      switchWindows: "ウィンドウを切り替える",
      remoteStartMenu: "リモートのスタートメニュー",
      tip: "{action} をクリックすると、GPU アクセラレーション、オーディオとクリップボードのリダイレクト、NLA / CredSSP に対応したネイティブ Windows セッションを開始します。",
    },
  },
});

const jaTranslated = mergeLocale(jaBase, {
  common: {
    untitled: "無題",
    indentTabs: "タブ",
    indentSpaces: "スペース: {count}",
    accept: "承認",
    reject: "却下",
    generate: "生成",
    more: "その他",
    builtIn: "組み込み",
    breadcrumb: "パンくずリスト",
    unknownError: "不明なエラー",
  },
  settings: {
    general: {
      backup: {
        exportFailed: "設定のエクスポートに失敗しました",
        copyJsonFailed: "設定 JSON のコピーに失敗しました",
      },
    },
    themes: {
      appThemes: { editTheme: "{name}を編集", removeTheme: "{name}を削除" },
    },
    models: {
      endpointNamePlaceholder: "マイ endpoint",
      shortcutFallback: "ショートカット",
      localMeta: {
        lmstudioDescription:
          "LM Studio HTTP サーバーで GGUF モデルを実行します（Developer タブで有効化）。",
        lmstudioHint:
          "LM Studio に読み込まれたモデル ID を使用します。サーバーの /v1/models endpoint を参照してください。",
        mlxDescription:
          "mlx_lm.server による Apple Silicon 推論（pip install mlx-lm）。",
        mlxHint:
          "mlx_lm.server に渡した Hugging Face リポジトリパスを使用します。",
        ollamaDescription:
          "Ollama 内蔵の OpenAI 互換 API によるローカルモデル。",
        ollamaHint:
          "`ollama list` または `ollama pull` のモデル名を使用します。",
        compatibleDescription:
          "vLLM、Z.AI、Fireworks など、任意の OpenAI 互換 endpoint。",
        openrouterDescription:
          "任意の OpenRouter モデル。完全な provider/model ID を入力してください。",
        openrouterHint: "openrouter.ai/models でモデル ID を確認できます。",
      },
      hints: {
        flagship: "フラッグシップ",
        balanced: "バランス",
        fast: "高速",
        max: "最大",
        fastest: "最速",
        coding: "コーディング",
        cheap: "低コスト",
        frontier: "最先端",
        best: "最高",
        previous: "前世代",
        legacy: "旧世代",
        lite: "軽量",
        stable: "安定",
        reasoning: "推論",
        configurable: "設定可能",
        local: "ローカル",
        code: "コード",
        ultraFast: "超高速",
        versatile: "多用途",
        thinking: "思考",
      },
      modelDescriptions: {
        gpt_5_6: "複雑な専門業務とエージェント処理向けの最先端モデル。",
        gpt_5_6_terra: "低コスト、低レイテンシで高い知能。",
        gpt_5_6_luna: "大量処理向けの高速で手頃な推論。",
        gpt_5_5: "最先端の推論とコード。",
        gpt_5_5_pro: "最難関の専門業務とエージェント処理向け最高精度版。",
        gpt_5_4_mini: "低コストで高速なデフォルトモデル。",
        gpt_5_4_nano: "小型で即応性が高く、autocomplete に最適。",
        gpt_5_3_codex: "コードとツール利用向けに調整。",
        gpt_4_1_mini: "大量タスク向けの超低コストな実用モデル。",
        claude_fable_5:
          "高度な推論と長時間のエージェント処理に最も強力な Claude。",
        claude_sonnet_5: "Claude の知能と速度の最良の組み合わせ。",
        claude_opus_4_8:
          "複雑な推論と長時間のエージェントコーディングに最も強力な Anthropic モデル。",
        claude_opus_4_7: "長時間推論向けの前世代フラッグシップ。",
        claude_sonnet_4_6: "品質と速度の優れたバランス。",
        claude_haiku_4_5: "高速、低価格、マルチモーダル。",
        claude_opus_4_6: "前世代の Opus。",
        gemini_3_5_flash: "高知能で非常に高速なマルチモーダルモデル。",
        gemini_3_1_flash_lite:
          "非常に高速で低価格、軽量なマルチモーダルモデル。",
        gemini_3_1_pro_preview: "1M コンテキストウィンドウを備えた強力な推論。",
        gemini_3_flash_preview:
          "1M コンテキストウィンドウを備えた高速マルチモーダルモデル。",
        gemini_2_5_pro: "本番環境で安定した Gemini モデル。",
        gemini_2_5_flash: "低コストで高スループット。",
        grok_4_5: "コーディング、エージェント、知識作業向けの最先端モデル。",
        grok_4_20_reasoning: "拡張思考を備えた最先端推論。",
        grok_4_20_non_reasoning: "チャットとツール向けの高速モデル。",
        grok_4_fast_reasoning: "視覚と推論を備えた低コスト版 Grok 4。",
        grok_4_3:
          "ツール利用に優れ、1M コンテキストを備えた高性能で高速な Grok。",
        grok_build_0_1:
          "エージェントワークフローと Grok Build CLI 向けの高速コーディングモデル。",
        deepseek_v4_pro: "強力な open-weight コードモデル。",
        deepseek_v4_flash: "日常作業向けの高速で手頃なモデル。",
        deepseek_reasoner: "open-weight の価格で利用できる思考連鎖推論。",
        mistral_large_latest:
          "128K コンテキストを備えた Mistral フラッグシップ。",
        mistral_medium_latest: "速度と知能の良好なバランス。",
        codestral_latest: "Mistral のコーディング専用モデル。",
        gpt_oss_120b: "Cerebras シリコン上での高速推論。",
        llama3_3_70b: "ウェハースケールシリコン上の Meta オープンモデル。",
        qwen_3_32b: "非常に高速な多言語モデル。",
        openai_gpt_oss_20b: "Groq LPU 上で 1 秒未満の応答。",
        llama_3_3_70b_versatile: "高速で幅広い用途に対応。",
        deepseek_r1_distill_llama_70b: "Groq 上の推論蒸留 Llama。",
        openrouter_custom: "ID で選択する任意の OpenRouter モデル。",
        openai_compatible_custom: "任意の OpenAI 互換 endpoint。",
        lmstudio_local: "LM Studio によるローカル GGUF モデル。",
        mlx_local: "mlx_lm.server による Apple Silicon モデル。",
        ollama_local: "Ollama によるローカルモデル。",
      },
    },
    about: { splashAlt: "Voktty スプラッシュ画面" },
    docker: { customHostPlaceholder: "自動検出 (//./pipe/docker_engine)" },
  },
  docker: { activeLabel: "稼働中", containers: "コンテナ" },
  tabs: {
    agentLauncher: "エージェントランチャー",
    openAgentChat: "チャットでエージェントを開く",
    moreTerminals: "その他のターミナル",
    colorTag: "カラータグ",
    hoverCard: {
      loadingMetrics: "メトリクスを読み込み中...",
      file: "ファイル",
      terminalBlocks: "ターミナル (Blocks)",
      terminalLocal: "ターミナル (ローカル)",
      markdownPreview: "Markdown プレビュー",
      webPreview: "Web プレビュー",
      aiDiffReview: "AI Diff レビュー",
      gitDiff: "Git Diff",
      gitHistory: "Git 履歴",
    },
    subtitles: {
      terminal: "ターミナル",
      file: "ファイル",
      gitDiff: "Git diff",
      gitHistory: "Git 履歴",
      webPreview: "Web プレビュー",
      aiProposal: "AI 提案",
      remoteDesktop: "リモートデスクトップ",
    },
  },
  spaces: { collapse: "折りたたむ", expand: "展開" },
  explorer: {
    noCurrentDirectory: "現在のディレクトリがありません",
    dropFilePath: "ここにファイルパスをドロップ",
  },
  git: {
    discardAllDescription: "{label}を破棄します。この操作は元に戻せません。",
    discardOneDescription:
      '"{label}"の変更を破棄しますか？この操作は元に戻せません。',
    unstagedFiles:
      "未ステージ: {count} {count, plural, =1 {ファイル} other {ファイル}}",
    remoteIndicator: {
      publish: "発行",
      publishTooltip: "ローカルブランチをリモートリポジトリに発行します。",
      diverged:
        "ブランチが upstream から分岐しています。ソース管理またはターミナルで解決してください。",
      pull: "remote の {count} {count, plural, =1 {commit} other {commits}}を fast-forward のみで pull。",
      push: "local の {count} {count, plural, =1 {commit} other {commits}}を push。",
      sync: "同期",
      fetch: "remote の更新を fetch。",
    },
    characterCount: "文字数: {count}",
    branchName: "ブランチ: {name}",
    repository: "リポジトリ",
    followActiveContext: "アクティブコンテキストに追従",
    loadingBranches: "ブランチを読み込み中...",
    localBranches: "ローカルブランチ",
    worktrees: "Worktree",
    noBranches: "ブランチが見つかりません。",
    detached: "detached",
    refreshSourceControl: "ソース管理を更新",
    onRepository: "{name} 上",
    diverged: "upstream から分岐",
    resolveInTerminal: "ターミナルで解決",
    stageFile: "{name}をステージ",
    fetching: "fetch 中...",
    fetchRemote: "remote から fetch",
    pulling: "pull 中...",
    branchDiverged: "ブランチが分岐しました。ターミナルで解決してください",
    noUpstream: "upstream が設定されていません",
    alreadyUpToDate: "最新です",
    pullCommits: "{count} commit を pull (fast-forward)",
    unknownSourceControlError: "不明なソース管理エラー",
  },
  ai: {
    generatingCode: "コードを生成中...",
    generatingLanguage: "{language}を生成中...",
    tools: {
      names: {
        read: "読み取り",
        list: "一覧",
        write: "書き込み",
        createDirectory: "ディレクトリを作成",
        edit: "編集",
        run: "実行",
        spawn: "起動",
        logs: "ログ",
        jobs: "ジョブ",
        kill: "終了",
        search: "検索",
        glob: "Glob",
        suggest: "提案",
        preview: "プレビュー",
        subagent: "サブエージェント",
        todos: "タスク",
      },
    },
    diff: {
      status: {
        pending: "レビュー待ち",
        approved: "適用済み",
        rejected: "却下済み",
      },
    },
    reasoning: {
      thinking: "思考中",
      reasoned: "推論完了",
      reasonedFor: "{duration}秒で推論完了",
    },
    agentSwitcher: {
      activeTitle: "エージェント: {name}",
      builtIn: "組み込み",
      custom: "カスタム",
      agents: {
        coder: {
          name: "コーダー",
          description:
            "汎用コーディングアシスタント。記述、編集、実行を行います。",
        },
        architect: {
          name: "アーキテクト",
          description: "設計とトレードオフ。コードの前に計画します。",
        },
        reviewer: {
          name: "コードレビュアー",
          description: "Diff の正確性、性能、セキュリティをレビューします。",
        },
        security: {
          name: "セキュリティ",
          description: "変更の脅威をモデル化し、脆弱性を指摘します。",
        },
        designer: {
          name: "デザイナー",
          description: "UI/UX を評価して改善します。",
        },
      },
    },
    slashCommands: {
      init: "ワークスペースを初期化",
      plan: "計画モード",
      claudeCode: "Claude Code に委任",
    },
    selection: {
      askTitle: "チャットでこの選択について AI に質問 (Ctrl+J)",
      editTitle: "AI で選択範囲をライブ編集 (Ctrl+K)",
      edit: "編集",
      runTitle: "ターミナルで実行 (Shift+Enter)",
      run: "実行",
    },
  },
  editor: {
    markdownOpenLink: "Cmd/Ctrl+クリックで開く",
    loading: "読み込み中...",
    navigateBack: "戻る",
    navigateForward: "進む",
    diffNewFile: "新規ファイル",
    diagnosticsTitle:
      "{errors}件のエラー、{warnings}件の警告。クリックしてコードアクションを表示 (Alt+Enter)",
    quickFixAction: "クイックフィックス (Alt+Enter)",
    codeActions: {
      title: "コードアクション",
      preferred: "推奨",
      fixWithAi: "AI で修正",
      activeModel: "アクティブなモデル",
      commandUnsupported:
        "この言語サーバーコマンドには安全なコマンドブリッジが必要です。",
      requiresPreview:
        "このアクションは複数のファイルを変更するため、安全なプレビューが必要です。",
      invalidEdit: "言語サーバーが無効または空の編集を返しました。",
      resolveFailed: "コードアクションを解決できませんでした",
      documentChanged:
        "ドキュメントが変更されました。もう一度実行してください。",
      applied: "コードアクションを適用しました",
      requestFailed: "コードアクションを読み込めませんでした",
    },
    signatureHelp: {
      previous: "前のオーバーロード",
      next: "次のオーバーロード",
      close: "シグネチャヘルプを閉じる",
      unavailable: "このドキュメントではシグネチャヘルプを利用できません",
      requestFailed: "シグネチャヘルプを読み込めませんでした",
    },
    navigation: {
      definition: "定義",
      typeDefinition: "型定義",
      implementation: "実装",
      references: "参照",
      unavailable: "このドキュメントではシンボルナビゲーションを利用できません",
      empty: "一致するシンボル位置が見つかりませんでした",
      requestFailed: "シンボル位置を読み込めませんでした",
      resultsTruncated: "最初の 1,000 件のみ表示しています",
    },
    peek: {
      definitionTitle: "定義のインライン表示",
      referencesTitle: "参照のインライン表示",
      previous: "前の結果",
      next: "次の結果",
      open: "結果を開く",
      close: "インライン表示を閉じる",
      results: "シンボルの場所",
      loading: "プレビューを読み込み中...",
      binary: "バイナリファイルはここではプレビューできません",
      tooLarge: "このファイルはインラインプレビューには大きすぎます",
      invalid: "言語サーバーが無効なプレビュー位置を返しました",
      error: "ファイルのプレビューを読み込めませんでした",
      resultsTruncated: "最初の 500 件のみ表示しています",
    },
    rename: {
      title: "シンボル名を変更",
      inputLabel: "新しいシンボル名",
      preview: "プレビュー",
      requestFailed: "シンボル名を変更できませんでした",
      documentChanged:
        "ドキュメントが変更されました。もう一度実行してください。",
      noChanges: "言語サーバーは変更を検出しませんでした",
      "resource-operation":
        "この名前変更には、まだ安全に対応していないファイル操作が含まれます。",
      "non-file-uri":
        "この名前変更はワークスペースファイル以外を対象にしています。",
      "outside-workspace":
        "この名前変更はアクティブなワークスペース外のファイルを対象にしています。",
      "ambiguous-payload":
        "言語サーバーが曖昧なワークスペース編集を返しました。",
      "invalid-edit": "言語サーバーが無効なワークスペース編集を返しました。",
      "limit-exceeded":
        "名前変更が Voktty の安全なトランザクション上限を超えています。",
      previewUnavailable: "安全な編集プレビューを利用できません",
      unavailable: "このドキュメントでは名前変更を利用できません",
      prepareFailed: "シンボル名の変更を準備できませんでした",
      previewTitle: "シンボル名の変更を確認",
      previewDescription:
        "{previous} を {next} に変更します。適用前に {edits} 件の変更を確認してください。",
      loadingPreview: "安全なプレビューを作成しています...",
      dirtyBlocked:
        "影響する開いている {count} ファイルの変更を保存または破棄してください。",
      applied: "{files} ファイルに {edits} 件の名前変更を適用しました",
      conflict:
        "プレビュー後に {count} ファイルが変更されました。何も適用されていません。",
      rollbackFailed:
        "{error} ロールバックが完了しませんでした。確認してください: {paths}",
      selectFile: "{path} を名前変更に含める",
      editCount: "{count} 件の変更",
      previewTruncated: "安全上の上限により一部の詳細が非表示です。",
      selectionSummary: "{files} ファイル、{edits} 件の変更を選択",
      applying: "適用中...",
      apply: "名前変更を適用",
    },
    runInTerminal: "ターミナルで実行",
    runInTerminalTitle: "ターミナルで実行 (Shift+Enter)",
    editWithAiTitle: "AI で編集 (Ctrl+K)",
    assistantChat: "AI アシスタンス (チャット)",
    askAgent: "AI エージェントに質問",
    askAgentPrompt: "このコードについて質問:",
    explainHowItWorks: "動作を説明",
    analyzeArchitecture: "アーキテクチャを分析",
    analyzeArchitecturePrompt:
      "このコードのアーキテクチャ、依存関係、モジュール性を分析してください。",
    auditSecurity: "セキュリティを監査",
    auditSecurityPrompt:
      "このコードの脆弱性、セキュリティ上の欠陥、未サニタイズ入力を監査してください。",
    designTestCases: "テストケースを設計",
    designTestCasesPrompt:
      "このコードの包括的なテスト戦略とユニットテストケースを設計してください。",
    selectionActions: {
      code: "コード",
      text: "テキスト",
      liveExecution: "ライブ実行",
      chat: "チャット",
      badges: {
        security: "セキュリティ",
        uiUx: "UI/UX",
        types: "型",
        ts: "TS",
        pythonic: "Pythonic",
        idiomatic: "慣用的",
        tailwind: "Tailwind",
        query: "クエリ",
        syntax: "構文",
        writing: "文章",
      },
      items: {
        "php-security": {
          label: "セキュリティを強化",
          description: "SQLi と XSS を防ぎ入力を検証",
        },
        "php-optimize": {
          label: "最適化",
          description: "PHP の速度と効率を改善",
        },
        "php-fix": {
          label: "エラーを修正",
          description: "PHP のバグと非推奨機能を修正",
        },
        "php-tests": {
          label: "PHPUnit を生成",
          description: "PHPUnit テストスイートを作成",
        },
        "html-tailwind": {
          label: "Tailwind を最新化",
          description: "最新の Tailwind CSS でスタイルを設定",
        },
        "html-a11y": {
          label: "アクセシビリティ (a11y)",
          description: "WCAG 準拠とセマンティクスを改善",
        },
        "html-fix": {
          label: "マークアップを修正",
          description: "DOM 構造を検証して修正",
        },
        "html-seo": {
          label: "SEO を最適化",
          description: "セマンティクスと SEO メタデータを改善",
        },
        "ts-strict-types": {
          label: "厳密な型",
          description: "厳密な型付けと null-safety を適用",
        },
        "ts-optimize": {
          label: "ES6+ を最適化",
          description: "最新の ES6+ で性能を改善",
        },
        "ts-fix": {
          label: "バグを修正",
          description: "バグとメモリリークを修正",
        },
        "ts-tests": {
          label: "Vitest を生成",
          description: "Vitest ユニットテストを作成",
        },
        "js-convert-ts": {
          label: "TypeScript に移行",
          description: "TypeScript の型付けを追加",
        },
        "js-optimize": { label: "ES6+ を最適化", description: "ES6+ で最新化" },
        "js-fix": { label: "バグを修正", description: "不具合を検出して修正" },
        "js-tests": {
          label: "テストを生成",
          description: "ユニットテストを作成",
        },
        "py-pythonic": {
          label: "Pythonic に最適化",
          description: "性能と PEP 8 スタイルを改善",
        },
        "py-type-hints": {
          label: "Type Hint を追加",
          description: "Type Hint と docstring を追加",
        },
        "py-fix": { label: "エラーを修正", description: "例外とバグを修正" },
        "py-pytest": {
          label: "Pytest を生成",
          description: "pytest ユニットテストを作成",
        },
        "rust-idiomatic": {
          label: "慣用的かつ Zero-Cost",
          description: "zero-cost 抽象化と borrowing を使用",
        },
        "rust-safe": {
          label: "堅牢化 (unwrap なし)",
          description: "panic と unwrap を除去",
        },
        "rust-fix": {
          label: "borrow/lifetime を修正",
          description: "borrow checker と型の問題を解決",
        },
        "rust-tests": {
          label: "#[test] を生成",
          description: "ネイティブ Rust テストを作成",
        },
        "go-idiomatic": {
          label: "慣用的な Go",
          description: "慣用的な Go パターンを適用",
        },
        "go-errors": {
          label: "エラー処理 (fmt.Errorf)",
          description: "エラーをラップして伝播",
        },
        "go-fix": {
          label: "バグを修正",
          description: "data race と nil エラーを修正",
        },
        "go-tests": {
          label: "テストとベンチを生成",
          description: "ネイティブテストと benchmark を作成",
        },
        "css-tailwind": {
          label: "Tailwind に変換",
          description: "CSS を Tailwind クラスに変換",
        },
        "css-responsive": {
          label: "レスポンシブ化",
          description: "Flexbox、Grid、mobile-first デザインを使用",
        },
        "css-clean": {
          label: "整理して変数化",
          description: "重複を削除して変数を使用",
        },
        "sql-optimize": {
          label: "クエリを最適化",
          description: "クエリ速度と実行計画を改善",
        },
        "sql-secure": {
          label: "SQL Injection を防止",
          description: "クエリをパラメータ化してサニタイズ",
        },
        "sql-format": { label: "SQL を整形", description: "SQL 構文を整形" },
        "json-fix": { label: "検証して修正", description: "構文エラーを修正" },
        "json-format": {
          label: "整形して並べ替え",
          description: "キーを整形して並べ替え",
        },
        "json-sanitize": {
          label: "シークレットを除去",
          description: "token とパスワードを隠す",
        },
        "text-improve": {
          label: "文章を改善",
          description: "文法、流れ、明瞭さを改善",
        },
        "text-summarize": {
          label: "要点を要約",
          description: "構造化された箇条書き要約を作成",
        },
        "text-translate": {
          label: "英語に翻訳",
          description: "自然な技術翻訳を作成",
        },
        "text-markdown": {
          label: "Markdown を構造化",
          description: "Markdown の書式と階層を適用",
        },
        "generic-optimize": {
          label: "最適化",
          description: "速度と構造を改善",
        },
        "generic-fix": {
          label: "エラーを修正",
          description: "エラーを検出して修正",
        },
        "generic-doc": {
          label: "文書化",
          description: "コメントとドキュメントを追加",
        },
        "generic-test": {
          label: "テストを生成",
          description: "ユニットテストを作成",
        },
      },
    },
    inlineAi: {
      reviewTitle: "提案された変更をレビュー",
      editTitle: "AI で編集 (Ctrl+K)",
      placeholder: "指示（例: 最適化、または @ファイル でコンテキストを参照）",
      mentionFile: "@ でプロジェクトファイルを指定",
      file: "@ ファイル",
      modifyInstruction: "指示を変更",
      discard: "破棄 (Esc)",
      apply: "適用 (Ctrl+Enter)",
      generationFailed: "コードの生成に失敗しました",
      actions: {
        refactor: "リファクタリング",
        refactorPrompt:
          "読みやすさとモジュール性を改善するためにこのコードをリファクタリング",
        optimize: "最適化",
        optimizePrompt: "性能を最適化して不要な処理を削減",
        typeScript: "TS 型を追加",
        typeScriptPrompt: "厳密で完全な TypeScript 型を追加",
        edgeCases: "境界ケース",
        edgeCasesPrompt: "境界ケース向けの防御的検証とエラー処理を追加",
        document: "文書化",
        documentPrompt: "簡潔で正確なドキュメントコメントを追加",
      },
    },
    media: {
      zoomOut: "縮小",
      toggleFit: "フィット / 100% を切り替え",
      zoomIn: "拡大",
      actualSize: "100% サイズ",
      fit: "フィット",
    },
    terminalNoActive: "コードを実行できるアクティブなターミナルがありません",
    terminalCodeSent: "コードをターミナルに送信しました",
    markdownRendered: "レンダリング",
    markdownRaw: "ソース",
    quickFix: {
      fallbackPrompt:
        "このコードの構文エラー、未定義変数、型の問題を分析して修正してください。",
      diagnosticsPrompt:
        "次のコンパイラ/LSP 診断を修正してください:\n{errors}\n\n残りのロジックはクリーンで慣用的に保ち、意図しない副作用を避けてください。",
    },
  },
  workspace: { localMachine: "ローカルマシン" },
  ssh: {
    metrics: { users: "ユーザー", remoteLinux: "SSH 経由のリモート Linux" },
    dialog: { namePlaceholder: "例: 本番サーバー" },
    tunnelDialog: {
      namePlaceholder: "例: MySQL データベースまたは Vite アプリ",
    },
  },
  serial: {
    toggleDtr: "Data Terminal Ready (DTR) を切り替え",
    toggleRts: "Request to Send (RTS) を切り替え",
    pulseReset:
      "DTR/RTS パルスでマイクロコントローラーをリセット (ESP32/Arduino)",
  },
  terminal: {
    connection: {
      connecting: "{name} に接続しています...",
      reconnecting: "{name} に再接続しています...",
      cancelling: "{name} への接続をキャンセルしています...",
      failed: "{name} に接続できませんでした",
      disconnected: "{name} から切断されました",
      error: "接続エラー",
      retry: "再試行",
    },
    aiInput: {
      noCommand: "この指示からコマンドを生成できませんでした。",
      processingFailed: "指示の処理に失敗しました",
      executing: "実行中: {command}",
      permissionGranted:
        "このタブに権限を付与しました。AI コマンドは直接実行されます。",
      copied: "コマンドをクリップボードにコピーしました",
      preview: "コマンドのプレビューを実行",
      copy: "コマンドをコピー",
      allowAlwaysTitle: "このタブでは確認を再表示しない",
      allowAlways: "このタブでは常に許可",
      cancel: "いいえ (Esc)",
      confirm: "はい、実行 (Enter)",
      placeholder:
        "実行したい内容を入力してください（例: フォルダー一覧、ファイル検索）。Enter で処理",
      generating: "コマンドを生成中...",
      generateAndRun: "生成して実行",
    },
  },
  vault: {
    status: { minutes: "{count}分", hour: "{count}時間" },
    setup: {
      minimumCharacters: "6文字以上",
      repeatPassword: "マスターパスワードを再入力",
    },
    dialog: {
      namePlaceholder: "例: 本番クラスターキー",
      secretPlaceholder: "sk-... またはパスワード",
      publicKeyPlaceholder:
        "ssh-rsa AAAAB3NzaC1yc2E... または ecdsa-sha2-nistp256 ...",
      descriptionPlaceholder: "任意のメモ",
    },
  },
  feedback: {
    unsavedBeforeWorkspaceSwitch:
      "ワークスペースを切り替える前に、未保存のエディタータブを保存または閉じてください。",
    editorUnavailable: "エディターを利用できません",
  },
  rdp: {
    dialog: { namePlaceholder: "例: Windows 開発ワークステーション" },
    toolbar: {
      originalResolution: "元の解像度 (1:1)",
      fitToWindow: "ウィンドウに合わせる",
      fit: "フィット",
      pinToolbar: "ツールバーを固定",
      unpinToolbar: "ツールバーの固定を解除",
      pin: "固定",
      pinned: "固定済み",
    },
  },
  gitHistory: {
    status: {
      added: "追加",
      modified: "変更",
      deleted: "削除",
      renamed: "名前変更",
      copied: "コピー",
      typeChanged: "型変更",
      unmerged: "未マージ",
      other: "ステータス {code}",
    },
  },
  collab: {
    roles: { host: "ホスト", controller: "操作担当", observer: "閲覧者" },
    guest: {
      menuAction: "共有ターミナルに接続",
      title: "共有ターミナルに接続",
      description: "ホストから送られた URL と招待コードを入力してください。",
      urlLabel: "接続 URL",
      urlPlaceholder: "wss://.../v1/session/...",
      codeLabel: "招待コード",
      codePlaceholder: "コードを貼り付け",
      nameLabel: "あなたの名前",
      namePlaceholder: "ホストに表示される名前",
      securityNote:
        "コードは URL と別に送信されます。ターミナル内容は Voktty クライアント間でエンドツーエンド暗号化されます。",
      connect: "接続",
      tabTitle: "共有ターミナル",
      sharedTerminal: "共有ターミナル",
      connectionFailed: "接続に失敗しました",
      disconnected: "ターミナルが切断されました",
      controlRequested: "要求済み",
      releaseControl: "操作権を返す",
      requestControl: "操作権を要求",
      reconnect: "再接続",
    },
    host: {
      menuAction: "共有",
      title: "ターミナルを共有",
      sharedTerminal: "ターミナル共有中",
      noTerminal: "ターミナルが選択されていません",
      live: "招待は有効です",
      invitationExpired: "招待の有効期限が切れました",
      expiredDescription:
        "接続済みのゲストは引き続き利用できます。別のゲストを追加するには共有を停止して新しい招待を作成してください。",
      expires: "{time}に期限切れ",
      encrypted: "エンドツーエンド暗号化",
      urlLabel: "接続 URL",
      codeLabel: "招待コード",
      participants: "参加者",
      noParticipants: "ゲストはまだ接続していません",
      revokeControl: "操作権を取り消す",
      grantControl: "操作権を付与",
      manageParticipants: "参加者を管理",
      controlRequest: "操作権を要求中",
      typing: "入力中...",
      disconnectParticipant: "切断",
      banParticipant: "禁止",
      removeParticipant: "参加者を削除",
      experimentalWarning:
        "この試験機能は一時的な Cloudflare Quick Tunnel を通じてこのターミナルのみを公開します。ホストのターミナルを閉じると、すべてのゲストが切断されます。",
      checkingCloudflared: "cloudflared を確認中...",
      cloudflaredReady: "cloudflared の準備が完了しました",
      cloudflaredMissing: "cloudflared が必要です",
      installExplanation:
        "推奨コマンドを自分のターミナルでコピーして実行し、再度確認してください。Voktty がインストールコマンドを自動実行することはありません。",
      customPathPlaceholder: "cloudflared への任意のパス",
      verifyAgain: "再確認",
      terminalNotReady: "ターミナルはまだ共有できません。",
      stopping: "停止中...",
      stop: "共有を停止",
      starting: "公開中...",
      start: "招待を作成",
      fileCitationsTitle: "リモートファイルの引用を許可",
      fileCitationsDescription:
        "ゲストはこのワークスペースルート配下のテキストファイルを検索して引用できます。アクセスは読み取り専用で、保護されたパスはブロックされます。",
      fileCitationsUnavailable:
        "ファイル引用はローカルのワークスペースルートでのみ利用できます。",
      fileCitationsLive: "リモートファイル引用が有効です",
    },
    errors: {
      connection_url_required: "接続 URL を入力してください。",
      invite_code_required: "招待コードを入力してください。",
      participant_name_required: "ホストに表示する名前を入力してください。",
      invalid_connection_url: "接続 URL は有効な Voktty 招待ではありません。",
      secure_url_required: "公開招待には安全な wss:// URL が必要です。",
      invalid_invitation: "招待が無効です。",
    },
  },
});

const jaFinal: TranslationSchema = mergeLocale(jaTranslated, {
  settings: {
    themes: {
      customName: "マイテーマ",
      customDescription: "カスタムテーマ。",
      builtinDescriptions: {
        caffeine: "クリームとエスプレッソを合わせた温かなコーヒー色。",
        catppuccin: "落ち着いた Mocha と Latte のパステル色。",
        claude: "紙面に温かな粘土色のアクセント。",
        dracula: "定番の高コントラストな紫のダークテーマ。",
        everforest: "柔らかく低コントラストな緑の森の配色。",
        gruvbox: "温かく素朴なレトロ配色。",
        kanagawa:
          "Hokusai に着想を得た墨色のダークテーマと、温かな Lotus ライト版。",
        kanagawa_dragon: "Kanagawa の控えめでほぼ黒い Dragon 版。",
        nord: "北極を思わせる青みがかった配色。",
        rose_pine: "Soho の趣を持つ自然な松とバラの色調。",
        sage: "穏やかで柔らかな、くすんだ森の緑。",
        solarized: "Ethan Schoonover による精密で眩しさを抑えた配色。",
        tide: "深い石板色と輝く海の青緑。",
        tokyo_night: "落ち着いた青みのダークテーマ。",
        voktty_default:
          "控えめなアクリル透明効果と調整された色を備えた現代的な Obsidian スタジオ。",
        xcode: "systemBlue をアクセントにした Apple システムカラー。",
      },
    },
  },
  tabs: { subtitles: { privateTerminal: "プライベートターミナル" } },
});

const jaRecent = {
  spaces: {
    dropToExtract: "離すと独立したタブとして取り出します", presentation: { composite: "分割", expanded: "展開", empty: "空" }, freeSlots: "空き {count}", moreActions: "その他の操作", focused: "フォーカス中", extractMember: "スペースから取り出す", moveToSpace: "スペースへ移動", swapPosition: "位置を交換", noFreeSlots: "このスペースには空きスロットがありません。", maxSlots: "スペースには最大 4 つの表示スロットを含められます。", slotOccupied: "このスロットはすでに使用されています。", invalidDrop: "ここではこのドロップは無効です。", resourceUnavailable: "ドロップしたパスは存在しないか、アクセスできません。", resourceOpenFailed: "ドロップしたパスを開けませんでした。", dragReady: "ドラッグ中です。強調表示されたスペースまたはスロットへ移動してください。", dropReady: "離すとここにタブを配置します。", resourceDragReady: "ドラッグ中です。ビューの上に移動すると AI で引用できます。", resourceDropReady: "ここで離すとこのファイルを AI で引用します。", layoutPreview: "スペースレイアウトのプレビュー", color: "スペースの色", colorOption: "スペースの色 {index}", resetColor: "スペースの色をリセット", windowTint: "ウィンドウ背景の色合い", resetWindowTint: "ウィンドウ背景の色合いをリセット", expandView: "スペースをタブへ展開", compactView: "スペースを 1 つのタブにまとめる", unmountSpace: "スペースを解除", shareSpace: "ネットワークでスペースを共有", shareSpaceUnavailable: "スペースの共同作業はまもなく利用可能になります。現在は個別のターミナルを共有できます。", locked: "ロック済み", dirty: "未保存", processRunning: "実行中", processAttention: "注意が必要", processFailed: "失敗", ephemeral: "一時的", deleteSpaceTitle: "視覚スペースを削除しますか？", deleteSpaceDescription: "{name} は視覚レイアウトから削除されます。ライブタブは独立したタブとして開いたままです。",
  },
};

const jaI18nBatch1: TranslationSchema = mergeLocale(mergeLocale(jaFinal, jaRecent), {
  settings: { models: { configurationRequired: "先に選択したモデルを設定してください。" } },
  terminal: { connection: { connected: "{name} に接続しました", connectionFailed: "{name} に接続できませんでした" } },
});

const jaI18nBatch2: TranslationSchema = mergeLocale(jaI18nBatch1, {
  settings: {
    tabs: {
      mcp: "MCP"
    },
    general: {
      notifications: {
        agentAvatarTitle: "エージェントのアバター",
        agentAvatarDesc: "アクティブなチャットまたはコーディング エージェントのローカルのアニメーション アバターを表示します。",
        agentAvatarSizeTitle: "アバターのサイズ",
        agentAvatarSizeDesc: "チャットタブとエージェントタブでアバターの視覚的なサイズを調整します。",
        agentAvatarSize: {
          compact: "コンパクト",
          standard: "標準",
          large: "大きい"
        },
        agentAvatarIntensityTitle: "アニメーションの強度",
        agentAvatarIntensityDesc: "アバター アニメーションの速度と強調を制御します。",
        agentAvatarIntensity: {
          low: "低い",
          standard: "標準",
          high: "高い"
        },
        agentAvatarReducedMotionTitle: "アバターの動きを減らす",
        agentAvatarReducedMotionDesc: "連続アニメーションを無効にし、状態の変化のみを保持します。"
      }
    },
    themes: {
      background: {
        vibrancyOpacity: "表面の不透明度",
        vibrancyOpacityDesc: "ネイティブの Mica または Vibrancy の背景がアプリの表面を通してどの程度輝くかを調整します。"
      }
    },
    models: {
      autocompleteTestLabel: "健康",
      testAutocomplete: "オートコンプリートのテスト",
      autocompleteTestOk: "{latency} ミリ秒で準備完了、プロファイル {profile}、{attempts} 試行。"
    }
  }
});

const jaI18nBatch3: TranslationSchema = mergeLocale(jaI18nBatch2, {
  settings: {
    models: {
      autocompleteTestFail: "テストが失敗しました: {reason}",
      autocompleteProfile: "AIプロファイル",
      autocompleteProfiles: {
        auto: "自動検出",
        generic: "汎用 OpenAI 互換",
        openai: "OpenAI",
        deepseek: "ディープシーク",
        ollama: "オラマ",
        lmstudio: "LMスタジオ"
      },
      autocompleteFailure: {
        authentication: "認証または API キー",
        rate_limit: "レート制限またはクォータ",
        unsupported_options: "サポートされていないモデルオプション",
        unavailable: "プロバイダーが利用できないかタイムアウトになっています",
        empty_response: "モデルは完了を返しませんでした",
        provider_error: "プロバイダーエラー"
      },
      localProviderLabel: {
        ollama: "オラマ ({model})",
        lmstudio: "LMスタジオ ({model})",
        mlx: "MLX ({model})",
        openrouter: "オープンルーター ({model})"
      },
      customEndpoint: "カスタムエンドポイント",
      browserBuiltIn: "ブラウザ（内蔵、無料）"
    }
  }
});

const jaI18nBatch4: TranslationSchema = mergeLocale(jaI18nBatch3, {
  settings: {
    models: {
      defaultFastModel: "デフォルトの高速モデル"
    },
    mcp: {
      title: "MCPサーバー",
      description: "明示的に有効化されたローカルおよびリモートのツール サーバーを管理します。シークレットはネイティブ資格情報ストアに残ります。",
      addServer: "サーバーの追加",
      transport: {
        stdio: "ローカルプロセス (stdio)",
        http: "ストリーミング可能なHTTP"
      },
      auth: {
        none: "権限がありません",
        bearer: "無記名トークン",
        oauth: "PKCE を使用した OAuth"
      },
      form: {
        addTitle: "MCPサーバーの追加",
        editTitle: "MCPサーバーの編集",
        description: "構成は認証情報とは別に保存されます。サーバーは、明示的に有効化された後にのみ起動します。",
        name: "表示名",
        id: "安定したサーバーID",
        idPlaceholder: "ワークスペースツール",
        transport: "輸送",
        executable: "実行可能",
        args: "引数",
        argsHint: "1 行に 1 つの引数。コマンドはシェルなしで起動されます。",
        cwd: "作業ディレクトリ"
      }
    }
  }
});

const jaI18nBatch5: TranslationSchema = mergeLocale(jaI18nBatch4, {
  settings: {
    mcp: {
      form: {
        authorizedRoot: "承認されたワークスペースのルート",
        endpoint: "終点",
        authMode: "認可",
        bearerToken: "無記名トークン",
        bearerPlaceholder: "トークンを入力してください",
        credentialStored: "認証情報はすでに保存されています",
        secretHint: "トークンはネイティブ資格情報ストアに直接送信され、このフォームで永続化されることはありません。",
        oauthHint: "サーバーを有効にすると、Authorize はブラウザーでプロバイダーを開き、一時的なループバック ポートでコールバックを受信します。",
        oauthClientId: "OAuthクライアントID",
        oauthScopes: "OAuth スコープ",
        privateNetwork: "プライベートネットワークを許可する",
        privateNetworkHint: "ループバックまたは LAN エンドポイントに必要です。パブリック平文 HTTP はブロックされたままです。",
        invalid: "保存する前に、必須フィールドと制限値を確認してください。"
      },
      phase: {
        disabled: "無効",
        disconnected: "切断されました",
        connecting: "接続中",
        connected: "接続済み",
        authenticationRequired: "許可が必要です",
        error: "接続エラー"
      },
      errors: {
        configuration: "サーバー構成が無効か不完全です。"
      }
    }
  }
});

const jaI18nBatch6: TranslationSchema = mergeLocale(jaI18nBatch5, {
  settings: {
    mcp: {
      errors: {
        authentication: "有効な資格情報またはプロバイダーの承認が必要です。",
        spawn: "ローカルサーバープロセスを開始できませんでした。",
        io: "サーバーに安全にアクセスできませんでした。",
        protocol: "サーバーは無効な MCP メッセージを返しました。",
        incompatibleVersion: "サーバーは互換性のある MCP バージョンをサポートしていません。",
        resourceLimit: "サーバーは設定された安全制限を超えました。",
        timeout: "サーバーはタイムアウト前に応答しませんでした。",
        busy: "サーバーは別の制限された操作でビジー状態です。",
        cancelled: "操作はキャンセルされました。",
        processExited: "ローカルサーバープロセスが予期せず終了しました。",
        remote: "MCP サーバーは要求を拒否しました。"
      },
      capabilities: {
        tools: "ツール",
        resources: "リソース",
        prompts: "プロンプト"
      },
      effects: {
        read: "読む",
        write: "書く",
        process: "プロセス",
        network: "ネットワーク",
        secret: "秘密",
        publish: "公開"
      }
    }
  }
});

const jaI18nBatch7: TranslationSchema = mergeLocale(jaI18nBatch6, {
  settings: {
    mcp: {
      effects: {
        delete: "消去"
      },
      scope: "範囲",
      credentials: {
        stored: "認証情報は安全に保管されます",
        missing: "資格情報がありません"
      },
      tools: {
        title: "発見されたツール ({count})",
        automaticRead: "承認なしで許可する"
      },
      resources: {
        title: "発見されたリソース ({count})"
      },
      prompts: {
        title: "検出されたプロンプト ({count})"
      },
      actions: {
        enable: "サーバーを有効にする",
        connect: "接続する",
        disconnect: "切断する",
        restart: "再起動",
        revoke: "資格情報の取り消し",
        authorize: "承認する"
      },
      delete: {
        title: "MCPサーバーを削除しますか?",
        description: "{name} は切断され、その構成と資格情報は削除されます。"
      },
      empty: {
        title: "MCP サーバーが構成されていません",
        description: "ローカルの標準入出力サーバーまたはストリーミング可能な HTTP エンドポイントを追加します。有効にするまでは何も開始または接続されません。"
      }
    }
  },
  header: {
    noMatches: "0 件の結果",
    previousMatch: "前の一致 (Shift+Enter)"
  }
});

const jaI18nBatch8: TranslationSchema = mergeLocale(jaI18nBatch7, {
  header: {
    nextMatch: "次の試合 (Enter)"
  },
  tabs: {
    hoverCard: {
      apiClient: "APIクライアント"
    },
    subtitles: {
      apiClient: "APIクライアントとサンドボックス"
    }
  },
  sidebar: {
    runDebug: "実行とデバッグ"
  },
  workbench: {
    title: "実行とデバッグ",
    tasks: "タスク",
    tests: "テスト",
    debug: "デバッグ",
    noTasks: "このワークスペースではタスクが見つかりませんでした。",
    noTests: "このワークスペースではテスト タスクが見つかりませんでした。",
    output: "出力",
    outputStatus: "{output} · {status}",
    passed: "合格した",
    failed: "失敗した",
    running: "ランニング",
    error: "エラー",
    stop: "停止",
    clear: "クリアな出力",
    refresh: "タスクを更新する",
    unnamedTest: "名前のないテスト"
  }
});

const jaI18nBatch9: TranslationSchema = mergeLocale(jaI18nBatch8, {
  workbench: {
    passedMark: "✓",
    failedMark: "×",
    skippedMark: "–",
    launch: "打ち上げ",
    attach: "添付する",
    adapterCommand: "デバッグアダプターコマンド",
    debugRequest: "デバッグリクエスト",
    debugArguments: "起動または引数の添付 (JSON)",
    debugArgumentsObject: "デバッグ引数は JSON オブジェクトである必要があります。",
    startDebugging: "デバッグを開始する",
    debugStatus: "状態",
    statusIdle: "アイドル状態",
    statusStarting: "起動",
    statusRunning: "ランニング",
    statusStopped: "一時停止中",
    statusTerminated: "終了しました",
    statusError: "エラー",
    continue: "続く",
    pause: "一時停止",
    stepOver: "ステップオーバー"
  }
});

const jaI18nBatch10: TranslationSchema = mergeLocale(jaI18nBatch9, {
  workbench: {
    stepIn: "踏み込む",
    stepOut: "ステップアウト",
    breakpoints: "ブレークポイント",
    filePath: "ファイルパス",
    line: "ライン",
    addBreakpoint: "ブレークポイントの追加",
    removeBreakpoint: "ブレークポイントを削除する",
    callStack: "コールスタック",
    variables: "変数",
    debugConsole: "デバッグコンソール",
    evaluateExpression: "式を評価する",
    evaluate: "評価する"
  },
  explorer: {
    previewType: "タイプ",
    previewFolder: "フォルダ",
    previewFile: "ファイル",
    previewSize: "サイズ",
    previewModified: "修正済み",
    previewImageTooLarge: "このファイルは大きすぎるため、画像プレビューは使用できません。",
    fileOutsideWorkspace: "このファイルは現在のエクスプローラーのワークスペースの外にあります。",
    openContainingFolder: "含まれているフォルダーを開く"
  }
});

const jaI18nBatch11: TranslationSchema = mergeLocale(jaI18nBatch10, {
  git: {
    reviewComments: "コメント",
    addComment: "コメント",
    addReviewComment: "レビューコメントを追加",
    editReviewComment: "レビューコメントの編集",
    deleteComment: "コメントの削除",
    commentAdded: "コメント追加",
    commentUpdated: "コメントを更新しました",
    commentDeleted: "コメントが削除されました",
    commentPlaceholder: "エージェントへのフィードバックや指示を書いてください...",
    commentCannotBeEmpty: "コメントを空にすることはできません",
    pressCtrlEnterToSave: "Ctrl+Enter を押して保存します",
    addedModified: "追加・修正",
    original: "オリジナル",
    noReviewCommentsYet: "レビューコメントはまだありません",
    addCommentsFromDiffHint: "フィードバックを残すには、差分のコメント ボタンを使用してください。",
    reviewHandoffTitle: "コードレビューのハンドオフ",
    reviewHandoffDescription: "AI コーディング エージェント向けの実用的なプロンプトとしてフォーマットされたコメントを確認します。",
    reviewHandoffCopied: "ハンドオフ プロンプトがクリップボードにコピーされました",
    reviewSentToAgent: "アクティブなエージェントに送信された確認プロンプト",
    scope: "範囲"
  }
});

const jaI18nBatch12: TranslationSchema = mergeLocale(jaI18nBatch11, {
  git: {
    reviewedFiles: "レビュー済み",
    commentsCount: "comments",
    handoffHotkeyHint: "レビューキューからいつでもPを押します",
    sendToAgent: "エージェントに送信"
  },
  commandPalette: {
    commands: {
      manageAliases: "エイリアスとコマンドの管理",
      focusNextSpaceSlot: "スペース：次のスロットにフォーカス",
      focusPreviousSpaceSlot: "スペース：前のスロットにフォーカス",
      toggleSpaceView: "スペース：分割ビューの切り替え",
      extractFocusedSpaceMember: "スペース:フォーカスされたメンバーを抽出する",
      moveFocusedSpaceMember: "スペース：フォーカスされたメンバーを移動..."
    }
  }
});

const jaI18nBatch13: TranslationSchema = mergeLocale(jaI18nBatch12, {
  commandPalette: {
    commands: {
      closeFocusedSpaceMember: "スペース：フォーカスされたメンバーを閉じる",
      commandHistory: "ターミナル：コマンド履歴",
      newApiClient: "新しいAPIクライアントとサンドボックス",
      editorRevealInExplorer: "エディター：エクスプローラーでファイルを表示する",
      openRunDebug: "表示：実行とデバッグ"
    },
    disabled: {
      noCompositeSpace: "有効な構成されたスペースがありません"
    }
  },
  ai: {
    approvals: {
      runDevelopmentCheck: "開発チェックを実行する",
      mcpResponseFailed: "MCP承認応答を記録できませんでした",
      sensitiveValue: "[非表示]"
    },
    planReview: {
      operationApplied: "開発オペレーションが適用されました"
    }
  }
});

const jaI18nBatch14: TranslationSchema = mergeLocale(jaI18nBatch13, {
  ai: {
    planReview: {
      operationReverted: "開発オペレーションが元に戻りました",
      revert: "操作を元に戻す",
      provenance: "__ P 0 __ · __ P 1 __ファイル· __ P 2 __コマンド"
    }
  },
  editor: {
    externalChangeDetected: "ファイル__ P 0 __は外部で変更されました。",
    externalChangeConflict: "ファイル__ P 0 __は外部で変更されましたが、保存されていない変更があります。",
    reloadFile: "ファイルを再読み込み(R)",
    keepCurrentEdits: "編集内容を保持する",
    fileReloadedSuccess: "__ P 0 __がディスクから再読み込みされました",
    status: {
      slowRead: "このファイルの開くのに予想以上の時間がかかっています。",
      readCancelled: "ファイルの読み込みがキャンセルされました。"
    }
  }
});

const jaI18nBatch15: TranslationSchema = mergeLocale(jaI18nBatch14, {
  editor: {
    status: {
      readOffline: "ネットワークの場所が利用できないか、タイムアウトしました。",
      readNotFound: "ファイルまたはそのパスはもう存在しません。",
      readPermissionDenied: "Vokttyにはこのファイルを読む権限がありません。",
      readFailed: "Vokttyはこのファイルを読み取れませんでした。"
    },
    aiCompletionStatus: {
      idle: "AIで完了",
      requesting: "進行中のAI完了",
      ready: "AI完了の準備ができました。Tabキーを押して承認します",
      error: "AIの完了に失敗しました。クリックして再試行してください",
      paused: "自動AI完了が一時停止されました。クリックして今すぐ再試行してください"
    }
  },
  shortcuts: {
    labels: {
      tabNewApiClient: "新しいAPIクライアントとサンドボックス"
    }
  }
});

const jaI18nBatch16: TranslationSchema = mergeLocale(jaI18nBatch15, {
  workspace: {
    startingWslDistro: "WSL配布を開始しています...",
    establishingConnection: "接続を確立中"
  },
  feedback: {
    sessionSaveFailed: "セッションを保存できませんでした。Vokttyは開いたままなので、もう一度お試しください。"
  },
  apiClient: {
    header: {
      title: "APIクライアントとサンドボックス",
      zeroCorsBadge: "Zero - CORS •ネイティブRustエンジン",
      requestBuilder: "リクエストビルダー",
      apiBrowser: "API ブラウザ",
      sandboxProbes: "サンドボックスプローブ",
      scenarios: "シナリオ",
      history: "歴史"
    }
  }
});

const jaI18nBatch17: TranslationSchema = mergeLocale(jaI18nBatch16, {
  apiClient: {
    header: {
      clearHistory: "履歴の消去",
      noHistory: "リクエストはまだ記録されていません。"
    },
    browser: {
      urlPlaceholder: "ベースURLを入力してください（例： https://dummyjson.comまたはhttp :// localhost: 11434/api ）",
      discovering: "発見",
      autoDiscover: "自動検出",
      fastPresets: "クイックプリセット:",
      presets: {
        dummyJson: "DummyJSON (REST API)",
        ollama: "Ollama LLM (11434)",
        docker: "Dockerデーモン(2375)",
        openAi: "OpenAI/LocalAI (v 1)"
      }
    }
  }
});

const jaI18nBatch18: TranslationSchema = mergeLocale(jaI18nBatch17, {
  apiClient: {
    browser: {
      apiService: "APIサービス",
      openApiSpec: "OpenAPI/Swagger 3.0",
      smartRouteProbe: "スマートルートプローブ",
      summaryBase: "ベース： __ P 0 __ • __ P 1 __エンドポイントは__ P 2 __ミリ秒で見つかりました",
      copyMarkdownReport: "マークダウンレポートをコピー",
      reportCopied: "検証レポートがMarkdownのクリップボードにコピーされました！",
      reportCopyFailed: "レポートのコピーに失敗しました",
      all: "すべて",
      filterPlaceholder: "エンドポイントをフィルタリング...",
      authRequired: "認証が必要です"
    }
  }
});

const jaI18nBatch19: TranslationSchema = mergeLocale(jaI18nBatch18, {
  apiClient: {
    browser: {
      testInEditor: "エディターでテスト",
      loadedInEditor: "__ P 0 __ __ P 1 __をエディターに読み込みました",
      noEndpointsFound: "フィルターに一致するエンドポイントが見つかりませんでした。",
      emptyStateTitle: "API検出とスマートブラウザ",
      emptyStateDescription: "APIのベースURL （ DummyJSON、Ollama、Docker、Webサービスなど）を入力し、[自動検出]をクリックして、使用可能なすべてのルート、メソッド、OpenAPI仕様を自動的に検出します。"
    }
  },
  agentHistory: {
    title: "エージェントの運用履歴と復旧",
    modalTitle: "エージェントの運用履歴",
    shortcutTooltip: "エージェントの運用履歴（ __ P 0 __ ）",
    sessionsCount: "セッション",
    messagesCount: "messages"
  }
});

const jaI18nBatch20: TranslationSchema = mergeLocale(jaI18nBatch19, {
  agentHistory: {
    msgs: "msgs",
    scanningFiles: "エージェントファイルをスキャンしています...",
    scanning: "実行中…",
    rescan: "再スキャン",
    closeEsc: "閉じる (Esc)",
    searchPlaceholder: "セッション、プロンプト、コードを検索...",
    allFilter: "すべて",
    searchingSessions: "セッションを検索しています...",
    noMatchesFound: "一致する項目がありません",
    noSessionsFound: "セッションが見つかりません"
  }
});

const jaI18nBatch21: TranslationSchema = mergeLocale(jaI18nBatch20, {
  agentHistory: {
    tryDifferentSearch: "別の検索キーワードをお試しください",
    clickRescan: "[再スキャン]をクリックしてエージェント履歴をインデックス",
    clearSearch: "検索履歴を消去",
    resumeInTerminal: "ターミナルで再開",
    resumeTooltip: "アクティブな端末で再開コマンドを開いて実行します",
    copyResumeCommand: "[履歴書のコピー]コマンド",
    copyTranscript: "トランスクリプトをコピー（マークダウン）",
    copyTranscriptTooltip: "完全なトランスクリプトをマークダウンとしてコピー",
    deleteSession: "インデックスからセッションを削除",
    export: "書き出し"
  }
});

const jaI18nBatch22: TranslationSchema = mergeLocale(jaI18nBatch21, {
  agentHistory: {
    find: "検索",
    findInTranscript: "トランスクリプトで検索(Ctrl + F)",
    findPlaceholder: "トランスクリプトで検索...",
    previousMatch: "前の試合（ Shift + Enter ）",
    nextMatch: "次の試合（ Enter ）",
    closeFind: "検索を閉じる(Esc)",
    loadingTranscript: "トランスクリプトメッセージを読み込んでいます...",
    noMessages: "このセッションのトランスクリプトにはメッセージが記録されていません",
    roleUser: "ユーザー",
    roleTool: "⚙️ ツール呼び出し"
  }
});

const jaI18nBatch23: TranslationSchema = mergeLocale(jaI18nBatch22, {
  agentHistory: {
    roleAssistant: "アシスタント",
    secretsRedacted: "編集された秘密",
    tool: "ツール:",
    error: "エラー",
    input: "入力する。",
    output: "出力：",
    copyMessageContent: "メッセージのコンテンツをコピー",
    runInTerminal: "ターミナルへの実行/挿入",
    selectSessionPrompt: "トランスクリプトを表示するセッションを選択してください",
    emptyDescription: "コーディングエージェントの会話を検索するか、いつでも__ P 0 __を押してください。"
  }
});

const jaI18nBatch24: TranslationSchema = mergeLocale(jaI18nBatch23, {
  agentHistory: {
    dragToResize: "ドラッグしてサイズ変更",
    noResumeAvailable: "このセッションで使用できる再開コマンドはありません。",
    resumedInTerminal: "アクティブな端末でセッションを再開しました",
    resumeCommandCopiedToast: "Resumeコマンドをコピーしました（端末を開いて実行します）",
    resumeCommandCopiedClipboard: "再開コマンドがクリップボードにコピーされました！",
    transcriptCopiedToast: "トランスクリプトマークダウンをクリップボードにコピーしました！",
    sentToTerminal: "ターミナルに送信済み",
    copiedToClipboard: "クリップボードにコピー",
    messageContentCopied: "メッセージの内容をコピーしました！",
    agents: {
      claude: "クロード・コード"
    }
  }
});

const jaI18nBatch25: TranslationSchema = mergeLocale(jaI18nBatch24, {
  agentHistory: {
    agents: {
      codex: "コデックス",
      cursor: "カーソル",
      voktty: "Vokttyエージェント",
      gemini: "反重力",
      kimi: "きみ"
    }
  },
  aliases: {
    title: "エイリアスとコマンド",
    description: "すべての端末で利用可能な組み込みの工場コマンドとカスタムエイリアスを管理します。",
    newAlias: "新規エイリアスの追加",
    openFile: "Aliases.jsonを開きます。",
    refresh: "再読み込みする"
  }
});

const jaI18nBatch26: TranslationSchema = mergeLocale(jaI18nBatch25, {
  aliases: {
    reset: "デフォルトにリセット",
    noResults: "検索に一致するエイリアスはありません。",
    searchPlaceholder: "名前と詳細で検索",
    errorOpeningFile: "Aliases.jsonを開けませんでした",
    errorToggling: "エイリアスを切り替えられませんでした",
    errorResetting: "エイリアスをリセットできませんでした",
    errorDeleting: "エイリアスを削除できませんでした",
    resetSuccess: "エイリアスを工場出荷時のデフォルトにリセット",
    deleteSuccess: "削除されたエイリアス",
    badge: {
      factory: "工場"
    }
  }
});

const jaI18nBatch27: TranslationSchema = mergeLocale(jaI18nBatch26, {
  aliases: {
    badge: {
      custom: "カスタム"
    },
    filter: {
      all: "すべて",
      factory: "工場",
      custom: "カスタム",
      enabled: "有効",
      disabled: "無効"
    },
    dialog: {
      newTitle: "新規エイリアスの追加",
      editTitle: "エイリアスを編集",
      name: "氏名",
      namePlaceholder: "- ... 我の命令に"
    }
  }
});

const jaI18nBatch28: TranslationSchema = mergeLocale(jaI18nBatch27, {
  aliases: {
    dialog: {
      description: "内容",
      descriptionPlaceholder: "このエイリアスの簡単な説明...",
      targetKind: "変換先の型",
      command: "外部コマンド",
      builtin: "ビルトインアクション",
      executable: "実行可能ファイル",
      executablePlaceholder: "git、docker、kubectl...",
      args: "引数",
      argsPlaceholder: "-- flag value",
      builtinAction: "ビルトインアクション"
    }
  }
});

export const ja: TranslationSchema = mergeLocale(jaI18nBatch28, {
  aliases: {
    dialog: {
      enabled: "有効",
      enabledHint: "エイリアスはターミナルパスで使用できます",
      nameRequired: "エイリアス名が必要です",
      saved: "エイリアスが保存されました",
      saveError: "エイリアスの保存に失敗しました"
    }
  }
});
