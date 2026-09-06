# How to place a trade with the Agent

Written 2026-09-06 for the owner. Every step below is what the code does today; numbers marked `TODO-OWNER` in the code are provisional.

Every **bold** name in this guide is a control you can press, and it is written exactly as the app renders it — `apps/web/src/components/agent/guide.test.ts` fails if one of them is not a string the agent surface actually shows.

## Before you start

- A wallet on **Base mainnet** (injected wallet or Coinbase Smart Wallet) with USDC and a little ETH for gas.
- Connect the wallet in the top bar and sign in (a signature, no gas). The agent never signs or sends anything; your wallet approves every transaction.
- Limits per agent trade: buy side only, USDC only, at most 10 USD of risk (the premium you pay, or the RFQ escrow). Daily chat turns: 10 as a guest, 50 signed in. Pressing a suggestion chip is one turn.
- Operators: RFQ needs `RFQ_KEY_MASTER_KEY` set on the server (`openssl rand -hex 32`); without it the agent refuses RFQ creation with one sentence.

## Path A — buy a listed option (OptionBook)

1. Open **Agent** in the nav, or the **Agent** tab on a market page (`/m/eth`).
2. Say your view in plain words, or press a starter chip: *"I think ETH goes up this week. I have $10."*
3. The agent searches the live book, previews the cheapest fit, and prints cost, max loss, max payout, break-even and expiry. Ask *"What happens at expiry?"* or *"If ETH settles at 2400, what do I make?"* if you want the numbers explained.
4. Press the **Prepare this trade** chip, or just say it. An approval card appears in the chat: it names the market, the option, the strikes, the expiry, the side and the most you would spend, with its currency. **Approve** lets the server build the transaction; nothing is sent yet, and **Cancel** stops there — the agent is told a person declined, not that the book refused.
5. The card's button reads **Sign in wallet** until you press it. Your wallet then asks twice: first an approval for exactly the premium, then the fill. Both are your signatures.
6. The card shows **Confirmed on Base and recorded.** with a link to your position page and a **Write a post about it** chip. There is no cancel after a fill; the option settles automatically at expiry.

## Path B — ask makers for a custom option (RFQ)

Use this when the book has nothing at the strike or expiry you want. v1 supports buying PUTs and put spreads in USDC on ETH or BTC.

1. Say what you want, e.g. *"I want an ETH 2300 put expiring next Friday, 2 contracts."* If the book has nothing there, the agent offers an RFQ; on a market page the chip does the same and names that market — **Ask for a custom ETH option** on `/m/eth`, **Ask for a custom BTC option** on `/m/btc`.
2. The agent needs four things from you and never invents them: strike(s), expiry, contracts, and your maximum price per contract (the reserve). Ask *"suggest a reserve"* and it reads Thetanuts' maker pricing and proposes one, clearly labelled a suggestion; you confirm or name your own. It will also ask how long makers have to answer (the offer deadline).
3. The preview prints the escrow (reserve × contracts, in USDC), which is also your maximum loss, plus strikes, expiry and the offer deadline. The escrow must be at most 10 USD.
4. Say *"prepare it"*. An approval card appears — **Ask market makers for this option?** — listing the market, strikes, contracts, expiry and the most per contract. Press **Approve**. Your wallet then asks twice: an approval for exactly the escrow to the OptionFactory, then the request itself. The escrow leaves your wallet into the factory.
5. The card switches to **Your request is live**: makers submit sealed offers until the deadline, then reveal them. Statuses you will see are *waiting for offers → reveal window → ready to settle → settled*, or *cancelled*, or *expired unfilled*. The card re-reads the request on its own while the chain can still move it, and **Check again** re-reads it on demand.
6. **Cancel the request** is offered while the escrow is still with the factory: *waiting for offers*, *reveal window*, *ready to settle*, and *expired unfilled* — the last of these is a request no maker answered, where cancelling is how you get the deposit back. It is not offered once the request is *settled* or *cancelled*. When the card says a winning offer is revealed, **Settle it** mints the option to your wallet, pays the winning price out of the escrow and refunds the rest. Settling is permissionless, so a maker bot often does it first; then the card simply shows **Settled.** with the option address.
7. Ask *"show my positions"*, or press **Show my positions**: RFQ-born options are listed from the indexer (no live P&L on them yet).

## What the agent will not do

- Sign, send, retry or change a transaction on its own.
- Sell options, use non-USDC collateral, or exceed 10 USD of risk per trade.
- Read maker offers before they are revealed (early acceptance is a later feature).
- Predict prices or say a trade is likely to win.

## If something looks wrong

- "Not signed in" → connect and sign in again with the same wallet.
- "Order no longer quoted" → makers re-sign about every minute; ask again.
- Approval stuck → wait for it to confirm on Base, then press the button again; the card never sends a second transaction by itself. If two cards for the same request are open, only one of them can send.
- After a fill or a request, if recording did not go through, the button reads **Record the request** (RFQ) or **Record the fill** (OptionBook). Pressing it records the transaction that is already on chain; it never sends another.
- "RFQ keys are not configured" → the server is missing `RFQ_KEY_MASTER_KEY`.
