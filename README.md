# arc_testing

# REPORT ON ARC TESTNET 

# ISSUE:
USER-SUPPLIED USDC/ETH ARE LOST AND PERMANTLY TRAPPED IN THE Multicall3 CONTRACT WITH NO RECOVERY MECHANISM IN FUNCTION "aggregate3Value()" #L88-125

SEVERNTY:HIGH


# SUMMARY:
Functions like aggregate,tryaggregate etc are marked payable purely for gas optimization. When a user double sends the native token for gas(USDC)the first transaction reverts back according to the contract logic but the second transaction is stuck forever in the the Multicall3 contract

# VULNERABILTY DETAILS:
At #L88  Multicall3.aggregate3Value()` allows a caller to batch several calls, each carrying its own native-value transfer, with a per-call `allowFailure` flag. When a call has `allowFailure = true`, carries a nonzero `value`, and that call **fails** (e.g., the target has no `receive()`/`fallback()`), the attempted value transfer is atomically reverted by the EVM — but execution of the *outer* transaction continues, and the final validation check only verifies that `msg.value` equals the *sum of all attempted values*, not the sum of *successfully delivered* values. The result: that value is never delivered anywhere, is never refunded, and permanently increases Multicall3's own contract balance. The transaction reports success. There is no event, no revert, and no recovery mechanism (Multicall3 holds no state and has no withdrawal function).

# PROOF OF CONCEPT(POC):
This is a contract logic and it doesn't change, it's third-party, MIT-licensed infrastructure that gets deployed at the same deterministic address on most EVM-compatible chains. I made use of the arc testnet while testing, its verifiable on the arc testnet explorer, below are details and contract address and transactions that are verifiable on the explorer

Deployer: 0x4f6734EeC17748975F92a7ea43B9c9385A087D52
Balance: 19 USDC

The Deployed Multicall3 Contract...
✓ Multicall3 deployed: 0x183F049eF1b1aF20371982f28Bf75E395Bb8e753
  https://sepolia.etherscan.io/address/0x183F049eF1b1aF20371982f28Bf75E395Bb8e753

Deploying ValueLockPoCConfigurable...
✓ PoC deployed: 0xe564ac6d4C150ff5F3C020ED75A9C3257Ca2c232
  https://sepolia.etherscan.io/address/0xe564ac6d4C150ff5F3C020ED75A9C3257Ca2c232
✓ Confirmed on-chain bytecode contains the expected selector

Tx sent: 0x98110284d82d5af112d79194f93ef9541d95f88c1fb9d5b594ef919f89922cf7
  https://testnet.arcscan.app/tx/0x98110284d82d5af112d79194f93ef9541d95f88c1fb9d5b594ef919f89922cf7


Tx status: 1 (success)

Multicall3 balance change: 40 USDC(I actually ran this four times just to be sure)


# STEPS TO REPRODUCE USING THE BASH TERMINAL

```bash
mkdir arc_testing && cd arc_testing
npm init -y
npm install ethers 
```

```bash
 git clone https://github.com/johnberchy/arc_testing.git
```

Your folder should look like this 
multicall3-sepolia/
├── compiled-artifacts-configurable.json
├──  Multicall3.sol
├── valueLockPoCConfigurable.sol
├── package.json
├── testrun.cjs
└── node_modules/

OPEN testrun.cjs and edit to your own actual private key with faucet inside and RPC_URL
const PRIVATE_KEY = "76bc14d1f9e510160a238cc6a73cd8939fe085e693bc124a063921cda0398297";// my private key for testing purpose only

THEN RUN

```bash
node testrun.cjs
```

# IMPACT: 
Permanent loss of user funds with no mitigation or recovery path.


# RECOMMENDED FIX:
Create a second function that doesn't accept value `allowFailure = true`

THANK YOU AND I HOPE TO HEAR FROM YOU GUYS SOON

 


 
