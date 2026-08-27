import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./button";
import { Alert02Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { t } from "@/modules/i18n";

type Props = {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  name?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      `[ErrorBoundary${this.props.name ? `:${this.props.name}` : ""}] Uncaught error:`,
      error,
      errorInfo,
    );
  }

  public reset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError && this.state.error) {
      if (typeof this.props.fallback === "function") {
        return this.props.fallback(this.state.error, this.reset);
      }
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-xl bg-destructive/15 text-destructive ring-1 ring-destructive/30">
            <HugeiconsIcon icon={Alert02Icon} size={22} strokeWidth={2} />
          </div>
          <div className="max-w-md w-full">
            <h3 className="text-sm font-semibold text-foreground">
              {this.props.name
                ? t("feedback.errorIn", { name: this.props.name })
                : t("feedback.somethingWentWrong")}
            </h3>
            <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
              {this.state.error.message || t("feedback.unexpectedError")}
            </p>
            {this.state.error.stack && (
              <details className="mt-2 text-left bg-muted/40 rounded-lg p-2 border border-border/40 text-[10px] font-mono text-muted-foreground max-h-40 overflow-auto">
                <summary className="cursor-pointer font-semibold text-foreground hover:underline">
                  {t("feedback.stackTrace")}
                </summary>
                <pre className="mt-1 whitespace-pre-wrap">{this.state.error.stack}</pre>
              </details>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={this.reset}
            className="gap-1.5 text-xs"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={13} strokeWidth={2} />
            {t("feedback.tryAgain")}
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
