import type {
  StudentDashboardSnapshot as ApiStudentSnapshot,
  TeacherDashboardSnapshot as ApiTeacherSnapshot,
} from "@vijeeta/api-contracts";
import type {
  StudentDashboardSnapshot,
  StudentTestStatus,
} from "@/features/student/student-dashboard";
import type { TeacherDashboardSnapshot } from "@/features/teacher/teacher-dashboard";

export function toTeacherView(_snapshot: ApiTeacherSnapshot): TeacherDashboardSnapshot {
  const snapshot = _snapshot;
  const individualByStudent = new Map(
    snapshot.insights.individual.map((entry) => [entry.studentId, entry]),
  );
  const totalStudents = snapshot.classes.reduce(
    (total, entry) => total + entry.roster.length,
    0,
  );

  return {
    scenario: "ready",
    teacher: {
      name: snapshot.session.displayName,
      organisation: snapshot.organisation.name,
    },
    classes: snapshot.classes.map((entry) => ({
      id: entry.id,
      name: entry.name,
      studentCount: entry.roster.length,
      subject: entry.subject,
    })),
    roster: snapshot.classes.flatMap((entry) =>
      entry.roster.map((student) => {
        const insight = individualByStudent.get(student.id);
        return {
          id: student.id,
          name: student.displayName,
          email: student.email ?? "Email pending",
          status: insight?.status === "attempted" ? "attempted" : "not-attempted",
          score: insight?.score === null || insight?.score === undefined
            ? undefined
            : `${formatNumber(insight.score)} marks`,
        };
      }),
    ),
    invitations: snapshot.invites.map((invite) => ({
      id: invite.id,
      recipient: invite.email,
      channel: "email",
      state: "created",
    })),
    tests: snapshot.quickTests.map((draft) => {
      const assignment = snapshot.assignments.find(
        (entry) => entry.testId === draft.id,
      );
      const assignedClass = assignment?.recipients.find(
        (recipient) => recipient.kind === "class",
      );
      return {
        id: draft.id,
        title: `${draft.topic} quick test`,
        topic: draft.topic,
        questionCount: draft.questionCount,
        difficulty: capitalizeDifficulty(draft.difficulty),
        status: assignment ? "assigned" : "draft",
        assignedClassId: assignedClass?.kind === "class" ? assignedClass.id : undefined,
        attemptedCount: snapshot.insights.aggregate.attempted,
        totalStudents,
      };
    }),
    insights: {
      attemptedCount: snapshot.insights.aggregate.attempted,
      totalStudents,
      averageScore: `${formatNumber(snapshot.insights.aggregate.averageScore)} marks`,
      strongestTopic: snapshot.quickTests[0]?.topic ?? "Awaiting first result",
      students: snapshot.insights.individual.map((entry) => ({
        studentId: entry.studentId,
        summary:
          entry.status === "attempted"
            ? `${formatNumber(entry.score ?? 0)} marks · ready for review`
            : "Needs a first attempt",
      })),
    },
  };
}

export function toStudentView(_snapshot: ApiStudentSnapshot): StudentDashboardSnapshot {
  const snapshot = _snapshot;
  let waitingIndex = 0;
  const tests = snapshot.assignments.map((assignment) => {
    const attempt = snapshot.attempts.find(
      (entry) => entry.assignmentId === assignment.id,
    );
    const result = snapshot.results.find(
      (entry) => entry.assignmentId === assignment.id,
    );
    const waitingStatus: StudentTestStatus = waitingIndex === 0 ? "assigned" : "pending";
    const status: StudentTestStatus = result
      ? "submitted"
      : attempt?.status === "in-progress"
        ? "in-progress"
        : waitingStatus;
    if (!result && attempt?.status !== "in-progress") waitingIndex += 1;

    return {
      id: assignment.id,
      title: assignment.title,
      classId:
        assignment.recipients.find((recipient) => recipient.kind === "class")?.kind === "class"
          ? assignment.recipients.find((recipient) => recipient.kind === "class")?.id
          : undefined,
      subject: snapshot.classes[0]?.subject,
      status,
      dueAt: status === "pending" ? "Friday, 2:00 PM" : "Today, 6:00 PM",
      durationMinutes: 20,
      questionCount: attempt?.questions?.length ?? 10,
      score: result?.score,
      totalMarks: result?.totalMarks,
      resultSummary: result ? "Attempt recorded in your local learning history." : undefined,
    };
  });
  const scoredMarks = snapshot.results.reduce((total, result) => total + result.score, 0);
  const totalMarks = snapshot.results.reduce((total, result) => total + result.totalMarks, 0);

  return {
    status: "ready",
    student: {
      id: snapshot.session.userId,
      name: snapshot.session.displayName,
      grade: "Class 11",
    },
    classes: snapshot.classes.map((entry) => ({
      id: entry.id,
      name: entry.name,
      subject: entry.subject,
      teacherName: "Meera Shah",
    })),
    tests,
    selectedTestId:
      tests.find((test) => test.status === "assigned")?.id ?? tests[0]?.id,
    insights: {
      testsCompleted: snapshot.insights.personal.attempted,
      averageScore: totalMarks > 0 ? `${Math.round((scoredMarks / totalMarks) * 100)}%` : "—",
      focusArea: "Motion and graphs",
    },
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function capitalizeDifficulty(
  value: "easy" | "medium" | "hard" | "mixed",
): "Easy" | "Mixed" | "Hard" {
  if (value === "hard") return "Hard";
  if (value === "easy") return "Easy";
  return "Mixed";
}
