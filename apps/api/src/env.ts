/**
 * NEW-SEC-13: required env vars fail fast at boot — no silent localhost
 * fallbacks that would point a misconfigured deploy at a default database.
 */
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set — refusing to boot without it`);
  }
  return value;
}
