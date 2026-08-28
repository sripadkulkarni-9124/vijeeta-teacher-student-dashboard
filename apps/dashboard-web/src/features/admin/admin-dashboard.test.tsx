import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AdminAuditListResponse,
  AdminInvitationListResponse,
  AdminProfileListResponse,
  ClassroomListResponse,
  DashboardProfileV2,
} from "@vijeeta/api-contracts";

import { ADMIN_CLIENT_METHODS, AdminDashboard, type AdminDashboardApi } from "./admin-dashboard";

afterEach(() => document.body.replaceChildren());

const now = "2026-08-28T10:00:00.000Z";
const profile = (state: "pending" | "active" = "pending"): DashboardProfileV2 => ({
  internalProfileId: "profile-teacher",
  firebaseUid: "teacher-1",
  verifiedEmail: "teacher@example.test",
  displayName: "Leena Rao",
  roles: { teacher: state },
  activeRole: state === "active" ? "teacher" : null,
  onboardingCompleted: true,
  schemaVersion: 2,
  createdAt: now,
  updatedAt: now,
});

const profiles: AdminProfileListResponse = { profiles: [profile()], nextCursor: "profiles-next" };
const classrooms: ClassroomListResponse = {
  classrooms: [{ id: "class-1", ownerUid: "teacher-1", name: "Grade 12 Physics", status: "active", createdAt: now, updatedAt: now }],
  nextCursor: "classes-next",
};
const invitations: AdminInvitationListResponse = {
  invitations: [{ id: "invite-1", classroomId: "class-1", ownerUid: "teacher-1", tokenVersion: 1, expiresAt: now, status: "pending", delivery: "sent", acceptedUid: null, acceptedAt: null, createdAt: now, updatedAt: now }],
  nextCursor: "invites-next",
};
const audit: AdminAuditListResponse = {
  events: [{ id: "audit-1", actorUid: "admin-1", actorProfileId: "profile-admin", action: "teacher.approved", targetType: "profile", targetId: "teacher-1", reason: "Verified school lead", correlationId: "11111111-1111-4111-8111-111111111111", canonicalLogInsertId: "audit-1", createdAt: now }],
  nextCursor: "audit-next",
};

function api(overrides: Partial<AdminDashboardApi> = {}): AdminDashboardApi {
  return {
    listAdminProfiles: vi.fn(async () => profiles),
    approveTeacher: vi.fn(async () => ({ profile: profile("active") })),
    suspendTeacher: vi.fn(async () => ({ profile: profile("pending") })),
    listAdminClassrooms: vi.fn(async () => classrooms),
    archiveAdminClassroom: vi.fn(async () => ({ classroom: { ...classrooms.classrooms[0]!, status: "archived" as const } })),
    restoreAdminClassroom: vi.fn(async () => ({ classroom: classrooms.classrooms[0]! })),
    listAdminInvitations: vi.fn(async () => invitations),
    revokeAdminInvitation: vi.fn(async () => ({ invite: { ...invitations.invitations[0]!, status: "revoked" as const } })),
    redeliverAdminInvitation: vi.fn(async () => ({ invite: { ...invitations.invitations[0]!, delivery: "redelivery_requested" as const } })),
    listAdminAudit: vi.fn(async () => audit),
    ...overrides,
  };
}

describe("AdminDashboard", () => {
  it("renders typed profile, class, invitation, and immutable audit metadata with bounded pagination", async () => {
    const client = api();
    render(<AdminDashboard api={client} />);

    expect(screen.getByRole("status")).toHaveTextContent(/loading administration data/i);
    expect(await screen.findByText("Leena Rao")).toBeVisible();
    expect(screen.getByText("Grade 12 Physics")).toBeVisible();
    expect(screen.getByText("invite-1")).toBeVisible();
    expect(screen.getByText("teacher.approved")).toBeVisible();
    expect(screen.getAllByRole("table")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /load more profiles/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /load more profiles/i }));
    await waitFor(() => expect(client.listAdminProfiles).toHaveBeenLastCalledWith({ cursor: "profiles-next", limit: 50 }));
  });

  it("keeps protected status unchanged until a reasoned action succeeds and refreshes", async () => {
    let finish!: () => void;
    const pending = new Promise<{ profile: DashboardProfileV2 }>((resolve) => { finish = () => resolve({ profile: profile("active") }); });
    const list = vi.fn().mockResolvedValueOnce(profiles).mockResolvedValue({ profiles: [profile("active")], nextCursor: null });
    const client = api({ listAdminProfiles: list, approveTeacher: vi.fn(() => pending) });
    render(<AdminDashboard api={client} />);
    expect(await screen.findByText("Leena Rao")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /approve teacher leena rao/i }));
    const dialog = screen.getByRole("dialog", { name: /approve teacher/i });
    expect(within(dialog).getByText(/grants teacher workspace access/i)).toBeVisible();
    const confirm = within(dialog).getByRole("button", { name: /^approve teacher$/i });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Verified school lead" } });
    fireEvent.click(confirm);

    const profileTable = screen.getByRole("table", { name: /redacted dashboard profiles/i });
    expect(within(profileTable).getByText("Pending")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: /approving/i })).toBeDisabled();
    finish();
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(within(profileTable).getByText("Active")).toBeVisible());
    expect(screen.getByRole("status")).toHaveTextContent(/teacher approved.*refreshed/i);
  });

  it.each([
    ["archive class grade 12 physics", /archive class/i, /does not delete/i, "archiveAdminClassroom", /^archive class$/i],
    ["revoke invitation invite-1", /revoke invitation/i, /cannot be accepted/i, "revokeAdminInvitation", /^revoke invitation$/i],
    ["request redelivery for invitation invite-1", /request invitation redelivery/i, /delivery request.*does not confirm/i, "redeliverAdminInvitation", /^request redelivery$/i],
  ] as const)("requires an explicit bounded reason for %s", async (buttonName, dialogName, consequence, method, confirmName) => {
    const client = api();
    render(<AdminDashboard api={client} />);
    expect(await screen.findByText("Leena Rao")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(buttonName, "i") }));
    const dialog = screen.getByRole("dialog", { name: dialogName });
    expect(within(dialog).getByText(consequence)).toBeVisible();
    const reason = within(dialog).getByLabelText(/reason/i);
    expect(reason).toHaveAttribute("maxlength", "500");
    fireEvent.change(reason, { target: { value: "Reviewed by Admin" } });
    fireEvent.click(within(dialog).getByRole("button", { name: confirmName }));
    await waitFor(() => expect(client[method]).toHaveBeenCalledWith(expect.any(String), { reason: "Reviewed by Admin" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/data refreshed from the server/i);
  });

  it("restores keyboard focus to the invoking control when a dialog is cancelled", async () => {
    render(<AdminDashboard api={api()} />);
    const archive = await screen.findByRole("button", { name: /archive class grade 12 physics/i });
    archive.focus();
    fireEvent.click(archive);

    expect(screen.getByLabelText(/reason/i)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    await waitFor(() => expect(archive).toHaveFocus());

    fireEvent.click(archive);
    fireEvent.keyDown(screen.getByRole("dialog", { name: /archive class/i }), { key: "Escape" });
    await waitFor(() => expect(archive).toHaveFocus());
  });

  it("supports suspend and restore through reasoned server mutations", async () => {
    const activeProfiles = { profiles: [profile("active")], nextCursor: null };
    const archivedClasses = {
      classrooms: [{ ...classrooms.classrooms[0]!, status: "archived" as const }],
      nextCursor: null,
    };
    const client = api({
      listAdminProfiles: vi.fn(async () => activeProfiles),
      listAdminClassrooms: vi.fn(async () => archivedClasses),
    });
    render(<AdminDashboard api={client} />);

    fireEvent.click(await screen.findByRole("button", { name: /suspend teacher leena rao/i }));
    let dialog = screen.getByRole("dialog", { name: /suspend teacher/i });
    expect(dialog).toHaveTextContent(/data is retained/i);
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Eligibility review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^suspend teacher$/i }));
    await waitFor(() => expect(client.suspendTeacher).toHaveBeenCalledWith("teacher-1", { reason: "Eligibility review" }));

    fireEvent.click(screen.getByRole("button", { name: /restore class grade 12 physics/i }));
    dialog = screen.getByRole("dialog", { name: /restore class/i });
    expect(dialog).toHaveTextContent(/returns the archived class/i);
    fireEvent.change(within(dialog).getByLabelText(/reason/i), { target: { value: "Class resumes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^restore class$/i }));
    await waitFor(() => expect(client.restoreAdminClassroom).toHaveBeenCalledWith("class-1", { reason: "Class resumes" }));
  });

  it("renders bounded empty and generic error states without inventing counts", async () => {
    const emptyClient = api({
      listAdminProfiles: vi.fn(async () => ({ profiles: [], nextCursor: null })),
      listAdminClassrooms: vi.fn(async () => ({ classrooms: [], nextCursor: null })),
      listAdminInvitations: vi.fn(async () => ({ invitations: [], nextCursor: null })),
      listAdminAudit: vi.fn(async () => ({ events: [], nextCursor: null })),
    });
    const { unmount } = render(<AdminDashboard api={emptyClient} />);
    expect(await screen.findByText(/no loaded profiles match/i)).toBeVisible();
    expect(screen.getByText(/no classes are available/i)).toBeVisible();
    expect(screen.queryByText(/total users|total classes/i)).not.toBeInTheDocument();
    unmount();

    render(<AdminDashboard api={api({ listAdminProfiles: vi.fn(async () => { throw new Error("private detail"); }) })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed.*try again/i);
    expect(screen.queryByText(/private detail/i)).not.toBeInTheDocument();
  });

  it("renders safe failure correlation copy without changing the fetched status", async () => {
    const client = api({ archiveAdminClassroom: vi.fn(async () => { throw Object.assign(new Error("Denied"), { correlationId: "corr-safe" }); }) });
    render(<AdminDashboard api={client} />);
    expect(await screen.findByText("Grade 12 Physics")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /archive class grade 12 physics/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Class concluded" } });
    fireEvent.click(screen.getByRole("button", { name: /^archive class$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed.*corr-safe/i);
    expect(screen.getByText("Active")).toBeVisible();
  });

  it("rejects unsafe correlation references from rendered error copy", async () => {
    const client = api({ archiveAdminClassroom: vi.fn(async () => {
      throw Object.assign(new Error("Denied"), { correlationId: "Bearer secret-token" });
    }) });
    render(<AdminDashboard api={client} />);
    fireEvent.click(await screen.findByRole("button", { name: /archive class grade 12 physics/i }));
    fireEvent.change(screen.getByLabelText(/reason/i), { target: { value: "Class concluded" } });
    fireEvent.click(screen.getByRole("button", { name: /^archive class$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be completed.*try again/i);
    expect(screen.queryByText(/secret-token/i)).not.toBeInTheDocument();
  });

  it.each([401, 403])("clears protected tables on %s authorization loss and renders a neutral denied state", async (status) => {
    const client = api({ listAdminAudit: vi.fn(async () => { throw Object.assign(new Error("Forbidden"), { status }); }) });
    render(<AdminDashboard api={client} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/access could not be verified/i);
    expect(screen.queryByText("Leena Rao")).not.toBeInTheDocument();
    expect(screen.queryByText("Grade 12 Physics")).not.toBeInTheDocument();
  });

  it("has an exact Admin client allowlist and no student-sensitive content or controls", async () => {
    expect(ADMIN_CLIENT_METHODS).toEqual([
      "listAdminProfiles", "approveTeacher", "suspendTeacher", "listAdminClassrooms", "archiveAdminClassroom",
      "restoreAdminClassroom", "listAdminInvitations", "revokeAdminInvitation", "redeliverAdminInvitation", "listAdminAudit",
    ]);
    expect(ADMIN_CLIENT_METHODS.some((method) => /answer|grade|insight|bootstrap|token|digest|provider/i.test(method))).toBe(false);
    render(<AdminDashboard api={api()} />);
    expect(await screen.findByText("Leena Rao")).toBeVisible();
    expect(screen.queryByText(/student answers|individual insight|bootstrap allowlist|token digest|smtp password|provider payload/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /view answers|view grades|student insight/i })).not.toBeInTheDocument();
  });
});
