import { auth } from "./config";

export interface AuthedUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface AuthedSession {
  user: AuthedUser;
}

export async function requireUser(): Promise<AuthedSession> {
  const session = await auth();
  if (!session?.user) {
    const e: any = new Error("Unauthorized");
    e.status = 401;
    throw e;
  }
  const u = session.user as any;
  return {
    user: {
      id: u.id,
      email: u.email!,
      role: u.role ?? "USER",
    },
  };
}

export async function requireAdmin(): Promise<AuthedSession> {
  const s = await requireUser();
  if (s.user.role !== "ADMIN") {
    const e: any = new Error("Forbidden");
    e.status = 403;
    throw e;
  }
  return s;
}
