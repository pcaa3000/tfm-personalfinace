import type { AddressInfo } from "node:net";

import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

import { AppModule } from "../src/composition/app.module.js";

/**
 * Shared helpers for HTTP e2e specs against the real Nest app + Docker
 * Postgres. Cleanup is scoped to workspaces whose identityKey contains
 * "|e2e-" (dev subjects "local|e2e-*" and OIDC subjects "…|e2e-*"), so
 * dev data is never touched.
 */

export const prisma = new PrismaClient();

export interface ApiResponse<T> {
  status: number;
  body: T;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface TxView {
  id: string;
  workspaceId: string;
  type: string;
  amount: string;
  currency: string;
  concept: string;
  accountId: string | null;
  categoryId: string | null;
  status: string;
  revisionCount: number;
}

export interface AccountView {
  id: string;
  workspaceId: string;
  name: string;
  currency: string;
  kind: string;
  initialBalance: string;
}

export interface RevisionView {
  kind: string;
  revisionNumber: number;
  actor: string;
  changes: Array<{ field: string; previous: string; next: string }>;
}

export interface CategoryView {
  id: string;
  key: string;
  label: string;
  nature: string;
  custom: boolean;
}

let baseUrl = "";

export async function bootApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return app;
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<ApiResponse<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}

/**
 * Wipes workspaces, transactions and revisions created by e2e identities.
 * Each spec file owns a disjoint marker ("|e2e-dev-", "|e2e-oidc-") so
 * parallel vitest workers never delete each other's fixtures mid-test.
 */
export async function cleanE2eData(marker: string): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { identityKey: { contains: marker } },
    select: { id: true },
  });
  const ids = workspaces.map((w) => w.id);
  await prisma.transaction.deleteMany({ where: { workspaceId: { in: ids } } });
  await prisma.account.deleteMany({ where: { workspaceId: { in: ids } } });
  await prisma.workspace.deleteMany({
    where: { identityKey: { contains: marker } },
  });
}

export async function ensureGlobalCategory(): Promise<string> {
  const existing = await prisma.category.findFirst({
    where: { key: "e2e-food", workspaceId: null },
  });
  const category =
    existing ??
    (await prisma.category.create({
      data: {
        key: "e2e-food",
        label: "E2E Food",
        nature: "essential",
        workspaceId: null,
      },
    }));
  return category.id;
}
