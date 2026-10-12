import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { redactSensitive } from "@/modules/ai/lib/redact";
import { useTranslation } from "@/modules/i18n";
import {
  identityKey,
  identityOrganizationTag,
  useProviderAccountIdentities,
} from "@/modules/harness/lib/providerAccountIdentity";
import {
  displayProviderAccountLabel,
  newProviderAccount,
  providerAccounts,
  PROVIDER_ACCOUNT_PROVIDERS,
  removeProviderAccount,
  renameProviderAccount,
  saveProviderAccount,
  subscribeProviderAccounts,
  type ProviderAccount,
  type ProviderAccountProvider,
} from "@/modules/harness/lib/providerAccounts";
import { removeProviderAccountCredentials } from "@/modules/harness/lib/providerAccountCredentials";
import { loginHarness } from "@/modules/harness/lib/harness/auth";
import { HARNESS_TITLE } from "@/modules/harness/lib/session";
import { ProviderAccountSubtitle } from "@/modules/harness/chrome/ProviderAccountSubtitle";
import { HarnessIcon } from "@/modules/harness/chrome/HarnessIcon";
import { ask } from "@tauri-apps/plugin-dialog";
import { Loader, Pencil, Plus, Trash2 } from "../chrome/icons";
import { useEffect, useState, type FormEvent } from "react";

type AccountEditor = {
  provider: ProviderAccountProvider;
  accountId?: string;
  label: string;
};

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSensitive(message)
    .replace(/https?:\/\/\S+/gi, "sign-in link")
    .replace(/(?<![\w:])(?:[A-Za-z]:[\\/]|\/(?!\/))[^\s"'<>]+/g, "<path>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function HarnessProviderAccounts() {
  const { t } = useTranslation();
  const [version, setVersion] = useState(0);
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => subscribeProviderAccounts(() => setVersion((value) => value + 1)),
    [],
  );

  const accounts = PROVIDER_ACCOUNT_PROVIDERS.flatMap(providerAccounts);
  const identities = useProviderAccountIdentities(accounts, version);

  const submitEditor = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor?.label.trim() || working) return;
    const key = editor.accountId
      ? `rename:${editor.provider}:${editor.accountId}`
      : `add:${editor.provider}`;
    setWorking(key);
    setError(null);
    try {
      if (editor.accountId) {
        renameProviderAccount(editor.provider, editor.accountId, editor.label);
      } else {
        const account = newProviderAccount(editor.provider, editor.label);
        await loginHarness(editor.provider, account.id);
        saveProviderAccount(account);
      }
      setEditor(null);
    } catch (caught) {
      setError(safeError(caught) || t("harness.accounts.couldNotSaveAccount"));
    } finally {
      setWorking(null);
    }
  };

  const removeAccount = async (account: ProviderAccount) => {
    if (account.isDefault || working) return;
    const confirmed = await ask(
      t("harness.accounts.removeConfirm", { name: account.label }),
      {
        title: t("harness.accounts.removeAccountTitle", {
          name: HARNESS_TITLE[account.provider],
        }),
        kind: "warning",
        okLabel: t("harness.accounts.removeAccount"),
        cancelLabel: t("common.cancel"),
      },
    );
    if (!confirmed) return;
    const key = `remove:${account.provider}:${account.id}`;
    setWorking(key);
    setError(null);
    try {
      await removeProviderAccountCredentials(account.provider, account.id);
      removeProviderAccount(account.provider, account.id);
    } catch (caught) {
      setError(
        safeError(caught) || t("harness.accounts.couldNotRemoveAccount"),
      );
    } finally {
      setWorking(null);
    }
  };

  return (
    <section
      className="flex flex-col gap-2"
      data-setting-title={t("harness.accounts.settingsTitle")}
    >
      <div>
        <h2 className="text-[13px] font-semibold text-foreground">
          {t("harness.accounts.settingsTitle")}
        </h2>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          {t("harness.accounts.settingsDescription")}
        </p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
        {PROVIDER_ACCOUNT_PROVIDERS.map((provider) => {
          const providerAccountsList = providerAccounts(provider);
          const adding = editor?.provider === provider && !editor.accountId;
          return (
            <div key={provider} className="border-b border-border/40 last:border-b-0">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <HarnessIcon harness={provider} className="size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">
                    {HARNESS_TITLE[provider]}
                  </div>
                  <div className="text-[10.5px] text-muted-foreground">
                    {t("harness.accounts.accountCount", {
                      count: providerAccountsList.length,
                    })}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-[10.5px]"
                  disabled={Boolean(working)}
                  onClick={() => {
                    setError(null);
                    setEditor({ provider, label: "" });
                  }}
                >
                  <Plus className="size-3" aria-hidden />
                  {t("harness.accounts.addAccount")}
                </Button>
              </div>
              <div className="border-t border-border/40">
                {providerAccountsList.map((account) => {
                  const editing =
                    editor?.provider === provider &&
                    editor.accountId === account.id;
                  const identity = identities[identityKey(account)];
                  const orgTag = identityOrganizationTag(identity);
                  return editing ? (
                    <AccountEditor
                      key={account.id}
                      editor={editor}
                      working={Boolean(working)}
                      onLabel={(label) =>
                        setEditor((current) =>
                          current ? { ...current, label } : current,
                        )
                      }
                      onCancel={() => setEditor(null)}
                      onSubmit={submitEditor}
                    />
                  ) : (
                    <div
                      key={account.id}
                      className="flex min-h-11 items-center gap-2 border-b border-border/30 px-3 py-2 last:border-b-0"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate text-[11.5px] text-foreground/90">
                            {displayProviderAccountLabel(
                              account.label,
                              t("harness.accounts.defaultAccount"),
                            )}
                          </span>
                          {orgTag ? (
                            <span className="max-w-28 shrink-0 truncate rounded bg-muted px-1 text-[9px] leading-4 text-muted-foreground">
                              {orgTag}
                            </span>
                          ) : null}
                          {account.isDefault ? (
                            <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                              {t("common.default")}
                            </span>
                          ) : null}
                        </div>
                        <ProviderAccountSubtitle
                          identity={identity}
                          fallback={
                            account.isDefault
                              ? t("harness.accounts.providerCliProfile")
                              : t("harness.accounts.isolatedProfile")
                          }
                          className="mt-0.5 text-[10px] text-muted-foreground"
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        disabled={Boolean(working)}
                        aria-label={t("harness.accounts.renameNamed", {
                          name: account.label,
                        })}
                        title={t("harness.accounts.renameAccount")}
                        onClick={() => {
                          setError(null);
                          setEditor({
                            provider,
                            accountId: account.id,
                            label: account.label,
                          });
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      {!account.isDefault ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          disabled={Boolean(working)}
                          aria-label={t("harness.accounts.removeNamed", {
                            name: account.label,
                          })}
                          title={t("harness.accounts.removeAccount")}
                          onClick={() => void removeAccount(account)}
                        >
                          {working === `remove:${provider}:${account.id}` ? (
                            <Loader className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="size-3.5" aria-hidden />
                          )}
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                {adding && editor ? (
                  <AccountEditor
                    editor={editor}
                    working={Boolean(working)}
                    onLabel={(label) =>
                      setEditor((current) =>
                        current ? { ...current, label } : current,
                      )
                    }
                    onCancel={() => setEditor(null)}
                    onSubmit={submitEditor}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <p className="text-[11px] leading-4 text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function AccountEditor({
  editor,
  working,
  onLabel,
  onCancel,
  onSubmit,
}: {
  editor: AccountEditor;
  working: boolean;
  onLabel: (label: string) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  const adding = !editor.accountId;
  return (
    <form
      className="flex items-center gap-1.5 border-b border-border/30 px-3 py-2"
      onSubmit={onSubmit}
    >
      <Input
        autoFocus
        type="text"
        maxLength={48}
        value={editor.label}
        disabled={working}
        placeholder={t("harness.accounts.workOrPersonal")}
        aria-label={t(
          adding
            ? "harness.accounts.newNamedAccount"
            : "harness.accounts.renameNamedAccount",
          { name: HARNESS_TITLE[editor.provider] },
        )}
        onChange={(event) => onLabel(event.target.value)}
        className="h-8 min-w-0 flex-1 text-[11px]"
      />
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={working}
        onClick={onCancel}
        className="h-7 px-2 text-[10.5px]"
      >
        {t("common.cancel")}
      </Button>
      <Button
        type="submit"
        size="sm"
        disabled={working || !editor.label.trim()}
        className="h-7 px-2 text-[10.5px]"
      >
        {adding
          ? working
            ? t("harness.accounts.waitingForBrowser")
            : t("harness.accounts.signInAndAdd")
          : t("common.save")}
      </Button>
    </form>
  );
}
