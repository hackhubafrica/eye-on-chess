Podman is rejecting the unqualified Docker Hub image names, and the app builds also need a local eyeonchess-base image before startup. I updated docker-compose.yml and the Dockerfiles’ Docker Hub FROM references to use docker.io, and added the Podman setup steps to quick-start.md.

Build the shared base image, then retry startup:

```sh
podman build -t eyeonchess-base -f deployment/Dockerfile.base .
podman-compose --env-file .env -f deployment/docker-compose.yml up -d
```

The rootless port issue is resolved. The stack is running, nginx is healthy, and the app returned HTTP 200 at http://localhost:8080.

I changed the production port defaults to 8080:80 and 8443:443, made HTTPS redirects follow the configured port, and fixed nginx’s health check to use IPv4 loopback. The updated setup is in docker-compose.yml, and the local URL is documented in quick-start.md.

One separate warning remains: Promtail expects /var/run/docker.sock, which isn’t present in this Podman setup, so container log collection won’t run. That did not prevent the app from starting.

The console shows the login requests are going to http://localhost/api/... on port 80, but your rootless stack is published on 8080. I’ll trace how the web image gets NEXT_PUBLIC_API_URL and wire its build-time value to the configured HTTP port, then rebuild the web service and verify the browser-facing API route.






The production web image’s Dockerfile compiles NEXT_PUBLIC_API_URL at build time, and the compose service currently doesn’t pass a build argument. The browser bundle is therefore using its http://localhost default (port 80); I’ll check the active .env value and then set the build arg to the external URL, making this correct for both rootless local use and custom deployments.

Your active .env confirms NEXT_PUBLIC_API_URL=http://localhost, which targets port 80. I’ll update that local value to http://localhost:8080, pass the variable as a build arg to both web and admin images, and align the example/defaults so a rebuild bakes the right browser API URL into the bundles.

The compose build args and local URL are now aligned on port 8080. I’m first verifying Podman’s resolved build configuration uses that value, then I’ll rebuild the two frontend images so their compiled bundles stop requesting port 80.

```sh
podman-compose --env-file .env -f deployment/docker-compose.yml config | rg -n -A8 'dockerfile: apps/(web/Dockerfile.prod|admin/Dockerfile)'

podman-compose --env-file .env -f deployment/docker-compose.yml config | rg -n -C3 'NEXT_PUBLIC_API_URL|localhost:8080|args:'
```

The rendered model confirms both frontend builds receive NEXT_PUBLIC_API_URL=http://localhost:8080. I’m rebuilding and recreating just web and admin now; afterward I’ll check their logs/bundles and probe the API endpoint through nginx.

```sh
podman-compose --env-file .env -f deployment/docker-compose.yml up -d --build web admin
```

Both frontend builds compiled successfully with the corrected URL. Podman emitted a separate missing-certbot-container message during compose’s recreate pass, so I’m verifying the web/admin containers are actually up and that a login POST now reaches the API instead of failing with connection refused.

```sh
podman ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'

curl -sS -o /tmp/eoc-login-response -w 'HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' --data '{}' http://127.0.0.1:8080/api/v1/auth/login && head -c 300 /tmp/eoc-login-response

podman exec eyeonchess-web sh -c "grep -Rho 'http://localhost[^" ]*' /app/apps/web/.next/static | sort -u | head -10"
```
The rebuilt web and admin containers are healthy, nginx is healthy, and the compiled web assets now include localhost:8080. The plain localhost string also remains as the source fallback, so I’m doing a final minimal HTTP-status probe to distinguish a reachable API response from a connection failure.

The 500 was caused by a CORS origin mismatch: the browser came from http://localhost:8080, but the API’s SITE_URL was http://localhost. I updated SITE_URL in your local .env and the example config, then recreated the stack so the API loaded the new setting.

Verified: a test login request with the localhost:8080 origin now reaches normal credential validation and returns 401 for the deliberately invalid test account, instead of 500. Try signing in again at http://localhost:8080.



This is a substantial shift from the current free-play app to handling regulated real-money matches and payments. I’ll first check the existing match lifecycle and Prisma schema to identify what’s already authoritative and what’s actually missing; then I can start with a safe, testable backend foundation rather than treat client-side balances or payment callbacks as trusted.

The repo already validates chess moves and finishes games server-side, but I haven’t found wallet/payment primitives. Before choosing implementation scope, I’m checking the exact Prisma game/user models and completion transaction; the local evidence will tell us whether escrow can attach to the existing game lifecycle or needs a separate match record.

The code confirms the chess side already replays and validates moves on the server, while endGame currently settles only game state and Elo; there are no wallet or payment models. Before changing that lifecycle, I need a few financial-policy decisions because they directly determine escrow safety. One important adjustment to the supplied notes: acknowledge M-Pesa only after the callback is durably recorded, not before processing or persistence.

Analyzing your answers...

Q: What should the first implementation target?
A: Sandbox foundation (Recommended) - Wallet/ledger, escrow lifecycle, and mocked M-Pesa callbacks; no live money movement.
Q: How should a staked match settle on draw, abort, or disconnect/timeout?
A: Refund both stakes (Recommended) - Return each player's stake for draws and void/aborted matches; timeout follows the game result.
Q: Should the initial work include cash-outs to M-Pesa, or deposits only?
Not answered yet
I’ll treat this as a sandbox-only foundation, with full stake refunds on draws/aborts and no withdrawal path. Next I’m checking the existing matchmaking entry points and migration conventions so the first slice can tie escrow to actual games without adding a fake “deposit” endpoint that could mint spendable funds.

I’m going to keep the first code milestone narrow but real: add integer-minor-unit wallet/ledger and escrow records, then make friend-challenge acceptance debit both wallets atomically and make game completion settle or refund escrow atomically. The existing challenge/accept and server-owned end-game paths are the right control points; M-Pesa credentials and live payout remain out of this sandbox slice. I’m checking the current worktree and nearby tests before the first edit so I preserve prior local changes.

The scope is now concrete: the first slice will support sandbox credits only behind a non-production guard, locked funds for friend challenges, and idempotent server-side settlement/refunds. I’m starting with the database contract in integer minor units; the immediate check is Prisma schema validation, which will catch model/relation errors before I wire any endpoints.

The Prisma model validation passes with Prisma 6.19.2. I’m adding the matching SQL migration next, including database checks that prevent negative wallet balances and invalid ledger account shapes; then I’ll generate the client and move on to the transactional game lifecycle.

The migration now mirrors the validated schema and enforces nonnegative balances, positive deposits/stakes, fee bounds, and unique idempotency/provider references. Next I’m adding the ledger posting primitive and sandbox wallet endpoint; the mock credit will be inaccessible in production, so no client or callback can mint funds in the deployed configuration.

The key local behavior is confirmed: friend games move from WAITING to ACTIVE in one route, and live game completion is owned by endGame. I’m adding a single ledger posting helper first, with an idempotency key and conditional debit; then I’ll build both stake-lock and settlement operations on that primitive.

Created wallet.ts

The ledger primitive is in place; its debit uses a single conditional database update and its journal entry shares the caller’s transaction. I’m validating this helper against a Prisma client generated from the edited schema before adding its endpoints or match integration.


The wallet and escrow helpers now cover atomic stake locks, 90/10 pot settlement, and complete draw/abort refunds; each ledger posting is idempotent, and the platform fee is recorded separately. The focused editor check reports no errors in this service, so I’m adding a sandbox-only wallet route next, disabled by default and always disabled under production.


The sandbox wallet route passes the focused file check. It requires both PAYMENTS_MODE=mock and a non-production NODE_ENV, enforces request idempotency, caps sandbox credits at 1,000 KES, and does not add any public production callback that can mint funds. I’m now wiring stake locking into friend-challenge acceptance, preserving the free-game behavior when no stake is requested.

Friend-game challenges can now request a stake (capped at 1,000 KES), and acceptance claims the waiting game plus both debits in one transaction; insufficient funds roll everything back. The targeted editor check passed, and I’m completing the two missing control points next: route registration and payout/refund in the game-completion transaction.

Game completion now claims the active game and settles its escrow inside the same transaction as Elo changes, so duplicate end events can’t pay twice. The editor has no errors in the routes, but lacks installed dependencies for the socket module; I’m running a fresh API image build against the current files to catch real Prisma/type issues before adding more behavior.

The fresh API image builds successfully and generates Prisma Client from the new models, confirming the current schema is consumable by the production build path. Next I’m adding test coverage for the guarded sandbox-credit path and extending the shared Prisma test double so transaction behavior can be exercised without touching the running database.

The wallet test double and three focused tests are in place: empty balance, production guard, and idempotent sandbox credit. I’m running just that route test inside the API image with the current source and schema mounted, which will catch missing mocks and route behavior before the broader game settlement edits continue.

```sh
podman run --rm -e DATABASE_URL='postgresql://postgres:unused@localhost:5432/unused' -v "$PWD/apps/api/src:/app/apps/api/src:ro" -v "$PWD/apps/api/prisma:/app/apps/api/prisma:ro" localhost/eyeonchess-api sh -lc 'pnpm --filter @eyeonchess/api exec prisma generate --schema prisma/schema.prisma >/dev/null && pnpm --filter @eyeonchess/api test -- src/routes/wallet.test.ts'
```

The test process picked up the full suite and then failed because the API image omits the root tsconfig.base.json; it did not reach the new route test. I’m rerunning only wallet.test.ts with that shared config mounted into the container so Vitest can transform the test files.

Vitest still cannot resolve its tsconfig in the image despite the root config mount, so this is a container test harness issue rather than a test assertion failure. I’m checking the API’s tsconfig and Vitest config path assumptions to mount the exact file it expects, then I’ll resume the tests.

The test harness issue is resolved, and the focused test now runs; it exposed one straightforward test bug: vi wasn’t imported from Vitest. I’m fixing that and will rerun the same test file.

All seven focused wallet/escrow tests pass, including 90/10 payout math, full refunds, idempotency, and the production sandbox guard. I’m adding route-level tests now for stake capture at challenge creation and atomic acceptance when both players have funds versus when one debit fails.

I implemented a sandbox-only backend foundation, not a production real-money platform.

It adds integer-minor-unit wallets and balanced ledger entries, pending mock deposits with a token-protected, idempotent callback, and optional stakes on friend challenges. Both players’ funds are locked atomically when the challenged player accepts. Wins settle at 90/10; draws and aborted games refund both stakes. I also blocked challenge creators from accepting their own challenge and restricted resignation/draw actions to game participants.

The sandbox is disabled by default and unavailable in production. Live Daraja STK Push, withdrawals, wallet/challenge UI, and regulatory controls are not implemented. Do not use this to accept real funds.

Validation passed: Prisma schema validation, API typecheck, API image build, and 47 focused tests. The migration has not been applied to your running database. Before running the updated API, apply it and rebuild:

```sh
podman-compose --env-file .env -f deployment/docker-compose.yml run --rm migrate
podman-compose --env-file .env -f deployment/docker-compose.yml up -d --build api
```

The sandbox setup and API behavior are documented in wallet.md; the schema and migration are in schema.prisma and migration.sql.


# focus on proving the backend flow before adding live payments or more features.

Apply the migration safely. Back up the local database, apply the new migration, and confirm existing users and games are unchanged. The migration has not been applied yet.
Exercise the full sandbox flow. Create a pending mock deposit, confirm the balance stays unchanged, send its success callback, retry the callback to confirm it cannot credit twice, then test a staked game through acceptance and win/draw settlement.
Build the minimal UI. The backend now has wallet and stake APIs, but the app doesn’t yet let users view balances, add mock funds, or choose a stake. Keep mock controls clearly development-only.
Keep real payments out of scope for now. Before enabling Daraja or withdrawals, design provider reconciliation, refunds and disputes, operational audit/recovery, and get the relevant legal and compliance review.
The best immediate next step is a backed-up migration followed by an end-to-end sandbox test against the actual local database. That will validate the integration points the unit tests can’t prove.

# Backup and migration completed. 
The compressed database backup is eyeonchess_pre_wallet_20261008_064659.sql.gz (13,926 bytes); its archive integrity check passed. Both wallet/escrow migrations are recorded as finished, and Prisma reports no pending migrations.

The database-backed test exercised mock deposit creation, callback crediting and duplicate-callback handling, then created and accepted a 50 KES staked friend game. The server’s timeout path completed it and settled escrow. The winner’s mock wallet now has 9,000 minor units (KES 90), platform revenue has 1,000 (KES 10), and the game ledger balances to zero. During the test, the callback exposed a ledger constraint bug; I applied a forward migration to fix it. I also fixed callback-token log redaction and verified the token appears redacted.

Production mode is restored: the API is healthy, the site returns HTTP 200, and the sandbox callback returns 404. No real money was moved.

The local database retains test data: user e2e-1791431941205, its mock KES 90 balance, and the completed test game. I left these records intact because their ledger references are intentionally restrictive.


The database-backed callback and 50 KES escrow path were already exercised successfully, so I’ll build the missing user-facing flow now: wallet balance/history, a clearly development-only mock deposit action, and an optional stake amount in the existing friend challenge UI. First I’m locating those frontend/API client surfaces and their local component patterns.

The app already has a dedicated “Challenge a Friend” page and central API client, so I’ll add the stake selector there and a new wallet page linked from the existing play/account flow rather than inventing a separate navigation system. I’m reading those exact components and their loading/error/form conventions now.

I found one missing link in the sandbox flow: the browser can create a pending mock deposit, but only the server-side callback token can confirm it. I’ll add an authenticated, owner-scoped, development-only confirmation endpoint so the wallet UI can simulate that callback without ever exposing the secret; the cheap disconfirming check is a test proving production and cross-user confirmation cannot credit funds.

The patch context didn’t match the current wallet route, so nothing changed. I’m taking a narrow read of its current imports and route tail to anchor the same endpoint patch accurately, then I’ll rerun the focused route test.

The endpoint is now anchored to the current route and the server remains the only place that can confirm a mock deposit. I’m running the existing focused wallet-route tests immediately to catch any routing/type regressions before I add the new endpoint-specific assertions and UI.

The existing wallet-route tests still pass. I’m adding targeted assertions for the new confirmation action: it must be hidden in production, reject a deposit owned by someone else, and post wallet plus clearing entries exactly once for the owner.

The mock confirmation tests pass: production rejects it, another user can’t confirm it, and the owner’s confirmation produces both balanced ledger rows. I’m building the wallet screen around the existing API/auth patterns next, with recent ledger history and a mock-fund form that appears only when the frontend is explicitly built in mock mode.

Edited
page.tsx
+199
-1
Edited
page.tsx
+12
-0
Edited
Dockerfile.prod
+2
-0
Edited
docker-compose.yml
+1
-0
Edited
.env.example
+2
-0
The wallet screen is added with balance, ledger history, and an explicitly build-flagged mock deposit flow; the Play page links to it. I’m running the production web build now as the focused validation, which will typecheck the page and confirm the mock UI flag is compiled through the Docker build configuration.

The wallet page compiles successfully and appears at /wallet; the Play link is in place. Next I’m wiring stake selection into friend challenges and showing the amount in the incoming challenge modal, so the player accepting knows what will be locked before they accept.

The incoming socket event currently omits the stake, so the recipient would otherwise accept without seeing the amount. I’m adding that amount to the event, a free/staked segmented selector with wallet balance feedback, and a visible insufficient-funds error in the accept modal.

Edited
games.ts
+1
-0
Edited
page.tsx
+75
-1
Edited
ChallengePopup.tsx
+13
-2
Read content.txt, lines 165 to 220

The wallet and stake pages are building, and the current build has passed the initial dependency stages without emitting a TypeScript error so far. I’m checking the build’s final result now, then I’ll add focused UI tests and exercise the wallet screen in the browser with the local mock flag enabled temporarily.

The updated production web build succeeds, including /wallet and the challenge route. I’m checking the existing web test setup now so I can add a small regression test for balance rendering and the mock-fund interaction before doing the full browser run.

The stake selector and recipient-visible stake are wired, and I added a focused wallet-page test for balance/history rendering. Next I’m validating the API confirmation endpoint against the current Prisma types and tests; after that I’ll temporarily enable the mock build flag and use the browser against the real local database.

The API typecheck and focused wallet/payment/game suites pass (44 tests). I’m temporarily setting the local compose build flag and API mock mode to run the actual UI flow against your database; these settings will be reverted to production after the browser test.

Both API and web images built. I’m checking the resolved compose build argument now to ensure the mock controls are actually compiled into this temporary web image before I restart it.

The mock-mode images are running; podman-compose also restarted nginx/admin as part of its recreate behavior. I’m checking service health and then opening the wallet page in the browser to exercise the balance and add-funds controls end to end.

Opened Browser

The stack is healthy, the API is in temporary mock mode, and the browser has loaded the wallet route (redirecting to login as expected). I’m signing in and checking that the compiled mock-funding controls appear, then I’ll add a small test deposit and verify the displayed balance/history update.

The wallet screen is live in the browser: it shows the current balance and ledger history, and the “Add mock funds” control is visibly labeled local-testing-only. I’m using it for a real KES 10 sandbox deposit now, then I’ll verify the balance and entries update from the local database.

The browser deposit completed through both wallet endpoints: the UI now shows KES 10.00 and a new deposit ledger row. Next I’m checking that friend challenges expose the Free/Stake choice and include the selected amount in the confirmation, then I’ll restore production mode and rebuild the default-disabled UI.

Navigated to http://localhost:8080/play/friend in Browser

The stake selector is visible and correctly shows the wallet’s KES 10 balance and a KES 20 pot for a KES 10-per-player stake. The time-control picker intercepted the first click while I tried to open its confirmation; I’m switching to its unobstructed “No Time Limit” option to verify the final challenge summary without creating an extra game.

The challenge confirmation now visibly says “Stake: KES 10 each (KES 20 pot),” and I canceled it so no extra waiting game was created. I’m rebuilding the mock-enabled web image once more to include the new page test, then I’ll verify the browser-created KES 10 ledger entry and restore the production defaults.

podman build --target builder -t eyeonchess-web-test --build-arg NEXT_PUBLIC_API_URL=http://localhost:8080 --build-arg NEXT_PUBLIC_PAYMENTS_MODE=mock -f apps/web/Dockerfile.prod . && podman run --rm eyeonchess-web-test sh -lc 'cd /app/apps/web && pnpm exec vitest run src/app/wallet/page.test.tsx'
The production build succeeds, but the repository’s Docker ignore rules omit test files, so the temporary builder image couldn’t see the new Vitest file. I’ll mount that test into the builder container explicitly and run it there; the actual browser wallet and stake flows have already rendered correctly.

podman run --rm -v "$PWD/apps/web/src/app/wallet/page.test.tsx:/app/apps/web/src/app/wallet/page.test.tsx:ro" -v "$PWD/apps/web/vitest.config.ts:/app/apps/web/vitest.config.ts:ro" -v "$PWD/apps/web/src/test-setup.ts:/app/apps/web/src/test-setup.ts:ro" localhost/eyeonchess-web-test sh -lc 'cd /app/apps/web && pnpm exec vitest run src/app/wallet/page.test.tsx'
The wallet test is now found and transformed, but the builder image runs with NODE_ENV=production, so React’s test utilities reject act(). I’ll rerun that same test under NODE_ENV=test; this is an execution-environment mismatch, not a UI assertion failure.

The wallet UI regression tests pass. The browser test also left KES 10.00 of mock funds in the local admin wallet, as intended. I’m removing the temporary development/mock flags now and rebuilding the app with the default-disabled mock UI so your running stack returns to its production configuration.

The final production images build successfully with NEXT_PUBLIC_PAYMENTS_MODE=disabled; the mock control won’t appear in the normal build. I’m updating the wallet guide with the exact local opt-in and confirmation flow before restarting the stack on these production-default images.

The docs now explain the local UI flag and owner-only mock confirmation route. The stack has been recreated from the final images with NODE_ENV=production and the mock UI build flag disabled; I’m checking that the wallet still reads correctly while the mock control and API endpoint are hidden again.

Navigated to http://localhost:8080/wallet in Browser

The production wallet page still shows the persisted KES 10 balance and ledger row, and the API is healthy. One direct production-guard probe was unauthenticated, so it got the normal 401 auth response before reaching the mock guard; I’m repeating it with a valid admin token and reading back the database totals.

The browser-created KES 10 deposit is persisted as one USER_WALLET +1000 row and one CLEARING -1000 row; the admin balance is now KES 10.00. Production is restored, the authenticated mock-confirm endpoint returns 404, and the mock UI is hidden by default. I’m doing the final changed-file diagnostics and marking the implementation complete.

Implemented the wallet and stake UI, and exercised the mock funding flow against the local database.

Added a wallet page with balance, recent ledger entries, and a local-only mock-funds control: wallet page. It’s linked from Play.
Added Free/Stake selection, amount and balance feedback, and stake details in the incoming challenge modal: friend challenge, challenge modal.
Added an authenticated, owner-only mock deposit confirmation endpoint. The API still blocks it in production: wallet routes.
Documented the local opt-in in wallet docs.
In the browser, I added KES 10 through the mock flow; the wallet updated to KES 10.00 and Postgres recorded balanced +1000 wallet and -1000 clearing entries. I also verified the stake confirmation showed KES 10 each, KES 20 pot without creating another game. The earlier database-backed staked-game test settled successfully.

The API and web builds pass, the wallet UI tests pass (2 tests), and the focused API suite passes (44 tests). Production mode is restored: mock controls are hidden by default and the mock-confirm endpoint returns 404. The local admin wallet currently holds KES 10 in simulated funds; no real payment was made.

I’ll keep Daraja and withdrawals disabled; they’re production gates, not part of this test. I’ll set up a fresh simulated opponent with known local credentials, fund both wallets, establish friendship, then run a staked challenge and settlement through two browser sessions. Afterward I’ll restore production settings; I’ll also outline the provider, dispute, recovery, and legal reviews needed before live money.

The stack is healthy, nine registration invites are available, and the admin has KES 10.00 in simulated balance. I’ll reuse that balance and create one fresh opponent; only the web build flag and API runtime will be switched temporarily, not any Daraja credentials or live-payment settings.

The mock-enabled build completed, but Docker reused cached layers, so I’m verifying the resolved flag before relying on the UI. Next I’ll create a fresh disposable opponent, fund both wallets, and use separate browser sessions for challenge acceptance.

The simulated opponent sim-1791434411877 is registered and friends with the admin; each wallet was funded with KES 50 through the local sandbox. I’ll now use two browser sessions to send a KES 10 challenge, accept it as the opponent, and finish an actual chess game so settlement is driven by server-validated game events.

Opened Browser

Read Browser

The browser tool shares the admin session across tabs, so I’m setting up a separate browser context for the simulated opponent rather than logging one player out mid-test. I’ll drive challenge creation and acceptance in two isolated sessions and inspect the game controls before choosing a result action.

The opponent login form didn’t expose an accessible “Email” label to Playwright, so the two-context script stopped before any challenge was sent. No game or stake was created. I’ll inspect the login page’s actual controls and retry with role-based selectors that match the rendered form.

The opponent successfully logged in and both accounts can see each other, but the scripted click on the friend row timed out before sending a challenge; the page remains on the friend picker and no escrow has been created. I’m retrying the browser sequence with direct locator clicks and progress checkpoints so we can tell whether the blocker is the picker interaction or the live socket challenge event.

I found another integration gap while tracing that 401: the HTTP /games/:id/resign route is labeled for bot games but currently accepts any participant and updates game status without settling escrow. I’m not using that shortcut to call the test successful. I’ll first retry the live socket flow with freshly authenticated browser contexts; if it still fails, I’ll close the route gap before finishing the test.

Read games.test.ts, lines 670 to 760

The session reset confirms the socket path is unreliable for this scripted browser run, and the route inspection found a concrete issue: the existing authenticated resignation endpoint can end a staked game without settling escrow. I’ll route resignation through the same guarded server endGame transaction as socket checkmate/timeout, then test that fallback path against the active simulated game.

The API typecheck passed, but the focused route test caught a test-fixture gap: the new finalizer uses a conditional game.updateMany claim, while this test only mocked the old direct update. I’m updating that mock and rerunning the same game-route suite now.

The shared finalizer’s runtime fails under the route test harness, so I’m switching the HTTP fallback to a direct atomic transaction: conditionally claim an active game, settle its escrow, and return the resignation result. That preserves the existing response behavior while ensuring the REST path cannot leave a staked escrow held.

The resignation endpoint now passes typecheck and all 35 game-route tests. I’m strengthening that exact test to include a held escrow and verify that resigning posts the winner payout and marks escrow settled, then I’ll rebuild and apply it to the pending local simulation.

The focused resignation test now verifies the payout and SETTLED escrow, and I removed a mistakenly placed fixture from the unrelated free-challenge test. I’ll run the full game route suite plus API typecheck, then deploy the fixed API and use the active local simulation to finish settlement through authenticated resignation.

The active simulated game has now ended through the authenticated resignation API, which calls the tested escrow transaction. The response is BLACK_WIN; I’m verifying the persisted settlement and balances now, then I’ll restore production settings and rebuild the mock-disabled web/API images.

Settlement is verified: game COMPLETED by resignation, escrow SETTLED, and the ledger nets -200 user-wallet units, +200 platform units, and zero escrow remainder (KES 2 platform fee). I’m restoring production config, rebuilding with mock UI disabled, and will run one final check that sandbox endpoints are hidden.

The final images built with the mock UI default disabled. I’m running the focused API and wallet UI regression suites one last time, then checking production health and the authenticated mock-route guard.

Final checks pass: API typecheck plus 50 focused financial/game tests, and both wallet UI tests. I’m verifying the production containers and authenticated mock-endpoint response, then I’ll give you the exact status and the review checklist for future live payments.

Completed: Check sandbox and runtime state (1/5)

The simulated two-player flow completed; Daraja and withdrawals remain disabled. I created and funded sim-1791434411877, sent it a KES 10-per-player challenge through the browser, accepted it for the opponent, and finalized it through authenticated resignation. The game is COMPLETED, escrow is SETTLED, and the ledger balances across wallets, escrow, and platform revenue. The application’s resignation endpoint now settles escrow atomically; the real socket resignation UI did not complete in this browser run because its socket session was unauthenticated.

Production settings are restored. API and web containers are healthy, /wallet returns HTTP 200, and the authenticated mock-confirm endpoint returns 404. Validation passed: API typecheck, 50 financial/game tests, 2 wallet UI tests, and git diff --check.

The database retains simulated test data: sim-1791434411877, the earlier e2e-1791431941205 account, their wallet balances, and test games/ledger entries. No real funds were moved.

Before enabling live payments

Complete a threat model and obtain written advice from Kenyan payments/gaming counsel on licensing, prize competitions, AML/KYC, age limits, consumer protection, taxes, and data handling. Confirm requirements directly with relevant regulators and Safaricom; a technical prototype is not approval to launch.
Build a provider reconciliation process that imports Daraja transactions, matches checkout IDs and receipts against internal deposits, handles missing/late/conflicting callbacks, and produces daily settlement reports reviewed by an operator.
Define refunds, failed/expired STK requests, reversals, chargebacks, abandoned matches, disconnections, disputes, appeals, and payout correction procedures. Keep all corrections as compensating ledger entries; never edit history or balances manually.
Add an operational audit trail for every actor/action, provider payload hash, idempotency key, status transition, and administrator decision. Redact secrets and personal data.
Design recovery drills: backup/restore, migration rollback strategy, stuck pending deposits, replayed callbacks, ledger-versus-provider reconciliation, and controlled escrow repair with dual approval.
Only then implement Daraja credentials/secrets, callback authentication, rate limits, monitoring/alerts, transaction limits, and withdrawal controls in a separate sandbox-to-production rollout.
The most useful next engineering step is automated end-to-end coverage for two authenticated browser contexts, including socket authentication, actual move validation, resignation/checkmate settlement, and draw refunds.

STK Push is a payment-entry method, not an escrow account. It asks a customer to approve a payment on their phone; it does not, by itself, safeguard funds or make a paid chess competition legally permissible.

How STK Push deposits work

Your business obtains the appropriate Safaricom M-Pesa business setup and Daraja production access.
After the authenticated user requests a deposit, your server creates a PENDING deposit record and asks Daraja to initiate the STK Push. The request includes the business shortcode, amount, customer phone number, callback URL, and a unique account/reference value.
Daraja’s immediate response means the request was accepted for processing, not that payment succeeded. Keep the deposit pending.
Safaricom later sends the result to your HTTPS callback. After durably recording the callback, your system acknowledges receipt and processes it idempotently.
Credit the user’s ledger only after verifying the callback’s checkout identifiers, result, amount, phone/reference, and related deposit. Reconcile against Safaricom transaction-status/statement data as an independent control. Do not treat a browser redirect, screenshot, or SMS as proof of payment.
A callback URL must be reachable from Safaricom; localhost won’t work. Use Daraja’s sandbox first with a controlled public HTTPS callback, then request production access and credentials through Safaricom’s business onboarding process. Keep consumer secrets and passkeys server-side.

Can Paybill be a fallback?

Yes, potentially. A customer can manually pay your business Paybill and include a unique account/reference number. The integration is different: you generally register Safaricom C2B validation and confirmation URLs, then match confirmed transactions to pending deposits.

The main operational risk is unmatched or incorrect references. Define a process for duplicates, wrong amounts, missing references, delayed confirmations, reversals, and refunds. Hold ambiguous transactions in suspense for review; don’t guess which user to credit. Confirm the supported setup and terms with Safaricom for the specific shortcode and business arrangement. STK Push can be more convenient, while Paybill can be a manual alternative, but neither replaces reconciliation.

What should hold the funds?

Treat these as separate layers:

Payment collection: Safaricom’s merchant shortcode or Paybill receives the customer payment under its merchant terms.
Safeguarding/escrow: A bank, licensed trustee, or other properly authorized arrangement holds or controls funds under a written agreement, if counsel and the relevant regulators confirm that structure is appropriate.
Your application ledger: Records who is owed what and the state of each deposit, stake, refund, and settlement. A database ledger is not itself a bank account or legal escrow.
Don’t assume an ordinary Paybill balance, merchant account, or company operating account qualifies as escrow or legally segregated customer money. Ask a Kenyan lawyer experienced in payments and gaming regulation, your bank, and Safaricom what structure is permitted for this exact product. A paid entry fee with a prize or revenue split may trigger gaming/betting and payment obligations; get a written regulatory assessment before soliciting real deposits or promising payouts.

Practical order

Get written legal advice on licensing, customer-fund safeguarding, AML/KYC, age limits, consumer disclosures, taxes, complaints, and refunds.
Agree with a bank or authorized safeguarding provider on the funds flow, account ownership, reconciliation, fees, reversals, and payout permissions.
Ask Safaricom to confirm the appropriate merchant product, STK Push and C2B Paybill availability, production onboarding requirements, callback expectations, and settlement process.
Design operational procedures for daily provider-to-ledger reconciliation, unmatched payments, disputes, refunds, reversals, stuck deposits, and audited manual corrections.
Test the full lifecycle in Daraja’s sandbox and your application’s mock environment. Keep withdrawals and real-money stakes disabled until legal, provider, and operational sign-offs are complete.

distinguish shipping the service from shipping an app:

The existing Podman images containerize the server stack: API, web app, Postgres, Redis, and proxy. That’s useful for deploying a test server, not something most players should install.
The web client is a Next.js app. Testers can use it in a browser and install it as a PWA on supported phones.
If you later want an Android installable app, package the web client with Capacitor. Desktop packaging is possible too, but I’d start with browsers and Android rather than adding several distribution paths at once.
Recommended testing setup

Create a separate hosted staging deployment with its own database, Redis, domain, and test accounts. Do not let testers use your current local database or production data.
Keep NODE_ENV=production in staging. The current sandbox API guard also disables mock deposits in production, so don’t expose the app by running it as development. Before public staging, change the guard to allow mock payments only through an explicit server-side staging setting, and fail closed otherwise.
Build a staging web image with the mock UI enabled, while keeping all real Daraja credentials and withdrawal paths absent. The backend must be the authority; a frontend build flag only decides whether to show the mock controls.
Give testers a URL over HTTPS, seeded accounts, and clear instructions that balances are simulated and have no cash value. Use a resettable staging database or a documented way to reseed test data.
Test on desktop and mobile browsers first. Check registration/login, wallet display, mock deposit, friend requests, stake selection, acceptance, moves, resignation, draw/refund, reconnects, and ledger history.
Once that works reliably, package the web client for Android using Capacitor and distribute it privately for testing. Treat app-store release as a separate step; real-money competition can introduce additional platform and regulatory requirements.
A safe sequence is private browser staging → Android test package → broader user testing. Keep live deposits and withdrawals disabled throughout this phase. The key staging change before inviting external testers is an explicit server-side mock-payment gate that works with production security settings, not simply setting the whole app to development mode.