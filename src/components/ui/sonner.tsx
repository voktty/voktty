import { useTheme } from "@/modules/theme";
import { Toaster as Sonner, type ToasterProps } from "sonner";
// Bundled sheet: sonner's runtime-injected <style> is blocked when the CSP carries a style nonce.
import "sonner/dist/styles.css";

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedMode } = useTheme();

  return (
    <Sonner
      theme={resolvedMode}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
