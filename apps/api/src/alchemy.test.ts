import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { observationsFromAlchemy, validAlchemySignature } from "./routes/alchemy.js";

describe("Alchemy address activity ingestion", () => {
  it("verifies the signature against the unmodified request bytes", () => {
    const body = Buffer.from('{"type":"ADDRESS_ACTIVITY"}');
    const signature = createHmac("sha256", "polygon-signing-key").update(body).digest("hex");
    expect(validAlchemySignature(body, signature, "polygon-signing-key")).toBe(true);
    expect(validAlchemySignature(body, signature, "different-key")).toBe(false);
  });

  it("maps a Polygon USDT activity to the gateway's raw observation", () => {
    const observations = observationsFromAlchemy(
      {
        type: "ADDRESS_ACTIVITY",
        event: {
          network: "MATIC_MAINNET",
          activity: [
            {
              category: "token",
              fromAddress: "0x0000000000000000000000000000000000000001",
              toAddress: "0xF869600C4bFA1dFC61026f1996077ec2f1348AE4",
              hash: "0x04cd447d1f73a891318b30a421dd2997701d9ab6d32068c1ad4277ae54fbb259",
              blockNum: "0x58f3f63",
              rawContract: {
                address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
                rawValue: "0x186a0"
              },
              log: {
                logIndex: "0x551",
                blockHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                removed: false
              }
            }
          ]
        }
      },
      "polygon"
    );

    expect(observations).toEqual([
      expect.objectContaining({
        network: "polygon",
        tokenSymbol: "USDT",
        amountRaw: "100000",
        logIndex: 1361,
        toAddress: "0xF869600C4bFA1dFC61026f1996077ec2f1348AE4"
      })
    ]);
  });

  it("ignores removed logs and unrelated token contracts", () => {
    const base = {
      category: "token",
      fromAddress: "0x0000000000000000000000000000000000000001",
      toAddress: "0x0000000000000000000000000000000000000002",
      hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      blockNum: "0x1",
      rawContract: {
        address: "0x0000000000000000000000000000000000000003",
        rawValue: "0x1"
      },
      log: { logIndex: "0x0", removed: false }
    };
    expect(
      observationsFromAlchemy(
        {
          type: "ADDRESS_ACTIVITY",
          event: { activity: [base, { ...base, log: { logIndex: "0x0", removed: true } }] }
        },
        "bsc"
      )
    ).toEqual([]);
  });
});
