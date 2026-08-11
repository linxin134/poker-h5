import { describe, expect, it } from "vitest";
import { createUuid } from "../src/lib/uuid";

describe("createUuid", () => {
  it("uses getRandomValues when randomUUID is unavailable on HTTP", () => {
    let seed = 0;
    const insecureHttpCrypto = {
      getRandomValues<T extends ArrayBufferView>(array: T) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = seed++;
        return array;
      }
    } as Pick<Crypto, "getRandomValues">;

    expect(createUuid(insecureHttpCrypto)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
