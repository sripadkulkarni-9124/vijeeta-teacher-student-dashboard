import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

function classes(...names: Array<string | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  variant?: "primary" | "secondary";
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = "Loading",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classes("vjt-button", `vjt-button--${variant}`, className)}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? loadingLabel : children}
    </button>
  );
}

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-label"
> {
  label: string;
  children: ReactNode;
}

export function IconButton({
  children,
  className,
  label,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      aria-label={label}
      className={classes("vjt-icon-button", className)}
      type={type}
    >
      <span aria-hidden="true">{children}</span>
    </button>
  );
}

export type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export function Link({ className, ...props }: LinkProps) {
  return <a {...props} className={classes("vjt-link", className)} />;
}
