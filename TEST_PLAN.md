# Test Plan — Commit-Reveal AI Bounty Judge

## Automated tests (Solidity)

Run:

```bash
cd hardhat
pnpm exec hardhat test solidity
```

| Test | Scenario | Expected |
|------|----------|----------|
| `test_CreateBountyStoresDeadlines` | Owner creates bounty | Deadlines, reward, empty submissions |
| `test_SubmitCommitmentDuringSubmissionPhase` | Valid commitment | Hash stored, answer empty, `revealed=false` |
| `test_RevealAnswerAfterSubmissionDeadline` | Valid reveal | Answer stored, `revealedCount=1` |
| `test_RevertRevealBeforeSubmissionDeadline` | Early reveal | Revert `submission phase not ended` |
| `test_RevertRevealAfterRevealDeadline` | Late reveal | Revert `reveal phase closed` |
| `test_RevertInvalidRevealWithWrongSalt` | Bad salt | Revert `invalid reveal` |
| `test_RevertInvalidRevealWithWrongAnswer` | Tampered answer | Revert `invalid reveal` |
| `test_RevertCommitmentAfterSubmissionDeadline` | Late commit | Revert `submission phase closed` |
| `test_RevertDuplicateCommitmentFromSameAddress` | Second commit same wallet | Revert `already committed` |
| `test_RevertJudgeAllBeforeRevealDeadline` | Early judge | Revert `reveal phase not ended` |
| `test_RevertJudgeAllWithNoRevealedSubmissions` | No reveals | Revert `no revealed submissions` |
| `test_CommitmentBindsSubmitterAndBountyId` | Bob tries Alice's reveal | Revert `no commitment found` |
| `test_UnrevealedSubmissionsNotCountedAsRevealed` | 2 commits, 1 reveal | `revealedCount=1` |

## Manual end-to-end (Ritual testnet)

### Prerequisites

- [ ] Ritual testnet wallet funded via [faucet](https://faucet.ritualfoundation.org)
- [ ] Contract deployed to chain ID `1979`
- [ ] `NEXT_PUBLIC_CONTRACT_ADDRESS` set in `web/.env.local`
- [ ] RitualWallet funded for LLM fees (owner wallet)

### Scenario A — happy path

| Step | Action | Verify |
|------|--------|--------|
| 1 | Create bounty with submission + reveal deadlines | `BountyCreated` event on explorer |
| 2 | Wallet A submits commitment | Only hash visible in UI / `getSubmission` |
| 3 | Wallet B submits commitment | Two entries, no plaintext |
| 4 | Wait until submission deadline | Commit UI hidden |
| 5 | A and B reveal | Answers appear, `revealed` badge |
| 6 | Wait until reveal deadline | Judge button enabled |
| 7 | Owner funds RitualWallet | Balance > 0, lock active |
| 8 | Owner calls `judgeAll` | `AllAnswersJudged` event, AI review shown |
| 9 | Owner finalizes winner | Reward transferred, `WinnerFinalized` |

### Scenario B — unrevealed submission excluded

| Step | Action | Verify |
|------|--------|--------|
| 1 | A commits and reveals | `revealedCount=1` |
| 2 | B commits but never reveals | Still shows "Committed" |
| 3 | Owner judges after reveal deadline | LLM prompt includes only A's answer |
| 4 | Owner tries `finalizeWinner` on B's index | Revert `winner not revealed` |

### Scenario C — commitment binding

| Step | Action | Verify |
|------|--------|--------|
| 1 | A commits with answer + salt | Success |
| 2 | B copies A's hash and tries to reveal | Revert `no commitment found` or `invalid reveal` |

### Scenario D — RitualWallet underfunded

| Step | Action | Verify |
|------|--------|--------|
| 1 | Owner calls `judgeAll` without RitualWallet balance | Transaction reverts (insufficient precompile fee) |
| 2 | Deposit RITUAL to RitualWallet | Retry succeeds |

## Frontend checks

- [ ] Create form validates reveal deadline > submission deadline
- [ ] Commit phase shows "Submit commitment" only before submission deadline
- [ ] Reveal phase shows "Reveal answer" only for wallets that committed
- [ ] Submissions list hides plaintext during commit phase (hash only)
- [ ] Judge button appears only after reveal deadline with `revealedCount > 0`