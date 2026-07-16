import bcrypt from 'bcryptjs';

// bcrypt with a cost factor of 12: each hash takes ~100–250ms on purpose,
// which makes brute-forcing stolen hashes impractically slow.
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
