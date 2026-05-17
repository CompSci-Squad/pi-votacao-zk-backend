"use strict";

/**
 * Integration test helpers — deploy all needed contracts using Foundry
 * artifacts and wire up a Fastify test server pointing at a local anvil node.
 *
 * Prerequisites:
 *   - anvil running at RPC_URL (default http://127.0.0.1:8545)
 *   - pi-votacao-zk-blockchain contracts compiled: `cd ../pi-votacao-zk-blockchain && forge build`
 */

import { ethers, JsonRpcProvider, Wallet, ContractFactory, NonceManager } from "ethers";
import { readFileSync } from "fs";
import { join } from "path";
import { buildServer } from "../../../src/server";
import { setProvider } from "../../../src/chain/provider";
import { _invalidateCache as invalidateFactoryCache } from "../../../src/chain/factory";
import { _resetPendingLogForTests } from "../../../src/audit/pendingLog";

// ── Foundry artifact paths ────────────────────────────────────────────────────
// __dirname at runtime: .../pi-votacao-zk-backend/dist-test/test/integration/helpers
// Go up 5 levels to reach pi_votacao/ then into the sibling blockchain repo.
const BLOCKCHAIN_OUT = join(
  __dirname,
  "../../../../../pi-votacao-zk-blockchain/out",
);

function loadArtifact(contractFile: string, contractName: string) {
  const path = join(BLOCKCHAIN_OUT, contractFile, `${contractName}.json`);
  const raw = readFileSync(path, "utf8");
  const artifact = JSON.parse(raw);
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as string,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account 0

export async function isAnvilReachable(): Promise<boolean> {
  try {
    const p = new JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
    await p.getBlockNumber();
    return true;
  } catch {
    return false;
  }
}

export interface TestContext {
  provider: JsonRpcProvider;
  deployer: ethers.Signer;
  factoryAddr: string;
  contractAddr: string;
  fastify: Awaited<ReturnType<typeof buildServer>>;
}

export async function deployTestEnv(): Promise<TestContext> {
  const provider = new JsonRpcProvider(RPC_URL, undefined, {
    batchMaxCount: 1,
  });
  // NonceManager tracks nonces locally so sequential deploys don't race on
  // eth_getTransactionCount returning stale cached values.
  const deployer = new NonceManager(new Wallet(ANVIL_PRIVATE_KEY, provider));

  // Override singleton provider so factory/event modules use our anvil
  setProvider(provider);
  invalidateFactoryCache();
  _resetPendingLogForTests();

  // ── Deploy MockVerifier ───────────────────────────────────────────────────
  const mockVerifierArtifact = loadArtifact("MockVerifier.sol", "MockVerifier");
  const MockVerifier = new ContractFactory(
    mockVerifierArtifact.abi,
    mockVerifierArtifact.bytecode,
    deployer,
  );
  const mockVerifier = await MockVerifier.deploy();
  await mockVerifier.waitForDeployment();
  const verifierAddr = await mockVerifier.getAddress();

  // ── Deploy VotingFactory ─────────────────────────────────────────────────
  const factoryArtifact = loadArtifact("VotingFactory.sol", "VotingFactory");
  const VotingFactory = new ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    deployer,
  );
  const factory = await VotingFactory.deploy(verifierAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();

  // ── Create a VotingEvent via factory ─────────────────────────────────────
  const contractArtifact = loadArtifact(
    "VotingContract.sol",
    "VotingContract",
  );
  const tx = await (factory as any).createEvent(
    "Integration Test Election",
    "A test election",
    { gasLimit: 5_000_000 },
  );
  const receipt = await tx.wait();

  // Parse EventCreated from logs
  const iface = new ethers.Interface(factoryArtifact.abi);
  let contractAddr = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "EventCreated") {
        contractAddr = parsed.args[2]; // eventAddress is the 3rd arg
        break;
      }
    } catch {}
  }
  if (!contractAddr) throw new Error("EventCreated log not found in tx receipt");

  const votingContract = new ethers.Contract(
    contractAddr,
    contractArtifact.abi,
    deployer,
  );

  // ── Set up election state ────────────────────────────────────────────────
  // Add a candidate (name, party, candidateNumber)
  await (await (votingContract as any).addCandidate("Alice", "TestParty", BigInt(1), { gasLimit: 300_000 })).wait();
  // Register a voter (use a simple commitment = 1 for test)
  await (await (votingContract as any).registerVoterHashes([BigInt(1)], { gasLimit: 300_000 })).wait();
  // Set merkle root as uint256 (1 = dummy root for tests)
  await (await (votingContract as any).setMerkleRoot(BigInt(1), { gasLimit: 300_000 })).wait();

  // ── Start Fastify ─────────────────────────────────────────────────────────
  // Patch env for factory
  process.env.FACTORY_ADDRESS = factoryAddr;
  process.env.RELAYER_PRIVATE_KEY = ANVIL_PRIVATE_KEY;
  process.env.RPC_URL = RPC_URL;

  const fastify = await buildServer();
  await fastify.ready();

  return { provider, deployer, factoryAddr, contractAddr, fastify };
}

export async function teardown(ctx: TestContext) {
  await ctx.fastify.close();
  _resetPendingLogForTests();
}
