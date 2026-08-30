import { BrandLockup, Button } from "@vijeeta/design-system";

export interface RoleLandingProps {
  onSelectRole: (role: "teacher" | "student") => void;
}

export function RoleLanding({ onSelectRole }: RoleLandingProps) {
  return (
    <section aria-labelledby="role-entry-title">
      <BrandLockup />
      <h1 id="role-entry-title">Are you a teacher or a student?</h1>
      <p>
        Pick the way you will use ViJEEta. You can change this later from your
        profile.
      </p>
      <div className="role-grid">
        <article className="role-card">
          <span aria-hidden="true">01 / TEACH</span>
          <div>
            <h2>I teach a class</h2>
            <p>
              Invite a class, build a quick test, share it by link or email, and
              see who needs attention.
            </p>
          </div>
          <Button onClick={() => onSelectRole("teacher")}>
            Continue as teacher
          </Button>
        </article>
        <article className="role-card">
          <span aria-hidden="true">02 / LEARN</span>
          <div>
            <h2>I am preparing for an exam</h2>
            <p>
              Join a class, open the tests your teacher shares, submit an
              attempt, and read your personal insights.
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
