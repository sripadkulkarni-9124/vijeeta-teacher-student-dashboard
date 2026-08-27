import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";

export type FieldControlProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  | "aria-describedby"
  | "aria-errormessage"
  | "aria-invalid"
  | "className"
  | "id"
  | "required"
>;

export interface FieldProps {
  label: string;
  children: (props: FieldControlProps) => ReactNode;
  error?: string;
  support?: string;
  required?: boolean;
}

export function Field({
  children,
  error,
  label,
  required = false,
  support,
}: FieldProps) {
  const generatedId = useId();
  const controlId = `vjt-field-${generatedId}`;
  const supportId = support ? `${controlId}-support` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [supportId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="vjt-field">
      <label className="vjt-field__label" htmlFor={controlId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children({
        "aria-describedby": describedBy,
        "aria-errormessage": errorId,
        "aria-invalid": error ? true : undefined,
        className: "vjt-input",
        id: controlId,
        required,
      })}
      {support ? (
        <span className="vjt-field__support" id={supportId}>
          {support}
        </span>
      ) : null}
      {error ? (
        <span className="vjt-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "children"
> {
  label: string;
  options: readonly SelectOption[];
  error?: string;
  support?: string;
}

export function Select({
  className,
  error,
  id,
  label,
  options,
  required = false,
  support,
  ...props
}: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? `vjt-select-${generatedId}`;
  const supportId = support ? `${controlId}-support` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [supportId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="vjt-field">
      <label className="vjt-field__label" htmlFor={controlId}>
        {label}
        {required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <select
        {...props}
        aria-describedby={describedBy}
        aria-errormessage={errorId}
        aria-invalid={error ? true : undefined}
        className={["vjt-select", className].filter(Boolean).join(" ")}
        id={controlId}
        required={required}
      >
        {options.map((option) => (
          <option
            disabled={option.disabled}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </option>
        ))}
      </select>
      {support ? (
        <span className="vjt-field__support" id={supportId}>
          {support}
        </span>
      ) : null}
      {error ? (
        <span className="vjt-field__error" id={errorId}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
