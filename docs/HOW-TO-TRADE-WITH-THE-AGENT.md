# How to place a trade with the Agent

Written 2026-09-06 for the owner. Every step below is what the code does today (branch `rfq-int`); numbers marked `TODO-OWNER` in the code are provisional.

## Before you start

- A wallet on **Base mainnet** (injected wallet or Coinbase Smart Wallet) with **USDC** and a little **ETH for gas**.
- Connect the wallet in the top bar and **sign in** (a signature, no gas). The agent never signs or sends anything; your wallet approves every transaction.
- Limits per agent trade: **buy side only, USDC only, at most 10 USD of risk** (the premium you pay, or the RFQ escrow). Daily chat turns: 10 as a guest, 50 signed in. Pressing a suggestion chip is one turn.
- Operators: RFQ needs `RFQ_KEY_MASTER_KEY` set on the server (`openssl rand -hex 32`); without it the agent refuses RFQ creation with one sentence.

## Path A — buy a listed option (OptionBook)

1. Open **Agent** in the nav, or the **Agent** tab on a market page (`/m/eth`).
2. Say your view in plain words, or press a starter chip: *"I think ETH goes up this week. I have $10."*
3. The agent searches the live book, previews the cheapest fit, and prints **cost, max loss, max payout, break-even, expiry**. Ask *"What happens at expiry?"* or *"If ETH settles at 2400, what do I make?"* if you want the numbers explained.
4. Press **Prepare this trade** (or say it). An approval card appears in the chat: **Approve** lets the server build the transaction; nothing is sent yet.
5. Your wallet asks twice: first **approve USDC** for exactly the premium, then **fill the order**. Both are your signatures.
6. The card shows **"Confirmed on Base and recorded"** with a link to your position page and a **Write a post about it** chip. There is no cancel after a fill; the option settles automatically at expiry.

## Path B — ask makers for a custom option (RFQ)

Use this when the book has nothing at the strike or expiry you want. v1 supports **buying PUTs and put spreads in USDC on ETH or BTC**.

1. Say what you want, e.g. *"I want an ETH 2300 put expiring next Friday, 2 contracts."* If the book has nothing there, the agent offers an RFQ; the chip **Ask for a custom option (RFQ)** does the same.
2. The agent needs four things from you and never invents them: **strike(s)**, **expiry**, **contracts**, and your **maximum price per contract** (the reserve). Ask *"suggest a reserve"* and it reads Thetanuts' maker pricing and proposes one, clearly labelled a suggestion; you confirm or name your own. It will also ask how long makers have to answer (the offer deadline).
3. The preview prints the **escrow** (reserve × contracts, in USDC), which is also your **max loss**, plus strikes, expiry and the offer deadline. The escrow must be at most 10 USD.
4. Press **Prepare**. Approval card → **Approve**. Your wallet asks twice: **approve USDC** for exactly the escrow to the OptionFactory, then **create the request**. The escrow leaves your wallet into the factory.
5. The card switches to **watching**: makers submit sealed offers until the deadline, then reveal them. Statuses you will see: *waiting for offers → reveal window → ready to settle → settled*, or *cancelled*, or *expired unfilled*.
6. While it is live you can press **Cancel** at any time (one wallet signature; the escrow is refunded). When it says **ready to settle**, press **Settle** (one signature): the option is minted to your wallet, the winning price is paid from the escrow, the rest is refunded. Maker bots often settle first; then the card simply shows **settled** with the option address.
7. Ask *"show my positions"*: RFQ-born options are listed from the indexer (no live P&L on them yet).

## What the agent will not do

- Sign, send, retry or change a transaction on its own.
- Sell options, use non-USDC collateral, or exceed 10 USD of risk per trade.
- Read maker offers before they are revealed (early acceptance is a later feature).
- Predict prices or say a trade is likely to win.

## If something looks wrong

- "Not signed in" → connect and sign in again with the same wallet.
- "Order no longer quoted" → makers re-sign about every minute; ask again.
- Approval stuck → wait for it to confirm on Base, then press the button again; the card never sends a second transaction by itself.
- "RFQ keys are not configured" → the server is missing `RFQ_KEY_MASTER_KEY`.
