import type { Hex } from "viem";

/*
  EIP-5792 batching — wallet_sendCalls.

  A wallet that supports it takes an array of calls, shows the payer ONE
  confirmation, and executes them atomically. That turns approve → swap → pay
  into a single signature and removes the window where someone has sold their
  token but not yet paid.

  Support is uneven (smart accounts have it, plain EOAs often don't), so every
  helper here returns null instead of throwing: the caller falls back to signing
  each step.
*/
type Provider = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };

type CallsStatus = {
  status?: string | number;
  receipts?: { transactionHash?: string; status?: string }[];
};

const hex = (n: number) => `0x${n.toString(16)}`;

/* Does this wallet actually accept batched calls on this chain? */
export async function supportsBatch(provider: Provider, chainId: number): Promise<boolean> {
  try {
    const caps = (await provider.request({
      method: "wallet_getCapabilities",
      params: [],
    })) as Record<string, { atomic?: { status?: string }; atomicBatch?: { supported?: boolean } }> | null;
    if (!caps) return false;
    const forChain = caps[hex(chainId)] ?? caps[String(chainId)];
    if (!forChain) return false;
    // 5792 went through two shapes: atomicBatch.supported, then atomic.status
    if (forChain.atomicBatch?.supported === true) return true;
    const s = forChain.atomic?.status;
    return s === "supported" || s === "ready";
  } catch {
    return false;
  }
}

/*
  Send the batch and resolve the hash of its LAST call — the fee transfer, which
  is what the server verifies. Polls because wallet_sendCalls returns an
  identifier, not a receipt.
*/
export async function sendCallsBatch(
  provider: Provider,
  from: string,
  chainId: number,
  calls: { to: string; data?: string; value?: string }[],
): Promise<Hex | null> {
  try {
    const raw = (await provider.request({
      method: "wallet_sendCalls",
      params: [
        {
          version: "2.0.0",
          chainId: hex(chainId),
          from,
          atomicRequired: true,
          calls: calls.map((c) => ({ to: c.to, data: c.data ?? "0x", value: c.value ?? "0x0" })),
        },
      ],
    })) as string | { id?: string } | null;
    if (!raw) return null;
    const id = typeof raw === "string" ? raw : raw.id;
    if (!id) return null;

    // up to ~3 minutes; the batch has to mine before the server can verify it
    for (let i = 0; i < 90; i++) {
      await new Promise((r) => setTimeout(r, 2_000));
      const st = (await provider
        .request({ method: "wallet_getCallsStatus", params: [id] })
        .catch(() => null)) as CallsStatus | null;
      if (!st) continue;
      const done = st.status === 200 || st.status === "CONFIRMED" || st.status === "success";
      const receipts = st.receipts ?? [];
      if (done && receipts.length > 0) {
        const last = receipts[receipts.length - 1];
        if (last?.status && /fail|revert|0x0/i.test(String(last.status))) return null;
        return (last?.transactionHash as Hex) ?? null;
      }
      // a failed batch reports 4xx/5xx — give up and let the caller fall back
      if (typeof st.status === "number" && st.status >= 400) return null;
    }
    return null;
  } catch {
    return null;
  }
}
