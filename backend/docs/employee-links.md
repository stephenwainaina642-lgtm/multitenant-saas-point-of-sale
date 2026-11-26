# Employee sign-in links

Employees > Add employee > **Send a sign-in link** (default) creates a single-use link and a 6-digit PIN, shown once.
Send the link by message or email and give the PIN separately (for example by phone). The employee opens
`/#staff=<token>`, enters the PIN and chooses their own password; nobody else ever sees it. They then sign in normally.

* Valid 7 days, works once, locked to the invited email. A new link for the same person replaces the old one.
* Only hashes of the token and PIN are stored (table `employee_invites`). Five wrong PINs burn the link.
* Needs `employees.manage`; the role must not exceed the inviter's own permissions; the owner role cannot be invited.
* An email that already has an account cannot be invited; add that person directly (they keep their own password).
* "Set a password myself" and "Reset password" (temporary password) still exist.
* Link e-mailing is not built: copy the link. Cancel or review links under Employees > Sign-in links.

Deploy: back up, then `npx prisma migrate deploy --config prisma7.config.ts` (migration `20261225090000_employee_invites`, additive), redeploy Render.
