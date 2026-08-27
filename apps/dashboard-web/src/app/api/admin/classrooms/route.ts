import { ClassroomListResponseSchema } from "@vijeeta/api-contracts";

import type { ClassroomRepository } from "../../../../server/dashboard-store";
import { HttpError, jsonResponse, parsePagination, serveHttp } from "../../../../server/http";
import {
  authorizeAdmin,
  productionAdminDependencies,
  productionDependencyError,
  type AdminRouteDependencies,
} from "../route-support";

interface AdminClassroomsRouteDependencies extends AdminRouteDependencies {
  classrooms: ClassroomRepository;
}

export function createAdminClassroomsRouteHandlers(dependencies: AdminClassroomsRouteDependencies) {
  return {
    GET: (request: Request) => serveHttp(request, async ({ correlationId }) => {
      const principal = await authorizeAdmin(request, dependencies);
      const page = parsePagination(request);
      const repositoryItems = await dependencies.classrooms.listForPrincipal(principal);
      const classrooms = ClassroomListResponseSchema.parse({
        classrooms: repositoryItems,
        nextCursor: null,
      }).classrooms.sort((left, right) => (
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
      ));
      const offset = page.cursor === undefined ? 0 : offsetAfterCursor(classrooms, page.cursor);
      const items = classrooms.slice(offset, offset + page.limit);
      const last = items.at(-1);
      const nextCursor = offset + items.length < classrooms.length && last !== undefined
        ? encodeClassroomCursor(last.updatedAt, last.id)
        : null;
      const body = ClassroomListResponseSchema.parse({
        classrooms: items,
        nextCursor,
      });
      return jsonResponse(body, { correlationId });
    }, { createCorrelationId: dependencies.createCorrelationId }),
  };
}

interface ClassroomCursor {
  version: 1;
  scope: "adminClassrooms";
  updatedAt: string;
  id: string;
}

function encodeClassroomCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    scope: "adminClassrooms",
    updatedAt,
    id,
  } satisfies ClassroomCursor)).toString("base64url");
}

function offsetAfterCursor(
  classrooms: Array<{ id: string; updatedAt: string }>,
  serialized: string,
): number {
  try {
    const decoded = Buffer.from(serialized, "base64url");
    if (decoded.toString("base64url") !== serialized) throw new Error("Non-canonical cursor");
    const candidate: unknown = JSON.parse(decoded.toString("utf8"));
    if (typeof candidate !== "object" || candidate === null) throw new Error("Invalid cursor");
    const cursor = candidate as Record<string, unknown>;
    const keys = Object.keys(cursor).sort();
    if (keys.length !== 4
      || keys[0] !== "id"
      || keys[1] !== "scope"
      || keys[2] !== "updatedAt"
      || keys[3] !== "version"
      || cursor.version !== 1
      || cursor.scope !== "adminClassrooms"
      || typeof cursor.updatedAt !== "string"
      || cursor.updatedAt.length > 64
      || !Number.isFinite(Date.parse(cursor.updatedAt))
      || typeof cursor.id !== "string") {
      throw new Error("Invalid cursor fields");
    }
    const index = classrooms.findIndex((classroom) => (
      classroom.id === cursor.id && classroom.updatedAt === cursor.updatedAt
    ));
    if (index < 0) throw new Error("Cursor target is unavailable");
    return index + 1;
  } catch {
    throw new HttpError(400, "invalid_request", "Request validation failed");
  }
}

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = await productionAdminDependencies();
    return createAdminClassroomsRouteHandlers(dependencies).GET(request);
  } catch (error) {
    return productionDependencyError(request, error);
  }
}
