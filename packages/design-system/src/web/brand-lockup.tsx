import { useId, type HTMLAttributes } from "react";

export interface BrandLockupProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** Support line under the wordmark. */
  tagline?: string;
  /** `compact` suits dense app headers; `regular` suits entry and landing screens. */
  size?: "compact" | "regular";
}

/**
 * Vedantu product lockup. The mark is inline SVG so the brand needs no external
 * asset, and the wordmark stays real text for screen readers and search.
 */
export function BrandLockup({
  className,
  size = "regular",
  tagline = "by Vedantu",
  ...props
}: BrandLockupProps) {
  const gradientId = `vjt-brand-mark-${useId()}`;

  return (
    <div
      {...props}
      className={["vjt-brand-lockup", className].filter(Boolean).join(" ")}
      data-size={size}
    >
      <svg
        aria-hidden="true"
        className="vjt-brand-lockup__mark"
        focusable="false"
        viewBox="0 0 40 40"
        xmlns="http://www.w3.org/2000/svg"
      >
        <linearGradient id={gradientId} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="var(--vjt-brand-mark)" />
          <stop offset="1" stopColor="var(--vjt-brand-highlight)" />
        </linearGradient>
        <rect fill={`url(#${gradientId})`} height="40" rx="12" width="40" x="0" y="0" />
        <path
          d="M11 12.5 L20 28 L29 12.5"
          fill="none"
          stroke="var(--vjt-brand-mark-contrast)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3.5"
        />
      </svg>
      <span className="vjt-brand-lockup__text">
        <span className="vjt-brand-lockup__wordmark">ViJEEta</span>
        <span className="vjt-brand-lockup__tagline">{tagline}</span>
      </span>
    </div>
  );
}
