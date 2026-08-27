import { parseDashboardAction, type DashboardDispatchResult, type DashboardRole, type DashboardSnapshot, type StudentDashboardSnapshot, type TeacherDashboardSnapshot } from "@vijeeta/api-contracts";
import { DashboardStore } from "./store";

export class DashboardService {
  constructor(private readonly store: DashboardStore = new DashboardStore()) {}

  snapshot(role: "teacher"): Promise<TeacherDashboardSnapshot>;
  snapshot(role: "student"): Promise<StudentDashboardSnapshot>;
  snapshot(role: DashboardRole): Promise<DashboardSnapshot>;
  snapshot(role: DashboardRole) {
    return this.store.snapshot(role);
  }

  dispatch(input: unknown): Promise<DashboardDispatchResult> {
    return this.store.dispatch(parseDashboardAction(input));
  }

  getSnapshot(role: DashboardRole) {
    return this.snapshot(role);
  }

  handleAction(input: unknown): Promise<DashboardDispatchResult> {
    return this.dispatch(input);
  }
}
