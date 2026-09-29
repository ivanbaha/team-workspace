export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
}

/** In-memory users store — replace with a real database in production. */
export const users: User[] = [
  { id: '1', name: 'Alice', email: 'alice@example.com', passwordHash: 'hashed_pw' },
  { id: '2', name: 'Bob', email: 'bob@example.com', passwordHash: 'hashed_pw' },
];

let lastId = Math.max(0, ...users.map((user) => Number(user.id)));

/**
 * The next user id: sequential, and never reused. `users.length + 1` would hand a deleted user's
 * id to the next registration while caches still hold entries for the old one. Sequential is still
 * predictable, though — a lookup for the next id before it exists caches a 404 that the create
 * has to clear, which is why every write path invalidates the id it creates.
 */
export function nextUserId(): string {
  lastId += 1;
  return String(lastId);
}

/** The public projection. `passwordHash` never leaves this module. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser({ id, name, email }: User): PublicUser {
  return { id, name, email };
}
