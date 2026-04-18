/**
 * Auth.js wrapper. In production this calls `auth()` from NextAuth v5
 * and throws a 401 if the request is unauthenticated.
 */
export interface AuthedUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

export interface AuthedSession {
  user: AuthedUser;
}

export async function requireUser(): Promise<AuthedSession> {
  throw new Error("requireUser() not wired. Implement with @auth/nextjs v5.");
}

export async function requireAdmin(): Promise<AuthedSession> {
  const s = await requireUser();
  if (s.user.role !== "ADMIN") throw new Error("Forbidden");
  return s;
}
