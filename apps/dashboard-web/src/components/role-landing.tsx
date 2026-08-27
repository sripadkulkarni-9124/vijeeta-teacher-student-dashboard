export interface RoleLandingProps {
  onSelectRole: (role: "teacher" | "student") => void;
}

export function RoleLanding({ onSelectRole }: RoleLandingProps) {
  return (
    <section aria-labelledby="role-entry-title">
      <span className="role-pill">Local fixture demo</span>
      <h1 id="role-entry-title">Choose your demo workspace</h1>
      <p>
        Explore the same class and test journey from either side. This simulated
        sign-in never contacts production authentication.
      </p>
      <div className="role-grid">
        <article className="role-card">
          <span aria-hidden="true">01 / TEACH</span>
          <div>
            <h2>Plan the next checkpoint</h2>
            <p>
              Invite a class, build a quick test, assign it, and inspect who
              needs attention.
            </p>
          </div>
          <Button onClick={() => onSelectRole("teacher")}>
            Continue as teacher
          </Button>
        </article>
        <article className="role-card">
          <span aria-hidden="true">02 / LEARN</span>
          <div>
            <h2>See the student view</h2>
            <p>
              Review classes, open an assignment, submit an attempt, and read
              personal insights.
            </p>
          </div>
          <Button onClick={() => onSelectRole("student")}>
            Continue as student
          </Button>
        </article>
      </div>
    </section>
  );
}
import { Button } from "@vijeeta/design-system";
