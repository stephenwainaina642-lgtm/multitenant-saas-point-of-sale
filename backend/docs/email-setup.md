# Setting up e-mail (makes "Forgot password?" work)

nexaPOS sends one kind of e-mail: the password-reset link. Without the settings below, the
"Forgot password?" screen says e-mail is not set up. (Staff can still be reset by the owner from
Employees, and owners by the platform admin.)

You need an e-mail account that is allowed to send through SMTP. Pick ONE of the options.

## Option A: Gmail with an App Password (quickest, fine for a start)
Limit: about 500 e-mails a day, and the "from" address is the Gmail address.

1. Use a Google account for the business, e.g. `nexapos.mail@gmail.com`.
2. Turn on 2-Step Verification: https://myaccount.google.com/security
3. Create an App Password: https://myaccount.google.com/apppasswords
   - Name it "nexaPOS", click Create, copy the 16 letters (spaces do not matter).
   - Do not paste this password into any chat. It goes only into Render (step below).
4. In Render: your service -> Environment -> add:

   | Key | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_SECURE` | `0` |
   | `SMTP_USER` | the Gmail address |
   | `SMTP_PASS` | the 16-letter app password |
   | `MAIL_FROM` | `nexaPOS <nexapos.mail@gmail.com>` |
   | `APP_URL` | `https://multitenant-saas-point-of-sale.vercel.app` (no trailing slash) |

5. Save. Render redeploys. If `SMTP_HOST` is set but `MAIL_FROM` or `APP_URL` is missing, the server
   refuses to start and the deploy log says so.

## Option B: a transactional e-mail service (better once you have customers)
Brevo, Resend, Mailgun, Amazon SES or Zoho all give you the same five values (host, port, user,
password, from-address). Use port `587` with `SMTP_SECURE=0`, or port `465` with `SMTP_SECURE=1`.
Their free tiers cover this use. Verify your own domain with them (SPF/DKIM) so reset e-mails do
not land in spam; Gmail App Passwords skip this because the mail is sent as Gmail.

## Test it
1. Open the site, click "Forgot password?", enter an owner's e-mail.
2. The page always replies "if that account exists, a link was sent" (it never reveals which e-mails
   are registered). The e-mail should arrive within a minute; check Spam the first time.
3. Click the link; it opens the site with a "choose a new password" form. Links work once and expire.
4. If nothing arrives: Render -> Logs, search for "mail" to see the error. Common causes: wrong app
   password, 2-Step Verification off, `SMTP_SECURE` wrong for the port, or `APP_URL` mistyped.

Reset requests are rate-limited, and setting a new password signs the user out everywhere.
