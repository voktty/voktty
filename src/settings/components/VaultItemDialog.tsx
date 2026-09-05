import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/modules/i18n";
import type { VaultItem, VaultItemType } from "@/modules/vault/types";
import { generatePassword, generateSshKeyPair } from "@/modules/vault/vaultCrypto";
import {
  Key01Icon,
  MagicWand01Icon,
  SecurityCheckIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: VaultItem | null;
  onSave: (data: Omit<VaultItem, "id" | "createdAt" | "updatedAt">) => Promise<boolean>;
};

export function VaultItemDialog({ open, onOpenChange, item, onSave }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [type, setType] = useState<VaultItemType>("ssh_key");
  const [secret, setSecret] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (item) {
      setName(item.name);
      setType(item.type);
      setSecret(item.secret);
      setPublicKey(item.publicKey ?? "");
      setDescription(item.description ?? "");
      setTags(item.tags ? item.tags.join(", ") : "");
    } else {
      setName("");
      setType("ssh_key");
      setSecret("");
      setPublicKey("");
      setDescription("");
      setTags("");
    }
  }, [open, item]);

  const handleGenerateSecret = () => {
    const generated = generatePassword(32, { symbols: true, numbers: true });
    setSecret(generated);
    toast.success(t("vault.dialog.generatedSecretSuccess"));
  };

  const handleGenerateSshKey = async (keyType: "rsa" | "ecdsa") => {
    setIsGenerating(true);
    try {
      const keys = await generateSshKeyPair(keyType);
      setSecret(keys.privateKey);
      setPublicKey(keys.publicKey);
      if (!name) {
        setName(`${keyType.toUpperCase()} SSH Key (${new Date().toLocaleDateString()})`);
      }
      toast.success(t("vault.dialog.generatedSshSuccess"));
    } catch {
      toast.error(t("vault.dialog.generatedSshError"));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !secret.trim()) {
      toast.error(t("vault.dialog.validationError"));
      return;
    }

    setIsSaving(true);
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const success = await onSave({
      name: name.trim(),
      type,
      secret: secret.trim(),
      publicKey: type === "ssh_key" && publicKey.trim() ? publicKey.trim() : undefined,
      description: description.trim() || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
    });

    setIsSaving(false);
    if (success) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden shadow-2xl border-border bg-popover text-popover-foreground">
        <DialogHeader className="p-5 pb-3 border-b border-border/40 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={item ? Key01Icon : SecurityCheckIcon} size={18} strokeWidth={1.75} />
            <span>{item ? t("vault.dialog.editTitle") : t("vault.dialog.newTitle")}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("vault.dialog.description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3.5">
            <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 flex flex-col gap-1">
              <Label htmlFor="vault-item-name" className="text-[11px] text-muted-foreground">
                {t("vault.dialog.nameLabel")} *
              </Label>
              <Input
                id="vault-item-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("vault.dialog.namePlaceholder")}
                className="h-8 text-xs"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px] text-muted-foreground">
                {t("vault.dialog.typeLabel")}
              </Label>
              <Select value={type} onValueChange={(v) => setType(v as VaultItemType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ssh_key">{t("vault.types.ssh_key")}</SelectItem>
                  <SelectItem value="ssh_passphrase">{t("vault.types.ssh_passphrase")}</SelectItem>
                  <SelectItem value="api_key">{t("vault.types.api_key")}</SelectItem>
                  <SelectItem value="token">{t("vault.types.token")}</SelectItem>
                  <SelectItem value="generic_secret">{t("vault.types.generic_secret")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="vault-item-secret" className="text-[11px] text-muted-foreground">
                {type === "ssh_key" ? t("vault.dialog.privateKeyLabel") : t("vault.dialog.secretLabel")} *
              </Label>
              <div className="flex items-center gap-1.5">
                {type === "ssh_key" ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isGenerating}
                      onClick={() => void handleGenerateSshKey("rsa")}
                      className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                    >
                      <HugeiconsIcon icon={MagicWand01Icon} size={12} />
                      <span>{t("vault.dialog.generateRsa")}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isGenerating}
                      onClick={() => void handleGenerateSshKey("ecdsa")}
                      className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                    >
                      <HugeiconsIcon icon={MagicWand01Icon} size={12} />
                      <span>{t("vault.dialog.generateEcdsa")}</span>
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleGenerateSecret}
                    className="h-6 px-2 text-[10px] gap-1 cursor-pointer"
                  >
                    <HugeiconsIcon icon={MagicWand01Icon} size={12} />
                    <span>{t("vault.dialog.generatePassword")}</span>
                  </Button>
                )}
              </div>
            </div>
            <Textarea
              id="vault-item-secret"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                type === "ssh_key"
                  ? "-----BEGIN OPENSSH PRIVATE KEY-----\n..."
                  : t("vault.dialog.secretPlaceholder")
              }
              rows={type === "ssh_key" ? 5 : 3}
              className="font-mono text-xs resize-none"
              required
            />
          </div>

          {type === "ssh_key" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="vault-item-public" className="text-[11px] text-muted-foreground">
                {t("vault.dialog.publicKeyLabel")}
              </Label>
              <Textarea
                id="vault-item-public"
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
                placeholder={t("vault.dialog.publicKeyPlaceholder")}
                rows={2}
                className="font-mono text-xs resize-none"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="vault-item-desc" className="text-[11px] text-muted-foreground">
                {t("vault.dialog.descriptionLabel")}
              </Label>
              <Input
                id="vault-item-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("vault.dialog.descriptionPlaceholder")}
                className="h-8 text-xs"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="vault-item-tags" className="text-[11px] text-muted-foreground">
                {t("vault.dialog.tagsLabel")}
              </Label>
              <Input
                id="vault-item-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="production, aws, git"
                className="h-8 text-xs"
              />
            </div>
            </div>
          </div>

          <DialogFooter className="p-3.5 px-5 border-t border-border/40 bg-muted/15 shrink-0 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="default"
              size="sm"
              disabled={isSaving}
              className="cursor-pointer"
            >
              {item ? t("common.save") : t("vault.dialog.addButton")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
