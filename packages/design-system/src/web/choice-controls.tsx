import { useId, type InputHTMLAttributes } from "react";

interface ChoiceProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: string;
}

function Choice({
  className,
  label,
  id,
  type,
  ...props
}: ChoiceProps & { type: "checkbox" | "radio" }) {
  const generatedId = useId();
  const controlId = id ?? `vjt-choice-${generatedId}`;

  return (
    <label className="vjt-choice" htmlFor={controlId}>
      <input
        {...props}
        className={[`vjt-${type}`, className].filter(Boolean).join(" ")}
        id={controlId}
        type={type}
      />
      <span>{label}</span>
    </label>
  );
}

export function Checkbox(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}

export function Radio(props: ChoiceProps) {
  return <Choice {...props} type="radio" />;
}

export function Switch({ className, label, id, ...props }: ChoiceProps) {
  const generatedId = useId();
  const controlId = id ?? `vjt-switch-${generatedId}`;

  return (
    <label className="vjt-choice" htmlFor={controlId}>
      <input
        {...props}
        className={["vjt-switch", className].filter(Boolean).join(" ")}
        id={controlId}
        role="switch"
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}
