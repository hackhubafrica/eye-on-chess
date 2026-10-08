Building a real-money competitive gaming platform where users stake funds (like a 50 KES entry fee for a 90/10 split) is an exciting engineering challenge. Because you are dealing with real money, trust and architectural security are your top priorities. If a hacker finds a loophole, they can drain user wallets or manipulate match outcomes.1. Client vs. Server Architecture: Where Should Features Sit?The golden rule of financial and competitive systems is simple: Never trust the client.A malicious user can decompile your mobile app, inspect network traffic using proxy tools like Burp Suite or Wireshark, or manipulate memory state. Therefore, the division of labor must be strictly enforced:What stays on the Client:UI rendering, animations, audio, and user input collection.Displaying current wallet balances and match lobbies (read-only views fetched from the server).Sending raw player actions (e.g., "Player moved knight to e4" or "Player fired at coordinates X, Y") to the server.What stays strictly on the Server:Game State & Rules Engine: The server must independently validate every move. For chess, the server runs the move validator; if an illegal move is sent, it gets rejected. For FPS games, the server is authoritative on player positions, hit registration, and scores.Match Outcome Determination: Only the server can declare who won or lost based on authoritative game logic.Financial Ledgers & Escrow Logic: Wallet balances, deposits, withdrawals, and pot distributions never touch the client's local storage or logic.2. Designing the Escrow and Match Pot FlowTo handle the 50 KES entry fees safely without risking race conditions or double-spending, your backend database (such as PostgreSQL) must handle transactions with strict atomicity.1.Locking Funds:Matchmaking & Escrow Lock.When two players agree to a 50 KES match:The server opens a database transaction (BEGIN;).It checks if both players have $\ge 50$ KES in their wallet.It deducts 50 KES from Player A and 50 KES from Player B using row-level locking (SELECT balance FROM wallets WHERE user_id = ? FOR UPDATE).It creates a matches record in an escrow state holding the 100 KES pot.It commits the transaction (COMMIT;). If either player lacks funds, the transaction rolls back entirely.2.Running the Match:Authoritative Gameplay.The game takes place. The clients send inputs to your Node.js backend or game server. The server tracks the score or checks the final checkmate condition.3.Releasing the Escrow:Payout & Fee Distribution.Once the server's rules engine verifies the winner:A new database transaction starts.The 100 KES escrow pot is split: 90 KES is credited to the winner's wallet balance, and 10 KES is credited to your platform fee revenue account.The match status updates to completed, and notification events are pushed to both clients.3. Integrating M-Pesa and SIM Toolkit (STK Push)For users to fund their wallets or cash out, integrating Safaricom's Daraja API (Lipa na M-Pesa Online / STK Push) is the industry standard in Kenya. It triggers a native SIM Toolkit prompt directly on the user's phone where they enter their PIN.   Deposits (STK Push):User requests to deposit 100 KES in the app.Your backend calls the Daraja API endpoint (/mpesa/stkpush/v1/processrequest) with the user's phone number (2547XXXXXXXX) and amount.   Safaricom pushes the prompt to the user's phone.   Safaricom sends a JSON payload to your server's Webhook Callback URL once the user enters their PIN.   Your server validates the CheckoutRequestID and checks if ResultCode === 0 (Success). Only then do you credit their platform wallet.   Idempotency & Security: Safaricom may occasionally retry webhook callbacks if network timeouts occur. Your callback handler must check whether a transaction reference has already been processed so you don't accidentally credit a user's wallet twice.   4. Hardening Security and Building TrustWhen dealing with people's money, code bugs or security gaps can be catastrophic. Implement these safeguards early:Database Isolation & ACID Compliance: Use relational databases with strict constraints (CHECK (balance >= 0)) so balances can never mathematically drop below zero due to a concurrency bug.API Authentication: Use short-lived JWTs (JSON Web Tokens) or session cookies for all client-to-server communication, ensuring users can only read or modify their own wallet data.Rate Limiting: Protect your endpoints against bot spam and denial-of-service attempts using tools like express-rate-limit in Node.js.Regulatory Awareness: Keep in mind that platforms managing financial stakes, wagering, or competitions fall under local gaming and betting compliance frameworks (such as oversight by the Betting Control and Licensing Board - BCLB in Kenya). While building a technical proof-of-concept or closed beta among trusted peers is a great way to test architecture, scaling up commercially requires navigating legal licensing, anti-money laundering (AML), and age-verification compliance.   

Writing a secure webhook endpoint for M-Pesa STK Push callbacks is one of the most critical parts of building a real-money platform. Because Safaricom's servers communicate asynchronously with your application, your endpoint must handle network retries, payload variations, and potential duplicate submissions without risking user funds.

Core Security Best Practices for Production
Immediate Response (res.status(200)): Safaricom expects a rapid confirmation. If your database takes 5 seconds to respond or throws an unhandled exception before acknowledging receipt, Safaricom assumes the request failed and will re-trigger the webhook. Always send the 200 acknowledgment first, then process the payload.

Idempotency via Unique Identifiers: Network glitches or server reboots can cause Safaricom to send the exact same callback multiple times. Checking the CheckoutRequestID and MpesaReceiptNumber against your database ensures a user's wallet balance is never credited twice for a single payment.

Securing Your Public URL: Unlike Stripe or GitHub, Safaricom's Daraja API does not sign webhook payloads with a cryptographic HMAC secret header. To prevent malicious actors from spamming fake payment notifications to your public URL, you can append a secret query parameter token to your registered callback URL (e.g., [https://yourdomain.com/api/v1/mpesa/callback?token=YOUR_SECRET_WEBHOOK_KEY](https://yourdomain.com/api/v1/mpesa/callback?token=YOUR_SECRET_WEBHOOK_KEY)) and validate it at the top of your route handler.

To build a cross-platform, real-money competitive chess platform (Android, Web, PC/Linux) that is secure against hackers and handles financial stakes safely, you should choose a Node.js + TypeScript / Next.js + chess.js stack (modeled after open-source architectures like multiplayer-chess-engine or self-hostable platforms like eye-on-chess).   While enterprise giants like Lichess use Scala (lila), adopting a JavaScript/TypeScript ecosystem matches modern full-stack velocity, gives you server-side control, and natively integrates with the M-Pesa Node.js payment workflows you are already mapping out.   Why This Stack Wins for Cross-Platform Real-Money Gaming1.The chess.js Shared Logic Advantage:Server-Authoritative Security.In a money-match platform, a hacker will try to modify their client app to declare checkmate prematurely or inject illegal moves.How it works: You use chess.js on the frontend only for smooth UI rendering and instant feedback. When a user makes a move, it is sent over a WebSocket.The Security Check: Your Node.js backend runs chess.js independently to re-validate the move. If the move is illegal, the server rejects it, penalizes or flags the client, and drops the connection. The client never gets to decide who won.2.Web, Android, and Linux/PC:Unified Cross-Platform Deployment.Instead of writing separate native codebases for Android (Kotlin), PC (C++), and Web (React), use a unified web-first architecture:Frontend: Built with Next.js (React) and TypeScript, styled for mobile browsers and desktop screens.Android Packaging: Wrap your Next.js web app into a native Android wrapper using Capacitor (the same cross-platform approach used by mobile web wrappers). Users download an APK or app bundle from your site.Backend & Hosting: Run your Node.js server on a Linux (Ubuntu/Arch) Virtual Private Server (VPS) behind Nginx, matching your local environment.3.WebSockets + Redis:Real-Time Synchronization.Competitive chess requires zero tolerance for clock drift or desynchronization. Open-source patterns use Redis as the single source of truth for active match states:Board position, turn timers, and move histories are held atomically in Redis.If a player's network flickers on a Kenyan mobile network, the server preserves their match state in Redis, allowing them to reconnect safely without losing their staked 50 KES.Mapping Your Staking & Escrow Flow to the ArchitectureWhen you combine a real-time chess server with your financial requirements, the event loop for a match looks like this:Matchmaking & Lock: Two players queue up. The server initiates a PostgreSQL transaction, locks 50 KES from both user wallets (FOR UPDATE), and creates an active match room ID.The Match Loop: Moves are streamed via WebSockets. chess.js validates every step on the Node.js backend.The Payout Trigger: When a checkmate or resignation event occurs, the server triggers an atomic database commit:Winner's wallet balance increases by 90 KES.Platform revenue ledger increases by 10 KES.Match status locks as SETTLED.Recommended Open-Source Repositories to Studytomarrohitt/multiplayer-chess-engine (GitHub): A clean, modern implementation of a real-time chess platform built using Next.js, Node.js, WebSockets, Redis, and PostgreSQL. It explicitly solves state synchronization and spectator handling.   amiwrpremium/eye-on-chess (GitHub): A self-hostable open-source chess platform featuring Zod request validation, structured error codes, Docker-ready deployment configs, and modular TypeScript architecture.   

To build your real-money competitive chess platform, the ideal open-source repository to clone as your foundation is amiwrpremium/eye-on-chess.It provides a production-grade, self-hostable architecture out of the box—featuring a Next.js frontend, a Node.js/Socket.io backend, PostgreSQL database migrations, automated Docker setups, and an Nginx reverse-proxy configuration.   Because this is a modular project shifting from casual play to financial stakes, you will need to prune unnecessary casual logic, modify existing game loops, and inject custom financial modules.Phase 1: What to Remove or DisableTo transform a casual chess web app into a secure wagering platform, strip out or wall off these components:Free-Play Casual Matchmaking: Remove or restrict queues that allow users to jump into matches without a verified balance check or entry fee stake.Instant Takebacks and Friendly Hints: In a real-money competitive environment, features like "Take Move" or external engine assistance must be disabled during ranked stakes to prevent match manipulation and fraud.Phase 2: What to ModifyYou will need to rewrite parts of the backend event loops to incorporate financial state handling:Matchmaking Logic: Replace the simple FIFO (First-In, First-Out) player queue with a Staked Queue. When a user requests a 50 KES match, the server must verify their balance and execute an atomic PostgreSQL row lock (FOR UPDATE) before confirming the match.Game Termination & Settlement: Currently, open-source chess apps update a player's Elo rating when a checkmate or resignation occurs. You must modify this event listener so that it simultaneously triggers a financial ledger transaction: crediting 90 KES to the winner's wallet and 10 KES to your platform revenue account.Phase 3: What to Add (New Modules)You will need to build and plug in three core modules to handle user money safely:1.Wallet & Ledger Schema:Financial Database Layer.Add a new database migration creating tables for user wallets, deposit transaction tracking, and match escrow pots:SQLCREATE TABLE wallets (
    user_id UUID PRIMARY KEY REFERENCES users(id),
    balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (balance >= 0),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE deposits (
    id SERIAL PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    amount NUMERIC(10, 2) NOT NULL,
    checkout_request_id VARCHAR(255) UNIQUE,
    mpesa_receipt_number VARCHAR(255) UNIQUE,
    status VARCHAR(50) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE matches (
    id SERIAL PRIMARY KEY,
    player1_id UUID REFERENCES users(id),
    player2_id UUID REFERENCES users(id),
    stake NUMERIC(10, 2) NOT NULL,
    pot NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    winner_id UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
2.M-Pesa STK Push & Webhook Handler:Payment Gateway Module.Add an Express.js route module (routes/payments.js) to trigger Safaricom STK Push requests when users deposit funds, paired with the idempotent webhook endpoint to capture payment confirmations and credit user wallets safely.3.Server-Authoritative Settlement:Secure Escrow Engine.Implement a game-resolution middleware that validates match checkmates using chess.js on the server and executes database transactions to release the escrow pot without client interference.










This is a substantial shift from the current free-play app to handling regulated real-money matches and payments. I’ll first check the existing match lifecycle and Prisma schema to identify what’s already authoritative and what’s actually missing; then I can start with a safe, testable backend foundation rather than treat client-side balances or payment callbacks as trusted.

Created 3 todos

Searched for regex game.*complete|completed|checkmate|resign|winner|chess\.js|new Chess|transaction\( (**/apps/api/src/**), 105 results

Read package.json

Read package.json

The repo already validates chess moves and finishes games server-side, but I haven’t found wallet/payment primitives. Before choosing implementation scope, I’m checking the exact Prisma game/user models and completion transaction; the local evidence will tell us whether escrow can attach to the existing game lifecycle or needs a separate match record.

Read schema.prisma, lines 1 to 260

Read gameSocket.ts, lines 1 to 95

Read games.ts, lines 670 to 755

The code confirms the chess side already replays and validates moves on the server, while endGame currently settles only game state and Elo; there are no wallet or payment models. Before changing that lifecycle, I need a few financial-policy decisions because they directly determine escrow safety. One important adjustment to the supplied notes: acknowledge M-Pesa only after the callback is durably recorded, not before processing or persistence.

Analyzing your answers...

Q: What should the first implementation target?
A: Sandbox foundation (Recommended) - Wallet/ledger, escrow lifecycle, and mocked M-Pesa callbacks; no live money movement.
Q: How should a staked match settle on draw, abort, or disconnect/timeout?
A: Refund both stakes (Recommended) - Return each player's stake for draws and void/aborted matches; timeout follows the game result.
Q: Should the initial work include cash-outs to M-Pesa, or deposits only?
Not answered yet
I’ll treat this as a sandbox-only foundation, with full stake refunds on draws/aborts and no withdrawal path. Next I’m checking the existing matchmaking entry points and migration conventions so the first slice can tie escrow to actual games without adding a fake “deposit” endpoint that could mint spendable funds.

Starting: Implement and test foundational slice (3/3)

Read schema.prisma, lines 260 to 312

Read games.ts, lines 1 to 170

Read gameSocket.ts, lines 90 to 180

Read migration.sql, lines 1 to 150

I’m going to keep the first code milestone narrow but real: add integer-minor-unit wallet/ledger and escrow records, then make friend-challenge acceptance debit both wallets atomically and make game completion settle or refund escrow atomically. The existing challenge/accept and server-owned end-game paths are the right control points; M-Pesa credentials and live payout remain out of this sandbox slice. I’m checking the current worktree and nearby tests before the first edit so I preserve prior local changes.






The scope is now concrete: the first slice will support sandbox credits only behind a non-production guard, locked funds for friend challenges, and idempotent server-side settlement/refunds. I’m starting with the database contract in integer minor units; the immediate check is Prisma schema validation, which will catch model/relation errors before I wire any endpoints.

Edited
schema.prisma
+92
-0
pnpm --filter @eyeonchess/api exec prisma validate
The schema edit is in place, but the focused check is blocked because pnpm isn’t on this shell’s PATH. I’ll use the repo’s declared package manager through Corepack if available; if dependencies aren’t installed, I’ll still validate the migration structure and report that Prisma CLI validation couldn’t run.

corepack pnpm --filter @eyeonchess/api exec prisma validate
Neither Corepack nor a local Prisma CLI is installed. I’ll try the pinned Prisma CLI via npm exec from the package cache; this won’t add dependencies to the project manifest and is the narrowest available schema validation.

npm exec --yes --package=prisma@6.19.2 -- prisma validate --schema apps/api/prisma/schema.prisma
The host has Node but neither npm nor the Prisma CLI, so local validation isn’t available. The running API image contains the project toolchain; I’ll mount the edited Prisma directory into a one-off container and run schema validation there, without touching the live service.

podman run --rm -v "$PWD/apps/api/prisma:/app/apps/api/prisma:ro" localhost/eyeonchess-api pnpm --filter @eyeonchess/api exec prisma validate --schema prisma/schema.prisma
The Prisma model validation passes with Prisma 6.19.2. I’m adding the matching SQL migration next, including database checks that prevent negative wallet balances and invalid ledger account shapes; then I’ll generate the client and move on to the transactional game lifecycle.

Edited
migration.sql
+106
-1
The migration now mirrors the validated schema and enforces nonnegative balances, positive deposits/stakes, fee bounds, and unique idempotency/provider references. Next I’m adding the ledger posting primitive and sandbox wallet endpoint; the mock credit will be inaccessible in production, so no client or callback can mint funds in the deployed configuration.





The key local behavior is confirmed: friend games move from WAITING to ACTIVE in one route, and live game completion is owned by endGame. I’m adding a single ledger posting helper first, with an idempotency key and conditional debit; then I’ll build both stake-lock and settlement operations on that primitive.

Created wallet.ts

The ledger primitive is in place; its debit uses a single conditional database update and its journal entry shares the caller’s transaction. I’m validating this helper against a Prisma client generated from the edited schema before adding its endpoints or match integration.

podman run --rm -e DATABASE_URL='postgresql://postgres:unused@localhost:5432/unused' -v "$PWD/apps/api/prisma:/app/apps/api/prisma:ro" -v "$PWD/apps/api/src/lib/wallet.ts:/app/apps/api/src/lib/wallet.ts:ro" localhost/eyeonchess-api sh -lc 'pnpm --filter @eyeonchess/api exec prisma generate --schema prisma/schema.prisma && pnpm --filter @eyeonchess/api exec tsc --noEmit'
Read content.txt, lines 1 to 60

Prisma client generation succeeded, but the first TypeScript command ran tsc without the API tsconfig, producing unrelated module/target errors. I’m rerunning the same focused check with tsconfig.json, which will tell us whether the new helper itself typechecks.

Read content.txt, lines 1 to 30

The second check still did not use the workspace resolution correctly through pnpm exec, so its failures are environment invocation errors, not evidence about the helper. I’ll invoke the API’s declared typecheck script from its package context inside the image; that matches how the project validates itself.











Since this touches balances and game outcomes, focus on proving the backend flow before adding live payments or more features.

Apply the migration safely. Back up the local database, apply the new migration, and confirm existing users and games are unchanged. The migration has not been applied yet.
Exercise the full sandbox flow. Create a pending mock deposit, confirm the balance stays unchanged, send its success callback, retry the callback to confirm it cannot credit twice, then test a staked game through acceptance and win/draw settlement.
Build the minimal UI. The backend now has wallet and stake APIs, but the app doesn’t yet let users view balances, add mock funds, or choose a stake. Keep mock controls clearly development-only.
Keep real payments out of scope for now. Before enabling Daraja or withdrawals, design provider reconciliation, refunds and disputes, operational audit/recovery, and get the relevant legal and compliance review.
The best immediate next step is a backed-up migration followed by an end-to-end sandbox test against the actual  local database. That will validate the integration points the unit tests can’t prove.