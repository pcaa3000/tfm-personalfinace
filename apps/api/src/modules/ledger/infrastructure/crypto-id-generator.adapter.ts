import { randomUUID } from "node:crypto";


import type { IdGenerator } from "../application/ports/id-generator.port.js";

export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
