import {
  useId,
  useSyncExternalStore,
  type HTMLAttributes,
  type ReactNode,
} from "react";

const WIDE_RECORDS_QUERY = "(min-width: 48rem)";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  title: string;
  children: ReactNode;
}

export function Card({ children, className, title, ...props }: CardProps) {
  const titleId = `vjt-card-${useId()}`;

  return (
    <section
      {...props}
      aria-labelledby={titleId}
      className={["vjt-card", className].filter(Boolean).join(" ")}
    >
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}

export interface MetricProps extends HTMLAttributes<HTMLDListElement> {
  label: string;
  value: ReactNode;
}

export function Metric({ className, label, value, ...props }: MetricProps) {
  return (
    <dl
      {...props}
      className={["vjt-metric", className].filter(Boolean).join(" ")}
    >
      <dt className="vjt-metric__label">{label}</dt>
      <dd className="vjt-metric__value">{value}</dd>
    </dl>
  );
}

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({
  action,
  className,
  description,
  title,
  ...props
}: EmptyStateProps) {
  const titleId = `vjt-empty-${useId()}`;

  return (
    <div
      {...props}
      aria-labelledby={titleId}
      className={["vjt-empty-state", className].filter(Boolean).join(" ")}
      role="status"
    >
      <h2 id={titleId}>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function Skeleton({
  className,
  label = "Loading",
  ...props
}: SkeletonProps) {
  return (
    <div {...props} aria-label={label} role="status">
      <span
        aria-hidden="true"
        className={["vjt-skeleton", className].filter(Boolean).join(" ")}
      />
    </div>
  );
}

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  cell: (record: T) => ReactNode;
}

export interface DataTableProps<T> {
  caption: string;
  columns: readonly DataColumn<T>[];
  records: readonly T[];
  getRecordId: (record: T) => string | number;
}

export function DataTable<T>({
  caption,
  columns,
  getRecordId,
  records,
}: DataTableProps<T>) {
  return (
    <table className="vjt-data-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col">
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={getRecordId(record)}>
            {columns.map((column) => (
              <td key={column.key}>{column.cell(record)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export interface RecordCardProps extends HTMLAttributes<HTMLElement> {
  label: string;
  children: ReactNode;
}

export function RecordCard({
  children,
  className,
  label,
  ...props
}: RecordCardProps) {
  return (
    <article
      {...props}
      aria-label={label}
      className={["vjt-record-card", className].filter(Boolean).join(" ")}
    >
      {children}
    </article>
  );
}

export interface ResponsiveRecordsProps<T> extends DataTableProps<T> {
  getRecordLabel: (record: T) => string;
  renderCard?: (record: T) => ReactNode;
}

export function ResponsiveRecords<T>({
  caption,
  columns,
  getRecordId,
  getRecordLabel,
  records,
  renderCard,
}: ResponsiveRecordsProps<T>) {
  const wide = useSyncExternalStore(
    subscribeToWideViewport,
    isWideViewport,
    () => false,
  );

  if (wide) {
    return (
      <DataTable
        caption={caption}
        columns={columns}
        getRecordId={getRecordId}
        records={records}
      />
    );
  }

  return (
    <div className="vjt-record-list">
      {records.map((record) => (
        <RecordCard key={getRecordId(record)} label={getRecordLabel(record)}>
          {renderCard ? (
            renderCard(record)
          ) : (
            <dl>
              {columns.map((column) => (
                <div key={column.key}>
                  <dt>{column.header}</dt>
                  <dd>{column.cell(record)}</dd>
                </div>
              ))}
            </dl>
          )}
        </RecordCard>
      ))}
    </div>
  );
}

function subscribeToWideViewport(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => undefined;
  }

  const media = window.matchMedia(WIDE_RECORDS_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function isWideViewport(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(WIDE_RECORDS_QUERY).matches
  );
}
