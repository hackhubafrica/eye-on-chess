# Wallet & Payments (Sandbox)

This is an experimental sandbox foundation, not a real-money payment integration. It does not call Safaricom Daraja, support withdrawals, or establish legal eligibility to offer paid competition. Do not use it to accept or pay real funds.

## Enable the Local Mock

Sandbox endpoints are available only when both conditions hold:

- `NODE_ENV=development`
- `PAYMENTS_MODE=mock`

To show the mock-funding control in the web UI, also build with `NEXT_PUBLIC_PAYMENTS_MODE=mock`. The default is `disabled`. The browser flag only controls visibility; the API still checks its server-side environment and rejects sandbox requests in production.

For direct mock callback testing, set `MPESA_SANDBOX_CALLBACK_TOKEN` to a random server-side secret. Never include that token in browser code or logs. The normal wallet UI uses an authenticated owner-only confirmation route and does not expose this callback token.

## Wallet

`GET /api/v1/wallet` requires authentication and returns the user's current balance in KES minor units plus the latest 50 ledger entries. For example, `5000` means KES 50.00.

`POST /api/v1/wallet/sandbox-deposits` requires authentication, an `Idempotency-Key` header, and a JSON body with an integer `amountKes` from 1 to 1000:

```json
{ "amountKes": 50 }
```

It creates a `PENDING` mock deposit and returns a `checkoutRequestId`. It does not credit the wallet. Reusing the same idempotency key and request returns the existing deposit; changing the amount or user with that key returns a conflict.

The local wallet UI then calls `POST /api/v1/wallet/sandbox-deposits/:id/confirm`. This development-only route can confirm only the authenticated user's pending deposit. It simulates provider success and posts balanced wallet/clearing entries in the same transaction. Repeating the confirmation does not credit funds again.

## Mock Callback

`POST /api/v1/payments/mpesa/sandbox-callback` is unauthenticated like a provider webhook, but requires the `x-sandbox-callback-token` header to match `MPESA_SANDBOX_CALLBACK_TOKEN`. Example success payload:

```json
{
  "checkoutRequestId": "mock-checkout-id-from-deposit-response",
  "resultCode": 0,
  "receiptNumber": "MOCK-RECEIPT-001"
}
```

A nonzero `resultCode` marks the pending deposit failed. A successful callback conditionally changes the deposit from `PENDING` to `SUCCEEDED`, records the receipt, posts balanced clearing and wallet ledger entries, and commits before returning HTTP 200. Repeated callbacks do not credit the wallet again. Unknown checkout IDs return 404.

## Staked Friend Games

A friend challenge can include `stakeKes` from 1 to 1000. Both players' wallets are debited only when the challenge is accepted. The game activation, both debits, ledger entries, and escrow record share one database transaction; if either balance is insufficient, the transaction rolls back.

For a completed win, the current sandbox rule credits 90% of the pot to the winner and records 10% as platform revenue. A draw or aborted game returns each player's full stake. Timeout and resignation use the server-resolved winner. The match-completion path is guarded to settle each escrow only once.

Ledger amounts use integer minor units and each deposit, escrow funding/release, payout, and fee has balancing account entries. This is an implementation foundation, not a substitute for independent financial reconciliation, provider verification, chargeback handling, fraud controls, age/KYC/AML processes, or jurisdiction-specific gaming/payment approvals. Those must be designed and reviewed before any live-money deployment.
