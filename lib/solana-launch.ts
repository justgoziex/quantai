import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { solBalance, latestBlockhash, rentExemption } from "./solana";
import { web3 as loadWeb3 } from "./solana-web3";

/*
  Launching a token on Solana.

  Nothing here resembles the EVM launcher, because the chains don't work alike.
  On Ethereum a token IS a contract you deploy. On Solana there is one shared
  Token Program owned by the network, and a token is a small account that
  program manages — so a launch is a handful of instructions, not a deployment.

  Four steps, all in one transaction the developer signs and pays for:

    1. create the mint account and pay its rent
    2. initialise it with the chosen decimals and authorities
    3. create the developer's token account and mint the full supply into it
    4. attach a name, symbol and image, so wallets show a token rather than an
       anonymous address

  The developer keeps everything. No liquidity is created here — that's theirs
  to add, and doing it for them would mean taking custody of their supply.
*/

/*
  Metaplex Token Metadata — the program every wallet reads names from.

  Resolved lazily rather than at module load: the bundler evaluates module
  scope while collecting page data at build time, and the web3 interop isn't
  ready at that point, so constructing it eagerly fails the build.
*/
const METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export type LaunchPlan = {
  /* base64 transaction for the wallet to sign */
  transaction: string;
  /* the mint address the token will have */
  mint: string;
  /* what this will cost the developer, in SOL */
  estimatedCostSol: number;
};

/* Borsh-style string: 4-byte little-endian length, then the bytes. */
function encodeString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length, 0);
  return Buffer.concat([len, bytes]);
}

/*
  CreateMetadataAccountV3.

  Built by hand rather than through the Metaplex client, which pulls in a whole
  framework for one instruction — a heavy dependency to ship to a browser for a
  layout that hasn't changed in years.
*/
function createMetadataInstruction(
  web3: typeof import("@solana/web3.js"),
  opts: {
    metadata: PublicKey;
    mint: PublicKey;
    authority: PublicKey;
    payer: PublicKey;
    name: string;
    symbol: string;
    uri: string;
  },
): TransactionInstruction {
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3
    encodeString(opts.name.slice(0, 32)),
    encodeString(opts.symbol.slice(0, 10)),
    encodeString(opts.uri.slice(0, 200)),
    Buffer.from([0, 0]), // seller fee basis points — zero, this isn't an NFT
    Buffer.from([0]), // no creators
    Buffer.from([0]), // no collection
    Buffer.from([0]), // no uses
    Buffer.from([1]), // isMutable: true, so the developer can fix a typo later
    Buffer.from([0]), // no collection details
  ]);

  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(METADATA_PROGRAM_ID),
    keys: [
      { pubkey: opts.metadata, isSigner: false, isWritable: true },
      { pubkey: opts.mint, isSigner: false, isWritable: false },
      { pubkey: opts.authority, isSigner: true, isWritable: false },
      { pubkey: opts.payer, isSigner: true, isWritable: true },
      { pubkey: opts.authority, isSigner: true, isWritable: false },
      { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/* Where the metadata account for a mint lives — derived, never chosen. */
function metadataAddress(
  web3: typeof import("@solana/web3.js"),
  mint: PublicKey,
): PublicKey {
  const program = new web3.PublicKey(METADATA_PROGRAM_ID);
  return web3.PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), program.toBuffer(), mint.toBuffer()],
    program,
  )[0];
}

export async function buildLaunchTransaction(opts: {
  owner: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  metadataUri: string;
  /* revoke mint and freeze authority as part of the launch */
  revokeAuthorities: boolean;
}): Promise<LaunchPlan | { error: string }> {
  /*
    Loaded here rather than at the top of the file. The token library builds
    its program addresses the moment it's imported, and the bundler evaluates
    module scope while collecting page data at build time — before the web3
    interop is usable — which fails the build for a route nobody has called.
  */
  /*
    Loaded on use, never at module scope. Bundled as a top-level import these
    classes arrive as a namespace object rather than constructors, and
    `new PublicKey(...)` fails with "is not a constructor" — an uncaught throw
    that surfaces as an empty 500.
  */
  const w3 = await loadWeb3();
  // no Connection — its websocket client fails in a serverless runtime, and
  // every read here is available over plain JSON-RPC
  const { PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } = w3;

  const {
    MINT_SIZE,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createInitializeMint2Instruction,
    createAssociatedTokenAccountInstruction,
    createMintToInstruction,
    createSetAuthorityInstruction,
    AuthorityType,
    getAssociatedTokenAddressSync,
  } = await import("@solana/spl-token");

  const owner = new PublicKey(opts.owner);

  const mintKeypair = Keypair.generate();
  const mint = mintKeypair.publicKey;
  /*
    Rent for a mint account, read directly. The helper would need a Connection
    for what is a single JSON-RPC call, and MINT_SIZE is a fixed 82 bytes.
  */
  const rent = (await rentExemption(MINT_SIZE)) ?? 2_039_280;

  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const ix: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: owner,
      newAccountPubkey: mint,
      space: MINT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(mint, opts.decimals, owner, owner, TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountInstruction(owner, ata, owner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createMintToInstruction(mint, ata, owner, opts.totalSupply, [], TOKEN_PROGRAM_ID),
    createMetadataInstruction(w3, {
      metadata: metadataAddress(w3, mint),
      mint,
      authority: owner,
      payer: owner,
      name: opts.name,
      symbol: opts.symbol,
      uri: opts.metadataUri,
    }),
  ];

  /*
    Revoking is irreversible and comes last, after the supply is minted.

    Giving up the mint authority is what makes a fixed supply real rather than
    promised, and giving up freeze means holders can't be stopped from selling.
    Both are the difference between a token that scores well here and one that
    doesn't — but neither can be undone, so it stays the developer's choice.
  */
  if (opts.revokeAuthorities) {
    ix.push(
      createSetAuthorityInstruction(mint, owner, AuthorityType.MintTokens, null, [], TOKEN_PROGRAM_ID),
      createSetAuthorityInstruction(mint, owner, AuthorityType.FreezeAccount, null, [], TOKEN_PROGRAM_ID),
    );
  }

  const balance = Math.round((await solBalance(opts.owner).catch(() => 0)) * 1e9);
  // rent for the mint, the token account, the metadata account, plus fees
  const estimated = rent + 2_100_000 + 15_000_000 + 20_000;
  if (balance < estimated) {
    return {
      error: `Not enough SOL to launch. This needs about ${(estimated / 1e9).toFixed(3)} SOL for account rent and fees.`,
    };
  }

  const blockhash = await latestBlockhash();
  if (!blockhash) return { error: "Couldn't reach Solana right now." };
  const message = new TransactionMessage({
    payerKey: owner,
    recentBlockhash: blockhash,
    instructions: ix,
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  // the mint account signs for its own creation; the developer signs the rest
  tx.sign([mintKeypair]);

  return {
    transaction: Buffer.from(tx.serialize()).toString("base64"),
    mint: mint.toBase58(),
    estimatedCostSol: estimated / 1e9,
  };
}
