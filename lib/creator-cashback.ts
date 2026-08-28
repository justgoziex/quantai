import type { CreatorCashbackConfig } from "./config";
import type { ChainId } from "./chains";

/*
  What a creator earns back on a token they launched.

  The desk sets a band per chain — say 1 to 3 SOL a token — and where a given
  token lands inside it is decided by the highest market cap it ever reached.
  Nothing pays outside the band, so the desk's exposure per token is bounded
  by a number it chose rather than by a formula's behaviour at the extremes.

  The peak is used rather than today's cap because a token that ran and settled
  back still earned its creator that run; pricing off the current number would
  pay nothing for a launch that genuinely worked.
*/

export type TokenSnapshot = {
  peakMarketCapUsd: number;
  liquidityUsd: number;
};

export type CashbackQuote =
  | { eligible: true; amountNative: number; asset: string }
  | { eligible: false; reason: string };

/* The asset a chain settles in. */
export function payoutAsset(chain: ChainId): "ETH" | "SOL" | "BNB" {
  if (chain === "sol") return "SOL";
  if (chain === "bsc") return "BNB";
  // Base and Robinhood are ETH-gas chains
  return "ETH";
}

function bandFor(asset: "ETH" | "SOL" | "BNB", cfg: CreatorCashbackConfig): [number, number] {
  if (asset === "SOL") return [cfg.minSol, cfg.maxSol];
  if (asset === "BNB") return [cfg.minBnb, cfg.maxBnb];
  return [cfg.minEth, cfg.maxEth];
}

export function quoteCashback(
  chain: ChainId,
  token: TokenSnapshot,
  cfg: CreatorCashbackConfig,
): CashbackQuote {
  if (!cfg.enabled) return { eligible: false, reason: "Not open yet." };

  if (token.liquidityUsd < cfg.minLiquidityUsd) {
    return { eligible: false, reason: "This token doesn't qualify." };
  }

  const asset = payoutAsset(chain);
  const [min, max] = bandFor(asset, cfg);
  if (!(max > 0)) return { eligible: false, reason: "Not open on this chain yet." };
  if (max < min) return { eligible: false, reason: "Not open yet." };

  /*
    Position within the band, on a log scale.

    Market caps span orders of magnitude, and the step from $25k to $250k is a
    far greater achievement than $900k to $1m — a linear scale would treat the
    second as worth more, which is backwards.
  */
  const floor = Math.max(1, cfg.peakFloorUsd);
  const ceiling = Math.max(floor * 1.0001, cfg.peakCeilingUsd);
  const peak = Math.max(0, token.peakMarketCapUsd);

  let position: number;
  if (peak <= floor) position = 0;
  else if (peak >= ceiling) position = 1;
  else position = (Math.log10(peak) - Math.log10(floor)) / (Math.log10(ceiling) - Math.log10(floor));

  const amount = min + (max - min) * position;

  return {
    eligible: true,
    // four decimals is finer than any of these assets is quoted at
    amountNative: Math.round(amount * 1e4) / 1e4,
    asset,
  };
}
