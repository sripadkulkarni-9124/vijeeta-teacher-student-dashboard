import { useId, type HTMLAttributes, type ReactNode } from "react";

export type FeedbackTone = "neutral" | "success" | "warning" | "danger";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: FeedbackTone;
}

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      {...props}
      className={["vjt-badge", className].filter(Boolean).join(" ")}
      data-tone={tone}
    />
  );
}

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  tone?: Exclude<FeedbackTone, "neutral">;
  children: ReactNode;
}

export function Alert({
  children,
  className,
  title,
  tone = "warning",
  ...props
}: AlertProps) {
  const titleId = `vjt-alert-${useId()}`;

  return (
    <div
      {...props}
      aria-labelledby={titleId}
      className={["vjt-alert", "vjt-feedback", className]
        .filter(Boolean)
        .join(" ")}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <strong id={titleId}>{title}</strong>
      <div>{children}</div>
    </div>
  );
}

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  tone?: FeedbackTone;
}

export function Toast({ className, tone = "neutral", ...props }: ToastProps) {
  return (
    <div
      {...props}
      className={["vjt-toast", "vjt-feedback", className]
        .filter(Boolean)
        .join(" ")}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    />
  );
}
