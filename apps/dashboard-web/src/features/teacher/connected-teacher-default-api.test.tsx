import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listClasses = vi.fn(async () => ({ classrooms: [], nextCursor: null }));
const getClassroomRoster = vi.fn(async () => ({ members: [], invitations: [], nextMemberCursor: null, nextInvitationCursor: null }));
const listAssignments = vi.fn(async () => ({ assignments: [], nextCursor: null }));

vi.mock("@/client/firebase-auth", () => ({
  createFirebaseAuth: () => ({ getIdToken: async () => "token" }),
}));
vi.mock("@/client/connected-api", () => ({
  // A fresh object each call, exactly like the real factory. The component must
  // not rebuild it on every render.
  createConnectedApi: () => ({ listClasses, getClassroomRoster, listAssignments }),
  ConnectedApiError: class extends Error {},
}));

const { ConnectedTeacherDashboard } = await import("./connected-teacher-dashboard");

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("teacher dashboard without a supplied api", () => {
  it("builds its api once instead of on every render", async () => {
    // Production renders it with no api prop. A default parameter would be
    // re-evaluated per render, re-firing the loaders forever.
    const { rerender } = render(<ConnectedTeacherDashboard onAuthorizationLost={() => undefined} />);
    await waitFor(() => expect(listClasses).toHaveBeenCalled());

    rerender(<ConnectedTeacherDashboard onAuthorizationLost={() => undefined} />);
    rerender(<ConnectedTeacherDashboard onAuthorizationLost={() => undefined} />);
    await waitFor(() => expect(screen.queryByText(/loading classes/i)).not.toBeInTheDocument());

    expect(listClasses).toHaveBeenCalledTimes(1);
  });
});
