#!/usr/bin/env node
"use strict";

/**
 * setup_dev.js
 *
 * Deploys MockVerifier + VotingFactory to a local anvil node, creates a
 * test election, runs admin setup, and writes (or updates) .env with the
 * correct FACTORY_ADDRESS.
 *
 * Usage:
 *   node scripts/setup_dev.js [--open]
 *
 * --open  Also calls openElection() so you can immediately POST /relay
 *
 * Prerequisites:
 *   - anvil running on http://127.0.0.1:8545
 *   - pi-votacao-zk-blockchain compiled: cd ../pi-votacao-zk-blockchain && forge build
 */

const { ethers, NonceManager } = require("ethers");
const { readFileSync, writeFileSync, existsSync } = require("fs");
const { join } = require("path");

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const ANVIL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OPEN = process.argv.includes("--open");

const BLOCKCHAIN_OUT = join(__dirname, "../../pi-votacao-zk-blockchain/out");
const ENV_FILE = join(__dirname, "../.env");
const ENV_EXAMPLE = join(__dirname, "../.env.example");

function loadArtifact(file, name) {
  const p = join(BLOCKCHAIN_OUT, file, `${name}.json`);
  const a = JSON.parse(readFileSync(p, "utf8"));
  return { abi: a.abi, bytecode: a.bytecode.object };
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { batchMaxCount: 1 });
  const deployer = new NonceManager(new ethers.Wallet(ANVIL_KEY, provider));

  // Verify anvil is running
  const network = await provider.getNetwork();
  console.log(`\nConnected to chainId ${network.chainId} (${RPC_URL})\n`);
  if (network.chainId !== 31337n) {
    throw new Error(`Expected chainId 31337 (anvil), got ${network.chainId}. Is anvil running?`);
  }

  // ── 1. Deploy MockVerifier ────────────────────────────────────────────────
  console.log("Deploying MockVerifier...");
  const mvArt = loadArtifact("MockVerifier.sol", "MockVerifier");
  const MV = new ethers.ContractFactory(mvArt.abi, mvArt.bytecode, deployer);
  const mockVerifier = await MV.deploy();
  await mockVerifier.waitForDeployment();
  const verifierAddr = await mockVerifier.getAddress();
  console.log(`  MockVerifier:  ${verifierAddr}`);

  // ── 2. Deploy VotingFactory ───────────────────────────────────────────────
  console.log("Deploying VotingFactory...");
  const fArt = loadArtifact("VotingFactory.sol", "VotingFactory");
  const FF = new ethers.ContractFactory(fArt.abi, fArt.bytecode, deployer);
  const factory = await FF.deploy(verifierAddr);
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  console.log(`  VotingFactory: ${factoryAddr}`);

  // ── 3. Create a test election via factory ─────────────────────────────────
  console.log("Creating test election via factory...");
  const tx = await factory.createEvent(
    "Eleição de Teste",
    "Eleição local para desenvolvimento",
    { gasLimit: 5_000_000 }
  );
  const receipt = await tx.wait();

  const iface = new ethers.Interface(fArt.abi);
  let eventAddr = "";
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "EventCreated") {
        eventAddr = parsed.args[2]; // eventAddress
        break;
      }
    } catch {}
  }
  if (!eventAddr) throw new Error("EventCreated log not found in receipt");
  console.log(`  VotingContract (event): ${eventAddr}`);

  // ── 4. Admin setup ────────────────────────────────────────────────────────
  const vcArt = loadArtifact("VotingContract.sol", "VotingContract");
  const vc = new ethers.Contract(eventAddr, vcArt.abi, deployer);

  console.log("Adding candidates...");
  await (await vc.addCandidate("Alice Oliveira", "PT", 13n, { gasLimit: 300_000 })).wait();
  await (await vc.addCandidate("Bruno Silva",   "PSD", 45n, { gasLimit: 300_000 })).wait();

  console.log("Registering voter hashes...");
  // Commitments 1..15 as a simple test set (depth-4 tree = 16 leaves)
  const hashes = Array.from({ length: 15 }, (_, i) => BigInt(i + 1));
  await (await vc.registerVoterHashes(hashes, { gasLimit: 500_000 })).wait();

  console.log("Setting Merkle root...");
  // For the dev fixture the root is just 1 (tree.root from the test suite)
  await (await vc.setMerkleRoot(1n, { gasLimit: 100_000 })).wait();

  if (OPEN) {
    console.log("Opening election...");
    await (await vc.openElection({ gasLimit: 100_000 })).wait();
    console.log("  Election is OPEN — you can now POST /relay");
  } else {
    console.log("  Election is PENDING — pass --open to open it now");
  }

  // ── 5. Write / update .env ────────────────────────────────────────────────
  let envContent = existsSync(ENV_FILE)
    ? readFileSync(ENV_FILE, "utf8")
    : existsSync(ENV_EXAMPLE)
      ? readFileSync(ENV_EXAMPLE, "utf8")
      : "";

  // Replace or append each key
  const entries = {
    RPC_URL,
    FACTORY_ADDRESS: factoryAddr,
    RELAYER_PRIVATE_KEY: ANVIL_KEY,
  };
  for (const [key, val] of Object.entries(entries)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(envContent)) {
      envContent = envContent.replace(re, `${key}=${val}`);
    } else {
      envContent += `\n${key}=${val}`;
    }
  }
  writeFileSync(ENV_FILE, envContent.trim() + "\n");

  // ── 6. Print summary ──────────────────────────────────────────────────────
  console.log("\n─────────────────────────────────────────────────");
  console.log("✓  .env written");
  console.log(`   FACTORY_ADDRESS=${factoryAddr}`);
  console.log(`   RELAYER_PRIVATE_KEY=${ANVIL_KEY}`);
  console.log("\n   Test event address (use in curl requests):");
  console.log(`   EVENT_ADDR=${eventAddr}`);
  console.log("─────────────────────────────────────────────────");
  console.log("\nNext step:  cd pi-votacao-zk-backend && npm start");
  console.log("(restart the server if it is already running)\n");
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
