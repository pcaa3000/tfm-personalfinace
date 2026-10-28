import { randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";

import type { IdGenerator } from "../application/ports/id-generator.port.js";

@Injectable()
export class CryptoIdGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
