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

The CRM keeps only the enrolment or update request number. It refuses a plain
12-digit Aadhaar number on purpose, so please don't type one into any other box.

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
- **Reports:** counts by service and by month. The admin sees counts per user.
- **`/status`:** customers check their own application with no login. They need both
  their application number and WhatsApp number, and see only the service and status.
- **தமிழ்:** the button at the top switches any page to Tamil and is remembered on
  that browser. WhatsApp messages stay in English unless you add a Tamil template
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
