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

/** The public projection. `passwordHash` never leaves this module. */
export type PublicUser = Omit<User, 'passwordHash'>;

export function toPublicUser({ id, name, email }: User): PublicUser {
  return { id, name, email };
}
