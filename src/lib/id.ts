import { ulid } from "ulid";

// Small wrapper so the rest of the codebase doesn't have to know which
// ULID library we use (we may swap to a Web Crypto-based impl later).
export function newId(): string {
  return ulid();
}
