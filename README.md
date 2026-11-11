# Sir Palaniyandavar Info Tech CRM

Tracks customers' certificate, ration card, voter and Aadhaar applications, and sends
WhatsApp updates.

It runs on Node.js with a PostgreSQL database.

## Run it

```
node server.js
```

Then open <http://localhost:3000>. Keep the terminal open: the certificate checks
only run while the server is on.

## Use it from other devices

The server starts with its network address, for example `Other devices on your network: http://10.209.19.99:3000`. Phones and computers on the same Wi-Fi can open that address while this computer is on and the server is running.

The address can change when the Wi-Fi reconnects, and the connection isn't encrypted, so use this only on a network you trust. Set `APP_URL` in `.env` to this address so password reset links work on other devices.

To reach the site from anywhere, host it on a server with a domain and HTTPS.

## PAN

Each service opens from the side bar. PAN has two parts, **UTI** at `/pan/uti` and **NSDL** (Protean) at `/pan/nsdl`, each with its own number format and tracking site. It works like the other services, with stages set by hand, and the **Open UTIITSL** or **Open Protean** button opens that agency's tracking page.

**Upload receipt** in the Add PAN customer form reads a UTIITSL PDF receipt, chosen or dragged in, and fills in the type, name, date of birth, mobile number, application number and application date. The PDF is read in the browser: it isn't sent to the server or saved. Check the details before saving. It works on PDFs with real text, not scanned ones.

## e-PAN emails

The site can read PAN emails and move the matching PAN customer on. It reads only the sender and subject, opens the mailbox read-only, and never downloads the attachments.

| Sender | Subject | Stage |
|---|---|---|
| `epan.service@utiitsl.com` | Your PAN is allotted … Coupon number:- A… | Approved |
| `noreply@reprint.proteantech.in` | PAN Application - ack. No. N- … | Submitted |
| `noreply@epan.proteantech.in` | Your PAN application … dated … | In Process |
| `noreply@epan.proteantech.in` | PAN allotment letter for your PAN application … | Approved |

A stage never goes backwards, and only Approved puts the customer on the WhatsApp list.

Use a mailbox that receives only these emails, so the site never has access to your other mail:

1. Create a new Gmail account for this.
2. Turn on 2-Step Verification for it, then create an **app password** at <https://myaccount.google.com/apppasswords>.
3. In your main Gmail, open Settings, then **Forwarding and POP/IMAP**, and add the new address as a forwarding address. Gmail emails a confirmation code to the new account.
4. In your main Gmail, create a filter with **From** set to `epan.service@utiitsl.com OR noreply@epan.proteantech.in OR noreply@reprint.proteantech.in`, set to **forward** to the new address.
5. In `.env`, fill in `EPAN_EMAIL`, `EPAN_APP_PASSWORD` and `EPAN_USER` (your CRM user ID), then restart the server.

The PAN page then shows when the mailbox was last read, and lists any allotted numbers that aren't in your customer list.

## Operators

Each user keeps their own list of operators on the Profile page. If the list has names, choosing one is required when adding a customer. Renaming an operator changes it on all their customers. Deleting one keeps the customers, with no operator shown.

## WhatsApp without Meta setup

Until `WA_TOKEN` and `WA_PHONE_NUMBER_ID` are set, updates go out from the user's own WhatsApp. **Send on WhatsApp** opens a ready-written Tamil message, and the user presses send there. It's free, but the site can't see whether they pressed send, so it records "Opened in WhatsApp" and offers **Not sent** to take it back.

## Run it on an old laptop

[deploy/LAPTOP_SETUP.md](deploy/LAPTOP_SETUP.md) turns a spare laptop into a server that shop owners can reach through a free Cloudflare Tunnel.

## Database

All users, customers and WhatsApp history are saved in PostgreSQL. The tables are
created by themselves when the server starts. On a new computer, once:

```
sudo -u postgres createuser --pwprompt crm
sudo -u postgres createdb --template=template0 --encoding=UTF8 --owner=crm crm
```

Then add this line to `.env`, using letters and numbers only in the password:

```
DATABASE_URL=postgres://crm:YOUR_PASSWORD@localhost:5432/crm
```

To save a full copy of the database to `backups/`:

```
npm run backup
```

Keep copies somewhere other than this computer as well. `copy-data-to-database.js`
moved the old JSON files in once, and is safe to run again.

## First time: create the admin

```
node create-admin.js
```

Choose a user ID and password in the terminal. Run it again with the same user ID
to reset the admin password.

## Aadhaar numbers

Each service box has its own add form. The Aadhaar form has an optional box for the 12-digit Aadhaar number. It's saved
encrypted with `AADHAAR_KEY`, and shown as XXXX XXXX 1234 until someone clicks
**Show**. Each look is recorded in the activity log, and the number hides again after
30 seconds. It stays out of CSV files, search, messages and the status page, and
the admin never sees it.

Run `node create-aadhaar-key.js` once, then restart the server. Keep a private copy
of the key: without it, saved numbers can't be read, even from a backup.

Only type Aadhaar numbers into that box. Other boxes aren't encrypted, and the
application number box refuses them on purpose. Storing Aadhaar numbers has legal
duties, so get advice on them and tell customers why you keep theirs.

## Users

- Users log in at `/`. The admin logs in at `/admin`.
- People register at `/register`, then wait for the admin to accept or refuse them.
- The admin can also add a user directly, and change any user's password.
- Each user sees and checks only their own customers.
- The admin sees username, phone number and WhatsApp numbers saved, never customers.
- Suspending a user logs them out and stops their automatic checks. Nothing is
  deleted, and activating them brings everything back.

## What's on each page

- **Customers:** one box per service, 25 customers to a page. Open a customer to
  edit them, add notes, or set a stage.
- **Activity:** each user sees what they did. The admin sees who did what, but never
  which customer.
- **Landing page:** the main address for visitors, with the services and the status
  check. Logged-in staff go straight to their customers.
- **Profile menu:** the icon at the top right opens Profile, Activity, the language
  switch and Log out.
- **Profile:** the page in that menu. Shows WhatsApp messages sent, a summary, charts
  and monthly counts. It also holds **Change password**, which needs the old password,
  and **Reset my data**. That needs the user's password and removes all their
  customers, notes and WhatsApp history. Their login stays, other users are not
  affected, and the activity log keeps a record. It can't be undone, except from a
  backup made with `npm run backup`.
- **Reports:** for the admin, counts per user and per month, never customers.
- **`/status`:** customers check their own application with no login. They need both
  their application number and WhatsApp number, and see only the service and status.
- **தமிழ்:** the switch in the profile menu, or at the top of the login pages, shows
  the site in Tamil and is remembered on that browser. WhatsApp messages stay in English unless you add a Tamil template
  (see WHATSAPP_SETUP.md).

Automatic checks skip applications that are finished (approved, issued, delivered,
completed, rejected or cancelled). **Check now** on a customer still works.

## Errors and search engines

- Addresses that don't exist, and other server problems, show a full error page.
- Actions that fail show a popup in the middle of the screen. Mistakes in a form
  show beside the box. Details stay in the server terminal, not on screen.
- `/sitemap.xml` lists the public pages, and `/robots.txt` keeps search engines out
  of the rest. Both use `APP_URL`.

## Forgotten passwords

Reset links go out through [FormSubmit](https://formsubmit.co), from `lib/mail.js`.

- Set `APP_URL` in `.env` to the address people use, or the links will point at
  localhost and only work on this computer.
- FormSubmit asks each email address to confirm once. The first request sends an
  activation email; after confirming, the user asks for the link again.
- Links work once, for 30 minutes. Send problems appear in the server terminal,
  starting with `[reset email]`.

Before putting the site on the internet, serve it over https and set
`COOKIE_SECURE=on` in `.env`.

## Change the website

The website is a React app in `client/`. After changing it:

```
npm run build
```

`server.js` serves the finished site from `dist/`, so refresh the browser to see
the change. While working on the design, run `npm run dev` beside `node server.js`
and open the address it prints. Changes then appear straight away.

On a new computer, run `npm install` and `npm run build` first.

## More

- [WhatsApp setup](WHATSAPP_SETUP.md)
- [Adding a status service](providers/README.md)
