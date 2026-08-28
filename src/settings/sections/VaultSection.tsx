import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/modules/i18n";
import type { VaultItem, VaultItemType } from "@/modules/vault/types";
import { useVaultStore } from "@/modules/vault/vaultStore";
import {
  AiScanIcon,
  Alert02Icon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  Edit01Icon,
  Key01Icon,
  LockPasswordIcon,
  PlusSignIcon,
  Search01Icon,
  SecurityCheckIcon,
  ServerStack01Icon,
  Shield01Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { SectionHeader } from "../components/SectionHeader";
import { ChangeMasterPasswordDialog } from "../components/ChangeMasterPasswordDialog";
import { VaultItemDialog } from "../components/VaultItemDialog";
import { WipeVaultDialog } from "../components/WipeVaultDialog";

export function VaultSection() {
  const { t } = useTranslation();
  const {
    isConfigured,
    isUnlocked,
    items,
    autoLockMinutes,
    init,
    initializeVault,
    unlockVault,
    lockVault,
    changeMasterPassword,
    wipeVault,
    addItem,
    updateItem,
    deleteItem,
    setAutoLockMinutes,
  } = useVaultStore();

  // Setup / Unlock form states
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirm, setSetupConfirm] = useState("");
  const [unlockPassword, setUnlockPassword] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | VaultItemType>("all");

  // Visible secrets tracker
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  // Dialog states
  const [isItemDialogOpen, setIsItemDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VaultItem | null>(null);
  const [isWipeDialogOpen, setIsWipeDialogOpen] = useState(false);
  const [isChangePassDialogOpen, setIsChangePassDialogOpen] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  const toggleSecretVisibility = (id: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("vault.copiedToast", { label }));
    } catch {
      toast.error(t("vault.copyError"));
    }
  };

  const downloadFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t("vault.downloadedToast", { filename }));
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (setupPassword.length < 6) {
      setError(t("vault.setup.errorMinLength"));
      return;
    }
    if (setupPassword !== setupConfirm) {
      setError(t("vault.setup.errorMismatch"));
      return;
    }

    setIsProcessing(true);
    setError(null);
    const success = await initializeVault(setupPassword);
    setIsProcessing(false);
    if (success) {
      setSetupPassword("");
      setSetupConfirm("");
      toast.success(t("vault.setup.successToast"));
    } else {
      setError(t("vault.setup.errorGeneric"));
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockPassword) return;

    setIsProcessing(true);
    setError(null);
    const success = await unlockVault(unlockPassword);
    setIsProcessing(false);
    if (success) {
      setUnlockPassword("");
      toast.success(t("vault.unlock.successToast"));
    } else {
      setError(t("vault.unlock.errorIncorrect"));
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesType = typeFilter === "all" || item.type === typeFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.tags?.some((t) => t.toLowerCase().includes(q));
      return matchesType && matchesQuery;
    });
  }, [items, typeFilter, searchQuery]);

  const getItemTypeIcon = (type: VaultItemType) => {
    switch (type) {
      case "ssh_key":
        return ServerStack01Icon;
      case "ssh_passphrase":
        return Key01Icon;
      case "api_key":
        return AiScanIcon;
      case "token":
        return Shield01Icon;
      default:
        return Key01Icon;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title={t("vault.title")}
        description={t("vault.description")}
      />

      {/* Case 1: Vault Not Configured */}
      {!isConfigured && (
        <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <HugeiconsIcon icon={SecurityCheckIcon} size={22} strokeWidth={1.75} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-foreground">
                {t("vault.setup.cardTitle")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("vault.setup.cardDescription")}
              </p>
            </div>
          </div>

          <form onSubmit={handleSetup} className="flex flex-col gap-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <Label htmlFor="vault-master-pass" className="text-[11px] text-muted-foreground">
                  {t("vault.setup.masterPasswordLabel")} *
                </Label>
                <Input
                  id="vault-master-pass"
                  type="password"
                  value={setupPassword}
                  onChange={(e) => setSetupPassword(e.target.value)}
                  placeholder={t("vault.setup.minimumCharacters")}
                  className="h-8 text-xs font-mono"
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="vault-confirm-pass" className="text-[11px] text-muted-foreground">
                  {t("vault.setup.confirmPasswordLabel")} *
                </Label>
                <Input
                  id="vault-confirm-pass"
                  type="password"
                  value={setupConfirm}
                  onChange={(e) => setSetupConfirm(e.target.value)}
                  placeholder={t("vault.setup.repeatPassword")}
                  className="h-8 text-xs font-mono"
                  required
                />
              </div>
            </div>

            {error && <div className="text-[11px] text-destructive">{error}</div>}

            <div className="flex items-center justify-end pt-1">
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={isProcessing}
                className="gap-1.5 cursor-pointer"
              >
                <HugeiconsIcon icon={Key01Icon} size={14} />
                <span>{isProcessing ? t("vault.setup.initializing") : t("vault.setup.initializeButton")}</span>
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Case 2: Vault Configured but Locked */}
      {isConfigured && !isUnlocked && (
        <div className="flex flex-col gap-4 rounded-xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
              <HugeiconsIcon icon={LockPasswordIcon} size={22} strokeWidth={1.75} />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-semibold text-foreground">
                {t("vault.unlock.cardTitle")}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("vault.unlock.cardDescription")}
              </p>
            </div>
          </div>

          <form onSubmit={handleUnlock} className="flex flex-col gap-3 pt-2">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <Input
                  type="password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  placeholder={t("vault.unlock.inputPlaceholder")}
                  className="h-8 text-xs font-mono"
                  autoFocus
                  required
                />
              </div>
              <Button
                type="submit"
                variant="default"
                size="sm"
                disabled={isProcessing || !unlockPassword}
                className="gap-1.5 cursor-pointer shrink-0"
              >
                <HugeiconsIcon icon={Key01Icon} size={14} />
                <span>{isProcessing ? t("vault.unlock.unlocking") : t("vault.unlock.button")}</span>
              </Button>
            </div>

            {error && <div className="text-[11px] text-destructive">{error}</div>}

            <div className="flex items-center justify-between pt-2 border-t border-border/40">
              <span className="text-[11px] text-muted-foreground">
                {t("vault.unlock.forgotPrompt")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsWipeDialogOpen(true)}
                className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1 cursor-pointer"
              >
                <HugeiconsIcon icon={Alert02Icon} size={13} />
                <span>{t("vault.unlock.wipeOption")}</span>
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Case 3: Vault Configured and Unlocked */}
      {isConfigured && isUnlocked && (
        <div className="flex flex-col gap-4">
          {/* Top Control Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {t("vault.status.unlocked")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                ({items.length} {items.length === 1 ? t("vault.status.itemSingle") : t("vault.status.itemPlural")})
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>{t("vault.status.autoLock")}:</span>
                <Select
                  value={String(autoLockMinutes)}
                  onValueChange={(v) => void setAutoLockMinutes(Number(v))}
                >
                  <SelectTrigger className="h-6.5 w-24 text-[10.5px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="5">{t("vault.status.minutes", { count: 5 })}</SelectItem>
                    <SelectItem value="15">{t("vault.status.minutes", { count: 15 })}</SelectItem>
                    <SelectItem value="30">{t("vault.status.minutes", { count: 30 })}</SelectItem>
                    <SelectItem value="60">{t("vault.status.hour", { count: 1 })}</SelectItem>
                    <SelectItem value="0">{t("vault.status.never")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={lockVault}
                className="h-6.5 text-[11px] gap-1 cursor-pointer"
                title={t("vault.actions.lockNow")}
              >
                <HugeiconsIcon icon={LockPasswordIcon} size={12} />
                <span>{t("vault.actions.lockNow")}</span>
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsChangePassDialogOpen(true)}
                className="h-6.5 text-[11px] gap-1 cursor-pointer"
              >
                <HugeiconsIcon icon={Key01Icon} size={12} />
                <span>{t("vault.actions.changePass")}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsWipeDialogOpen(true)}
                className="h-6.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive gap-1 cursor-pointer"
                title={t("vault.actions.wipeAllTitle")}
              >
                <HugeiconsIcon icon={Delete02Icon} size={12} />
                <span>{t("vault.actions.wipeAll")}</span>
              </Button>
            </div>
          </div>

          {/* Action Row & Search */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-1 items-center gap-2 max-w-sm">
              <div className="relative flex-1">
                <HugeiconsIcon
                  icon={Search01Icon}
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("vault.searchPlaceholder")}
                  className="h-8 pl-8 text-xs"
                />
              </div>
            </div>

            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setEditingItem(null);
                setIsItemDialogOpen(true);
              }}
              className="h-8 gap-1.5 text-xs cursor-pointer"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} />
              <span>{t("vault.actions.addKey")}</span>
            </Button>
          </div>

          {/* Type Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {(
              [
                { id: "all", label: t("vault.filters.all") },
                { id: "ssh_key", label: t("vault.types.ssh_key") },
                { id: "ssh_passphrase", label: t("vault.types.ssh_passphrase") },
                { id: "api_key", label: t("vault.types.api_key") },
                { id: "token", label: t("vault.types.token") },
                { id: "generic_secret", label: t("vault.types.generic_secret") },
              ] as const
            ).map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setTypeFilter(filter.id)}
                className={cn(
                  "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap",
                  typeFilter === filter.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {/* Items List */}
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/80 p-8 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <HugeiconsIcon icon={Key01Icon} size={20} />
              </div>
              <h4 className="text-xs font-semibold text-foreground">
                {items.length === 0 ? t("vault.empty.title") : t("vault.empty.noFilterResults")}
              </h4>
              <p className="text-[11px] text-muted-foreground max-w-xs leading-relaxed">
                {items.length === 0
                  ? t("vault.empty.description")
                  : t("vault.empty.filterDescription")}
              </p>
              {items.length === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingItem(null);
                    setIsItemDialogOpen(true);
                  }}
                  className="mt-1 gap-1.5 text-xs cursor-pointer"
                >
                  <HugeiconsIcon icon={PlusSignIcon} size={14} />
                  <span>{t("vault.actions.addKey")}</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {filteredItems.map((item) => {
                const IconComponent = getItemTypeIcon(item.type);
                const isSecretVisible = !!visibleSecrets[item.id];

                return (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2.5 rounded-lg border border-border/70 bg-card p-3 shadow-2xs transition-colors hover:border-border"
                  >
                    {/* Item Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/70 text-foreground">
                          <HugeiconsIcon icon={IconComponent} size={15} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-foreground truncate">
                              {item.name}
                            </span>
                            <span className="rounded bg-muted/60 px-1.5 py-0.2 text-[9.5px] font-medium text-muted-foreground">
                              {t(`vault.types.${item.type}`)}
                            </span>
                          </div>
                          {item.description && (
                            <span className="text-[11px] text-muted-foreground truncate">
                              {item.description}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditingItem(item);
                            setIsItemDialogOpen(true);
                          }}
                          className="h-7 w-7 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                          title={t("common.edit")}
                        >
                          <HugeiconsIcon icon={Edit01Icon} size={13} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            const ok = await deleteItem(item.id);
                            if (ok) toast.success(t("vault.deletedToast"));
                          }}
                          className="h-7 w-7 p-0 cursor-pointer text-destructive/80 hover:text-destructive hover:bg-destructive/10"
                          title={t("common.delete")}
                        >
                          <HugeiconsIcon icon={Delete02Icon} size={13} />
                        </Button>
                      </div>
                    </div>

                    {/* Secret Preview & Copy Controls */}
                    <div className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 font-mono text-[11px]">
                      <div className="flex-1 truncate select-all text-muted-foreground">
                        {isSecretVisible ? (
                          <span className="text-foreground">{item.secret}</span>
                        ) : (
                          <span>••••••••••••••••••••••••</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleSecretVisibility(item.id)}
                        className="h-6 w-6 p-0 cursor-pointer text-muted-foreground hover:text-foreground"
                        title={isSecretVisible ? t("vault.hideSecret") : t("vault.showSecret")}
                      >
                        <HugeiconsIcon
                          icon={isSecretVisible ? ViewOffSlashIcon : ViewIcon}
                          size={13}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(item.secret, item.name)}
                        className="h-6 px-1.5 text-[10px] gap-1 cursor-pointer text-muted-foreground hover:text-foreground"
                        title={t("vault.copySecret")}
                      >
                        <HugeiconsIcon icon={Copy01Icon} size={12} />
                        <span>{t("vault.copySecret")}</span>
                      </Button>
                    </div>

                    {/* SSH Specific Actions */}
                    {item.type === "ssh_key" && (
                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-border/30 text-[10px]">
                        <div className="flex items-center gap-1.5">
                          {item.publicKey && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                copyToClipboard(item.publicKey!, `${item.name} (Public Key)`)
                              }
                              className="h-6 px-1.5 text-[10.5px] gap-1 cursor-pointer"
                            >
                              <HugeiconsIcon icon={Copy01Icon} size={11} />
                              <span>{t("vault.copyPublicKey")}</span>
                            </Button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              downloadFile(
                                `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.pem`,
                                item.secret,
                              )
                            }
                            className="h-6 px-1.5 text-[10.5px] gap-1 cursor-pointer"
                            title={t("vault.downloadPem")}
                          >
                            <HugeiconsIcon icon={Download01Icon} size={11} />
                            <span>.pem</span>
                          </Button>
                          {item.publicKey && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                downloadFile(
                                  `${item.name.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}.pub`,
                                  item.publicKey!,
                                )
                              }
                              className="h-6 px-1.5 text-[10.5px] gap-1 cursor-pointer"
                              title={t("vault.downloadPub")}
                            >
                              <HugeiconsIcon icon={Download01Icon} size={11} />
                              <span>.pub</span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      <VaultItemDialog
        open={isItemDialogOpen}
        onOpenChange={setIsItemDialogOpen}
        item={editingItem}
        onSave={async (data) => {
          if (editingItem) {
            const ok = await updateItem(editingItem.id, data);
            if (ok) toast.success(t("vault.updatedToast"));
            return ok;
          }
          const newItem = await addItem(data);
          if (newItem) toast.success(t("vault.addedToast"));
          return !!newItem;
        }}
      />

      <WipeVaultDialog
        open={isWipeDialogOpen}
        onOpenChange={setIsWipeDialogOpen}
        onConfirmWipe={async () => {
          const ok = await wipeVault();
          if (ok) toast.success(t("vault.wipedToast"));
          return ok;
        }}
      />

      <ChangeMasterPasswordDialog
        open={isChangePassDialogOpen}
        onOpenChange={setIsChangePassDialogOpen}
        onChangePassword={async (oldPass, newPass) => {
          return changeMasterPassword(oldPass, newPass);
        }}
      />
    </div>
  );
}
