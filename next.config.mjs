/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  /*
    Standalone output, for the container image.

    Next traces the modules the server actually reaches and copies just those
    into .next/standalone, so the runtime stage carries no node_modules tree of
    its own. On a 2-CPU box that is the difference between a lean image and one
    that ships the whole dependency graph twice.
  */
  output: "standalone",
  experimental: {
    /*
      @solana/web3.js is deliberately NOT external.

      Left to the runtime it is required from node_modules, and one of its
      transitive dependencies does require() on an ES module — which Node
      refuses, so the whole route dies before it starts. Bundling lets webpack
      resolve that dependency properly. The "not a constructor" failures that
      first pointed here were caused by the resolve alias below, not by
      bundling.
    */
    serverComponentsExternalPackages: ["@prisma/adapter-pg", "pg"],
  },
  webpack: (config) => {
    /*
      Privy optional peer deps we genuinely don't use.

      @solana/web3.js was in this list from when the site had no Solana, and it
      aliases the module to an empty object — so every class imported from it
      came back undefined and `new PublicKey(...)` failed with "is not a
      constructor". The site now uses it directly for fees, launches and
      trading, so it must resolve for real.
    */
    config.resolve.alias = {
      ...config.resolve.alias,
      "@stripe/crypto": false,
      "@farcaster/mini-app-solana": false,
      "@farcaster/miniapp-sdk": false,
      /*
        Kept: a Privy peer dependency resolves a subpath of this package that
        the installed version doesn't export, and nothing here uses it.
        @solana/web3.js is deliberately NOT in this list — see above.
      */
      "@solana/kit": false,
    };
    return config;
  },
};

export default nextConfig;
