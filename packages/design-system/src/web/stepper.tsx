export interface Step {
  id: string;
  label: string;
}

export interface StepperProps {
  label: string;
  steps: readonly Step[];
  currentStepId: string;
}

export function Stepper({ currentStepId, label, steps }: StepperProps) {
  const currentIndex = steps.findIndex((step) => step.id === currentStepId);

  return (
    <ol aria-label={label} className="vjt-stepper">
      {steps.map((step, index) => {
        const state =
          index < currentIndex
            ? "Complete"
            : index === currentIndex
              ? "Current"
              : "Upcoming";

        return (
          <li
            aria-current={index === currentIndex ? "step" : undefined}
            className="vjt-stepper__item"
            data-state={state.toLowerCase()}
            key={step.id}
          >
            <span className="vjt-stepper__label">{step.label}</span>
            <span className="vjt-stepper__status">{state}</span>
          </li>
        );
      })}
    </ol>
  );
}
