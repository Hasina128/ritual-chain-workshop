# Privacy-Preserving AI Bounty Judge

Homework submission for [Ritual Foundation](https://ritualfoundation.org) by [@Hasina128](https://github.com/Hasina128): a commit-reveal AI bounty judge that runs on any EVM chain and uses Ritual's LLM precompile (`0x0802`) for batch judging on Ritual testnet.

Forked from [cozfuttu/ritual-chain-workshop](https://github.com/cozfuttu/ritual-chain-workshop).

## Problem

In the workshop version, answers were public immediately after submission. Later participants could copy earlier ideas and resubmit improved versions. This implementation hides answers during the commit phase and only reveals them after the submission deadline.

## Bounty lifecycle

```mermaid
sequenceDiagram
    participant Owner
    participant Participant
    participant Contract
    participant RitualLLM

    Owner->>Contract: createBounty(title, rubric, submissionDeadline, revealDeadline) + reward
    Participant->>Contract: submitCommitment(keccak256(answer, salt, sender, bountyId))
    Note over Contract: Only hashes are visible on-chain
    Participant->>Contract: revealAnswer(answer, salt) after submission deadline
    Note over Contract: Contract verifies commitment binding
    Owner->>Contract: judgeAll(llmInput) after reveal deadline
    Contract->>RitualLLM: One batch LLM call (0x0802)
    RitualLLM-->>Contract: AI review JSON stored on-chain
    Owner->>Contract: finalizeWinner(winnerIndex)
    Contract->>Participant: Transfer reward
```

### Phases

| Phase | Who acts | On-chain state |
|-------|----------|----------------|
| **Commit** | Participants | Only `bytes32` commitments + submitter addresses |
| **Reveal** | Participants | Plaintext answers verified against commitments |
| **Judge** | Bounty owner | One Ritual LLM batch call over revealed answers |
| **Finalize** | Bounty owner | Human picks winner; contract pays reward |

### Commitment formula

```solidity
keccak256(abi.encodePacked(answer, salt, msg.sender, bountyId))
```

Binding `msg.sender` and `bountyId` prevents another wallet from replaying someone else's commitment.

## Repository layout

```
hardhat/     Solidity contract, tests, Ignition deploy module
web/         Next.js frontend (wagmi + Ritual testnet)
```

## Quick start (local)

### 1. Contracts

```bash
cd hardhat
pnpm install
pnpm exec hardhat build
pnpm exec hardhat test solidity
```

### 2. Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then set NEXT_PUBLIC_CONTRACT_ADDRESS
pnpm dev
```

## Ritual testnet

| Resource | URL |
|----------|-----|
| Chain ID | `1979` |
| RPC | https://rpc.ritualfoundation.org |
| Explorer | https://explorer.ritualfoundation.org |
| Faucet | https://faucet.ritualfoundation.org |
| Docs | https://docs.ritualfoundation.org |

### Key Ritual concepts used

- **LLM precompile (`0x0802`)**: batch-judges all revealed submissions in one transaction
- **RitualWallet (`0x532F…3948`)**: prepaid fees for async precompile calls
- **TEE execution**: LLM runs inside a TEE; Ritual replays the transaction so all nodes agree on the result
- **Human-in-the-loop**: AI recommends a winner; the owner must call `finalizeWinner`

## Core contract functions

| Function | Description |
|----------|-------------|
| `createBounty(title, rubric, submissionDeadline, revealDeadline)` | Creates bounty, locks reward |
| `submitCommitment(bountyId, commitment)` | Commit phase only; one per address |
| `revealAnswer(bountyId, answer, salt)` | Reveal phase only; verifies hash |
| `judgeAll(bountyId, llmInput)` | Owner only; after reveal deadline |
| `finalizeWinner(bountyId, winnerIndex)` | Owner only; pays revealed winner |
| `computeCommitment(...)` | View helper for frontend/tests |

## Deliverables

- `hardhat/contracts/AIJudge.sol` — commit-reveal contract
- `hardhat/contracts/AIJudge.t.sol` — Solidity tests (13 cases)
- `TEST_PLAN.md` — manual + automated test matrix
- `ARCHITECTURE.md` — commit-reveal vs Ritual-native encrypted design
- `REFLECTION.md` — reflection question answer

## Wallet setup

| Role | Env var | Address |
|------|---------|---------|
| Bounty owner | `CREATOR_PRIVATE_KEY` / `DEPLOYER_PRIVATE_KEY` | *you provide in `hardhat/.env`* |
| Participant A | `USER1_PRIVATE_KEY` | `0xDa4403d9F702e5Ce7520bCbDF054A8f9EF4A5905` |
| Participant B | `USER2_PRIVATE_KEY` | `0xD9d58227BB51a41107BB2B5295D2123167ab112a` |

Add your creator key to `hardhat/.env`, then fund all three wallets via the [Ritual faucet](https://faucet.ritualfoundation.org).

## Deploy & configure

```bash
cd hardhat
pnpm exec hardhat ignition deploy ignition/modules/AIJudge.ts --network ritual --deployment-id aijudge-hasina
# Copy deployed address into hardhat/.env CONTRACT_ADDRESS and web/.env.local NEXT_PUBLIC_CONTRACT_ADDRESS
```

### Hasina128 testnet deployment

| Item | Value |
|------|-------|
| Contract | `0xD2EaA4125C3Eb2dEBA2aB63A98e9C55Cd925a919` |
| Chain | Ritual testnet (`1979`) |
| Explorer | [AIJudge contract](https://explorer.ritualfoundation.org/address/0xD2EaA4125C3Eb2dEBA2aB63A98e9C55Cd925a919) |

End-to-end demo scripts:

```bash
cd hardhat
pnpm bounty:auto -- --bounty-id 1          # commit → reveal → judge → finalize
node --experimental-strip-types scripts/quick-judge.ts 1   # judge + finalize (if async LLM pending)
```

## Submission checklist

- [ ] Fork to `github.com/Hasina128/ritual-chain-workshop` and push this repo
- [ ] Deploy contract on Ritual testnet (chain `1979`)
- [ ] Fund owner RitualWallet for LLM fees
- [ ] Run end-to-end demo (create → commit → reveal → judge → finalize)
- [ ] Post proof on [Discord submission thread](https://discord.com/channels/1210468736205852672/1516880140867469481/1517222943229345814)