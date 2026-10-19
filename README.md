# SafeRoute Verify

SafeRoute Verify is a React + Vite school-transport verification prototype with a small Node.js API. Driver and school accounts are registered through the API; registration returns to the sign-in page and does not sign the new account in automatically.

## Run locally

1. Use Node.js 20 or newer and run `npm install`.
2. Start the API in one terminal with `npm run server`.
3. Start the frontend in another terminal with `npm run dev`.
4. Open the local URL printed by Vite.

The Vite development server proxies `/api` requests to `http://localhost:3001`. The API stores account records and uploaded document files under `data/` (excluded from Git). Set `API_PORT` to change its port and update the Vite proxy if needed.

## Verification officer account

Public registration supports driver and school accounts. Verification officer access is not self-registrable. Configure an officer account before starting the API:

```powershell
$env:ADMIN_EMAIL = "officer@example.com"
$env:ADMIN_PASSWORD = "use-a-unique-password"
npm run server
```

Use that email and password with the **Verification officer** sign-in role. The API hashes passwords, authenticates protected routes, stores documents on disk, and requires a current uploaded file before an officer can verify a driver's document. An application cannot be approved until all six required documents have been uploaded and verified.

## Workspaces

- **Drivers:** upload or replace PDF, JPG, or PNG documents (up to 10 MB each), track review status, and edit profile and vehicle details.
- **Verification officers:** download submitted documents, verify or request current documents, approve or reject applications, suspend a driver, and export a CSV report.
- **Schools:** search approved drivers and manage route assignments.

This local JSON-backed API is for development and demonstration, not production deployment. Production use needs a hardened database and file store, secure cookie/session handling, backups, deployment-specific access controls, and authorised integrations for official licence, criminal-record, or roadworthiness checks.
