import { describe, expect, it } from "vitest";
import { isSupportedAsset, supportedAssets, tokenAddress } from "./networks.js";

describe("supported network assets", () => {
  it("uses the official cNGN deployment on every supported network", () => {
    expect(tokenAddress("polygon", "cNGN")).toBe("0x52828daa48C1a9A06F37500882b42daf0bE04C3B");
    expect(tokenAddress("bsc", "cNGN")).toBe("0xa8AEA66B361a8d53e8865c62D142167Af28Af058");
  });

  it("reports only explicitly configured network/token pairs", () => {
    expect(isSupportedAsset("polygon", "USDC")).toBe(true);
    expect(supportedAssets()).toHaveLength(6);
  });
});
