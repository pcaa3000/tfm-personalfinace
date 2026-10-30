import { Injectable } from "@nestjs/common";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { CallerResolverPort } from "../../application/caller-resolver.port.js";
import type { CallerIdentity } from "../../application/workspace-context.port.js";

/** Asymmetric algorithms only — symmetric secrets are never accepted. */
const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

export interface OidcConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUri: string;
}

/**
 * Production resolver (AUTH_MODE=oidc): validates the Authorization Bearer
 * JWT against the provider's remote JWKS — signature, algorithm allowlist,
 * issuer, audience, exp/nbf. For Supabase Auth, issuer is
 * "<project>.supabase.co/auth/v1" and audience is "authenticated".
 * Any failure yields null → generic 401, never account existence hints.
 */
@Injectable()
export class JwtCallerResolver implements CallerResolverPort {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: OidcConfig) {
    this.jwks = createRemoteJWKSet(new URL(config.jwksUri));
  }

  async resolve(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<CallerIdentity | null> {
    const raw = headers["authorization"];
    const header = Array.isArray(raw) ? raw[0] : raw;
    const token = header?.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : null;
    if (!token) {
      return null;
    }

    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ALLOWED_ALGORITHMS,
      });
      if (!payload.sub) {
        return null;
      }
      return { issuer: payload.iss ?? this.config.issuer, subject: payload.sub };
    } catch {
      return null;
    }
  }
}
