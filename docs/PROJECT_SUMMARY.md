# Sir Palaniyandavar Info Tech CRM: project summary

Last updated: 11 November 2026

This file covers:
- What the CRM does today, and how each part works.
- How it is hosted now.
- What has been decided.
- What is planned but **not built yet**: e-PAN emails for many shops, the server move, subscriptions, feature switches and new services.

> **Commits:** the last commit is `2602f58` ("Add PAN, operators, informed list and laptop hosting"). Everything since then works on the laptop but is **not committed or pushed to GitHub yet**.

---

## Contents
1. [What the CRM is](#1-what-the-crm-is)
2. [How it's built and run](#2-how-its-built-and-run)
3. [Features built so far](#3-features-built-so-far)
4. [Phone app (/calls) and Android app (SP Calls)](#4-phone-app-calls-and-android-app-sp-calls)
5. [e-PAN emails: how they work today](#5-e-pan-emails-how-they-work-today)
6. [e-PAN emails for many shops (planned)](#6-e-pan-emails-for-many-shops-planned)
7. [Hosting today](#7-hosting-today)
8. [Settings (.env)](#8-settings-env)
9. [Security and privacy rules](#9-security-and-privacy-rules)
10. [Decisions made](#10-decisions-made)
11. [Plan: moving to a server](#11-plan-moving-to-a-server)
12. [Costs](#12-costs)
13. [Plan: subscriptions with Razorpay](#13-plan-subscriptions-with-razorpay)
14. [Plan: feature switches per shop](#14-plan-feature-switches-per-shop)
15. [Plan: more services](#15-plan-more-services)
16. [TTD booking helper](#16-ttd-booking-helper)
17. [Open items and to-do](#17-open-items-and-to-do)

---

## 1. What the CRM is

A website for e-service shops in Tamil Nadu.
- **Tracking:** staff save each customer's government application.
- **Status:** the CRM follows the application's status, automatically where the government site allows it and by hand where it doesn't.
- **Telling customers:** staff tell customers about results on WhatsApp.

**Services covered today:**

| Service | How the status is updated |
|---|---|
| TNeDistrict certificates | Checked automatically, on a schedule |
| TNPDS (smart card), New or Correction | By hand |
| Voter ID | By hand |
| Aadhaar | By hand |
| PAN, UTI (UTIITSL) | By hand, plus automatic from e-PAN emails |
| PAN, NSDL (Protean) | By hand, plus automatic from e-PAN emails |

**Who uses it:**
- **Shop users:** staff accounts. Each shop sees only its own customers.
- **Admin (you):** approves and suspends shop accounts, and sees activity and reports. **The admin never sees customer data.**

---

## 2. How it's built and run

| Part | What it is |
|---|---|
| Server | `server.js`, Node 24, no framework |
| Website | React 19 + Vite 8 in `client/`, built into `dist/` |
| Database | PostgreSQL 18 via `pg`; tables are created or updated by `lib/db.js` at start |
| Services | One file per service in `providers/` |
| Tamil | `client/src/i18n.js` and `client/src/ta.js`, keyed by the English text |

**Commands:**
```bash
npm run build     # publishes website (frontend) changes
node server.js    # starts the server; restart it after server or database changes
```
- **Website-only change:** `npm run build`, then `Ctrl + Shift + R` in the browser.
- **Server change** (`server.js`, `lib/`, `providers/`): stop the server with `Ctrl + C`, then run `node server.js` again.

**Pages (addresses):**

| Address | Page |
|---|---|
| `/` | Public landing page, or TNeDistrict list when logged in |
| `/home` | Dashboard |
| `/tnpds`, `/voter`, `/aadhaar` | Service lists |
| `/pan/uti`, `/pan/nsdl` | PAN lists (`/pan` opens UTI) |
| `/operators` | Operator stats |
| `/profile` | Profile, operators, reports, password |
| `/activity` | Activity log |
| `/calls` | Phone app |
| `/status` | Public page where a customer checks their own application |
| `/login`, `/register`, `/forgot`, `/reset` | Accounts |
| `/admin`, `/admin/activity`, `/admin/reports`, `/admin/profile` | Admin |

---

## 3. Features built so far

### Look and feel
- **Design:** the original list layout, in the green, sand and bronze colours: `#0B0F0D`, `#1F2A1F`, `#3E5A3F`, `#8CA98C`, `#D9C7A3`, `#B08D57`. A "plum board" redesign was tried and rejected.
- **Side bar:** labels in UPPER CASE.
  - Services: Home, TNeDistrict, TNPDS, Voter, Aadhaar.
  - PAN is a card with a UTI/NSDL switch.
  - The profile menu sits at the bottom left.
  - The profile page has no side bar.
- **Login page:** redesigned, with a sample application beside the form.
- **Loading:**
  - Skeleton loading shapes on every page.
  - A dark-green loading screen appears instantly while the site loads: "SP" for the website, the phone icon for the phone app.
- **Animations:** short and light.
  - Save buttons show a spinner, then a tick, or shake on an error.
  - Customer rows slide open and shut smoothly.
  - "Reduce motion" phone settings are respected.
- **Language:** a Tamil/English switch. WhatsApp messages to customers are always in Tamil.

### Dashboard (`/home`)
- **Welcome bar:** "Welcome, name", with a bot that scans each service. It reads only the shop's own lists and never contacts government sites. Also shows the next certificate check time.
- **Four tiles:**
  - **To tell customers:** approved or rejected, not yet informed. Opens the call list.
  - **Waiting for WhatsApp.**
  - **In progress.**
  - **Added this month,** with how many were approved this month.
- **Services table:** per service, with PAN split into UTI and NSDL.
  - Columns: total, not checked, in progress, approved, rejected, to tell.
  - A bar shows where the applications stand.
- **Last 6 months chart:**
  - Added vs approved, with hover details.
  - **Show numbers** turns it into a table.
  - Colours checked for colour blindness.
- **Operators this month** and **recent activity.**
- **Server call:** `GET /api/dashboard`.

### Customer lists
- **Tabs per service:** All, Waiting, In progress, Approved, Rejected, New, Informed.
- **Search** by name, application number or phone, for shop users and the admin.
- **New/Correction filter** buttons for PAN and TNPDS.
- **Same-person count:** each row shows how many applications share that WhatsApp number. **All {n} applications** opens one list across all services (`/api/customers/by-phone`).
- **Duplicates:** the same application number can't be saved twice in any service.
- **The stage track was removed everywhere.**

### Customer rows
- **Copy buttons** for name, number and phone.
- **Informed checkbox:** ticking it crosses out the row and moves it to the **Informed** tab.
- **Expand** for notes, details, and tools to edit, delete, open the official site, and send WhatsApp.
- **New/Correction label:** a visible difference for PAN and TNPDS.

### Add forms
- **Separate form for each service.**
- **Operator choice** as click buttons.
- **Application date** defaults to today.
- **PAN:** New/Correction and birth date. **TNPDS:** New/Correction.
- **Aadhaar number:** the full number, checked with Verhoeff and stored **encrypted**. See section 9.
- **PAN UTI receipt PDF:** drag and drop, read in the browser by `client/src/panReceipt.js`. It fills in New/Correction, name, date of birth, phone, coupon number and application date. The "U-" prefix is removed.
- **PAN NSDL receipt reading:** not built yet; waiting for a sample NSDL PDF.

### Operators
- **Managing them:** add, rename and remove operators in Profile.
- **In the add form:** pick the operator.
- **Operator stats** at `/operators`.

### WhatsApp
- **One-click mode (main way today):** opens WhatsApp with a ready Tamil message, and the CRM records it as sent. **Not sent** undoes that.
- **WhatsApp Business API mode:** optional. Without `WA_TOKEN` it stays in **test mode**, which only writes to the log.
- **Known gap:** automatic API messages are still **English** ([lib/whatsapp.js:33](../lib/whatsapp.js)). One-click messages are Tamil.

### Status checks
- **TNeDistrict:** checked automatically at `CHECK_TIMES` (default 09:00, 13:00, 17:00, 21:00 India time), with a gap between checks.
- **Other services:** staff set the stage by hand.
- **Approved and rejected** customers are queued for **Send WhatsApp updates**.

### Notices (admin → shops)
- **Admin page:** `/admin/notices`, under **Notices** in the admin side bar.
- **Kinds of notice:** **Update**, **Price change** or **Notice**.
- **Who gets it:** every shop, or one shop.
- **Price changes** carry the new monthly price and the date it starts, and are always marked important.
- **Shops:** a **bell** at the top of every page shows the number of unread notices. Opening it marks them read.
- **Important unread notices**, including every price change, also pop up in **red** in the top-right corner (at the bottom on phones). **Read** opens the inbox and marks them read. **×** hides the pop-up for this visit only, and it comes back until the notice is read.
- **Read counts:** the admin sees "Read by X of Y" for each notice, and can delete a notice.
- **Who sees what:** shops only see notices sent after their account was made.
- **Not in the phone app:** phone-only sessions can't open the inbox.
- **Code:** `lib/notices.js` and the `notices` / `notice_reads` tables; `/api/inbox`, `/api/admin/notices`; `client/src/Inbox.jsx` and `client/src/AdminNotices.jsx`.

### Records and reports
- **Activity log:** for each shop and for the admin. The admin's view has no customer details.
- **Reports** in Profile. The "Last 6 months" table was removed from Profile; it's on the dashboard now.
- **Customer status page** (`/status`): a customer checks their own application with its number and their WhatsApp number.

---

## 4. Phone app (/calls) and Android app (SP Calls)

### The phone page `/calls`
**What it shows:**
- **Service tabs:** TNeDistrict, TNPDS, Voter, Aadhaar, PAN UTI and PAN NSDL, each with a count.
- **Lists:** Accepted, Rejected and Called. The newest results come first, with a **New result** mark for 48 hours.
- **Each card:** name, phone, application number, New/Correction and status.
- **Buttons on each card:**
  - **Call:** opens the dial pad (`tel:`).
  - **WhatsApp:** opens a chat with the Tamil message.
  - **Called:** works the same as Informed, with Undo for 5 seconds.
- **Also:** search, a Tamil/English switch, refresh when you come back from a call, and the last list shown when offline.

**Logging in and installing:**
- **Logging in from `/calls`:** gives a **phone-only session** for 30 days.
- **Installing:** works as an installable web app through Chrome's **Install app** button or **Add to Home screen**.
  - Files: `client/public/calls.webmanifest` and the `calls-icon-*.png` icons.

**Read-only, enforced by the server:**
- **Allowed:** a phone-only session can only list (`GET /api/calls`) and mark called (`POST /api/calls/:id/called`).
- **Refused:** everything else gets a 403, including adding customers, editing, reports, operators, profile and password changes.
- **Hidden:** no Aadhaar and no notes.
- **Logging out** clears the saved lists from the phone.

### The Android app "SP Calls" (APK)
**What it is:**
- **Folder:** `android-app/`, built with Capacitor 8.
- **App ID:** `in.sirpalaniyandavar.calls`. Version 1.1 (versionCode 2).
- **Download:** the website serves it at `/sp-calls.apk`. The file comes from `client/public/sp-calls.apk`, which git ignores.

**How it starts:**
- **First open:** the app's start page (`android-app/www/index.html`) asks for the **shop link**.
- **Accepted links:**
  - The Cloudflare link (`https://….trycloudflare.com`).
  - The laptop's Wi-Fi address, such as `192.168.0.104:3000`, where `http://` is added automatically.
- **"localhost"** is refused with an explanation, because on a phone it means the phone itself.
- **Checking a link:** the app checks it with `/ping.json`, which answers `{"app":"sp-crm"}`, then opens `<link>/calls`.
- **When the link stops working:** the app returns to the start page (`errorPath`).
- **Change link:** a button in the call list goes back to the same page.

**Phone access:**
- **Opening other apps:** `tel:` and WhatsApp links open the dial pad and WhatsApp.
- **Permission:** the only one is Internet.

**Building and updating:** see [android-app/README.md](../android-app/README.md).
- **Signing:** builds are signed with this laptop's debug key, `~/.android/debug.keystore`. **Keep building on this laptop, or back up that file**, because Android only installs updates signed with the same key.
- **New domain:** when you get a domain, add it to `allowNavigation` in `android-app/capacitor.config.json` and rebuild.

---

## 5. e-PAN emails: how they work today

**Code:** `lib/epan.js`, using `imapflow`. It **only reads** a mailbox kept just for PAN emails.

**Senders it trusts:**
- `epan.service@utiitsl.com` (UTI)
- `noreply@epan.proteantech.in` (NSDL / Protean)
- `noreply@reprint.proteantech.in` (Protean receipts)

**How it works:**
1. Every `EPAN_CHECK_MINUTES` (default 5) it reads new emails from those senders.
2. From the **subject line** it finds the application or coupon number and the stage: **Submitted → In Process → Approved**.
3. It finds the PAN customer with that number **in the one account named in `EPAN_USER`**.
4. It updates the stage. **Stages never go backwards.** Approved puts the customer on the WhatsApp list.
5. The activity log records it as "PAN email".

**Settings:** `EPAN_EMAIL`, `EPAN_APP_PASSWORD` (a Gmail app password), `EPAN_USER`, `EPAN_CHECK_MINUTES`.

**Limits today:**
- **One shop only:** it works for one mailbox and one shop account (`EPAN_USER`).
- **Not set up yet:** the real Gmail connection hasn't been tested, because the PAN mailbox isn't set up.

---

## 6. e-PAN emails for many shops (planned)

**Not built yet.** This is the agreed design, so other shops can send their e-PAN emails in.

### Each shop gets its own forwarding address
Your one PAN mailbox, with a `+` tag per shop. Gmail delivers them all to the same inbox:
- Shop A → `yourcrm.pan+shopa@gmail.com`
- Shop B → `yourcrm.pan+shopb@gmail.com`

Each shop's **Profile** page shows its own address, with a Copy button.

### What each shop does once, in its own Gmail
1. **Settings → Forwarding:** add its `+shop` address.
2. **Confirmation code:** Gmail sends it to that address, and it arrives in your mailbox. The CRM reads it and shows it on that shop's Profile page, so the shop can finish without asking you.
3. **Filter:** from `epan.service@utiitsl.com OR noreply@epan.proteantech.in OR noreply@reprint.proteantech.in` → **Forward to** its `+shop` address.

Only PAN emails are forwarded. The shop's other mail stays private.

### How the CRM sorts them
- **Which shop:** the `+shopa` tag says which shop an email belongs to.
- **Which customer:** the application number finds the customer **only within that shop**.

### Safety checks
- **Is it really from UTIITSL or Protean?** Gmail's sender checks (SPF/DKIM) must pass, so a fake "Approved" email can't be sent in.
- **Does it belong to that shop?** An email tagged `+shopa` can only update shop A's customers.
- **Is forwarding working?** Each shop's Profile shows when its last PAN email arrived.

### Rejected alternatives
- **Each shop gives its Gmail app password:** the CRM could then read the whole inbox, including personal mail, and you'd be storing many passwords. Too risky.
- **Your mailbox as the applicant's email on the PAN form:** the customer would never receive their own e-PAN. Not good practice.

---

## 7. Hosting today

- **Laptop setup:**
  - Guide: `deploy/LAPTOP_SETUP.md`.
  - Script: `deploy/laptop/setup.sh`. It installs PostgreSQL 18, Node 24 and cloudflared, and adds system services for the site, the tunnel and nightly backups.
  - Packaging: `deploy/make-package.sh` makes the package that is copied to the laptop.
- **Public link:** a Cloudflare **quick tunnel**. `sudo crm-link` shows the current link.
  - **The link changes whenever the tunnel or laptop restarts.**
- **Shop Wi-Fi:** `http://192.168.0.104:3000`. The router may change this address, so reserving it for the laptop in the router settings stops it changing.
- **Backups:** nightly database backup, kept 14 days (`backup.sh`, `crm-backup.timer`).

---

## 8. Settings (.env)

`.env` is private. Never share it or commit it. The template is `.env.example`.

| Setting | What it does |
|---|---|
| `DATABASE_URL` | PostgreSQL connection |
| `AADHAAR_KEY` | Encrypts Aadhaar numbers. **If lost, saved numbers can't be read.** Keep a private copy |
| `APP_URL` | The site's public address, used in reset emails and the sitemap |
| `COOKIE_SECURE` | `on` when served over https |
| `HOST` | `127.0.0.1` hides the site from the network, so only the tunnel reaches it |
| `BEHIND_TUNNEL` | `on` behind Cloudflare, so login limits see the real visitor |
| `CHECK_TIMES`, `CHECK_GAP_SECONDS` | Automatic TNeDistrict checks |
| `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_TEMPLATE`, `WA_TEMPLATE_LANG`, `WA_NOTIFY` | WhatsApp Business API (optional) |
| `EPAN_EMAIL`, `EPAN_APP_PASSWORD`, `EPAN_USER`, `EPAN_CHECK_MINUTES` | e-PAN mailbox reading |

---

## 9. Security and privacy rules

- **Admin:** never sees customer data.
- **Aadhaar numbers:**
  - **Encryption:** full numbers are allowed since 6 November 2026, but only **encrypted** with AES-256-GCM, tied to that customer.
  - **Kept out of:** CSV export, search, WhatsApp messages and the status page.
  - **Logged and limited:** showing or copying a number is recorded in the activity log, and how often it can be done is limited.
- **Passwords:** stored only as salted scrypt hashes. Sessions are stored only as hashes.
- **Login limits:**
  - Login: 5 wrong tries per 15 minutes.
  - Registration, password reset and the status page: their own limits.
- **Phone-only sessions:** can only read lists and mark calls, enforced on the server.
- **Other websites:** requests from them are blocked.
- **Captchas:** never bypassed. Services with captchas are updated by hand.
- **GitHub:** only source code is pushed, **never customer data or `.env`**. Repo: `Sripalaniyandavarinfotech/Status-check`.

---

## 10. Decisions made

| Date | Decision |
|---|---|
| Earlier | Keep the original list design; the plum board redesign was rejected |
| 6 Nov 2026 | Full Aadhaar numbers allowed, encrypted only |
| Earlier | PAN receipts: UTIITSL only for now. NSDL waits for a sample PDF |
| 11 Nov 2026 | **Website only.** Installed Windows software and an admin hub were dropped. Shops can't work offline anyway, because every government portal is online |
| 11 Nov 2026 | The phone page and SP Calls APK stay |
| 11 Nov 2026 | Payments, when built, are **subscriptions: shops pay you** |

---

## 11. Plan: moving to a server

**Target:** AWS **Lightsail**, **Mumbai** region, **Ubuntu 24.04**, 2 GB plan (1 GB is fine to start), with your own **domain**.

### Two ways to connect the domain
| | Named Cloudflare tunnel | Direct with Caddy |
|---|---|---|
| Setup | Domain's DNS on Cloudflare | An A record pointing at the server's static IP |
| HTTPS | Cloudflare | Caddy, free and automatic (Let's Encrypt) |
| Open ports | None | 80 and 443 |
| Code change | None (`BEHIND_TUNNEL=on` already works) | Add a `BEHIND_PROXY=on` setting, so login limits see the real visitor |

### Server checklist
1. **Lightsail:**
   - Create the server and attach a static IP.
   - Firewall: SSH only from your IP, plus 80/443 if using Caddy.
   - Daily snapshots on.
   - AWS budget alert at about ₹2,000 a month.
2. **Basic safety:** SSH keys only, automatic security updates, fail2ban, a 2 GB swap file, India time zone.
3. **Software:** reuse `setup.sh`: PostgreSQL 18, Node 24, the CRM in `/opt/crm` running as the `crm` user. Leave out the laptop-only lid and sleep settings.
4. **`.env`:**
   - Copy **`AADHAAR_KEY` from the laptop. It must be the same key.**
   - Set `APP_URL` to the domain, `COOKIE_SECURE=on` and `HOST=127.0.0.1`.
5. **Move the data:**
   1. Stop the laptop CRM.
   2. Export with `pg_dump`.
   3. Copy the dump and the key with `scp`, never by email.
   4. Restore on the server.
   5. Check user and customer counts, and that one Aadhaar number opens.
   6. Keep the laptop copy for a week.
6. **Backups:**
   - Nightly database backup on the server.
   - A copy to AWS S3 in Mumbai.
   - Lightsail snapshots.
   - A monthly restore test.
7. **Watching:** UptimeRobot (free) on `/ping.json`. Logs with `journalctl -u crm`.
8. **Update links:**
   - Add the domain to the SP Calls app and rebuild the APK.
   - Tell the shops the new link.
9. **Test before switching:**
   - Log in, add, edit, and mark informed.
   - **TNeDistrict check from the AWS address** (government sites may block cloud servers).
   - A scheduled check, an e-PAN email, a PAN PDF upload, a reset email, the phone app, and a backup restore.

**Files to prepare:** `deploy/server/setup.sh`, a laptop-to-server move script, `deploy/SERVER_SETUP.md`.

**A domain is needed for:**
- **HTTPS:** secure logins, and installing the phone app.
- **A fixed link** for shops, the phone app and password reset emails.
- **Razorpay approval.**

---

## 12. Costs

Approximate, at $1 ≈ ₹88, with 18% GST on AWS. Check current prices before paying.

### Website (chosen)
| Item | Cost |
|---|---|
| Domain `.in` | ₹600–1,000 a year |
| Lightsail 2 GB, Mumbai | ≈ ₹1,250 a month (1 GB ≈ ₹850 a month) |
| Snapshots | ≈ ₹250–350 a month |
| HTTPS, Cloudflare DNS, UptimeRobot, Gmail SMTP, one-click WhatsApp, APK download | Free |
| **Total** | **≈ ₹1,100–1,600 a month + domain ≈ ₹19,000–20,000 a year** |

**Optional:**
- Play Store account: ₹2,200 once.
- WhatsApp API: ≈ ₹0.12–0.15 per message.
- Business email: ≈ ₹150–200 per user a month.
- S3 backup copy: ≈ ₹20–50 a month.

**As you grow:**

| Shops | Monthly cost |
|---|---|
| 1–10 | ₹1,100–1,600 |
| 10–50 | ₹1,600–3,000 |
| 50–150 | ₹3,000–8,000 |

**Pricing to shops:** at ₹300–500 a month per shop, 5 shops cover the hosting.

### Why not Vercel, MongoDB or Supabase alone
- **Vercel:** its functions stop after each request.
  - Scheduled checks and e-PAN reading would break.
  - The server would need rewriting.
  - The free plan is non-commercial only.
- **MongoDB:** a full rewrite of the database code, for no gain.
- **Supabase:** fine as a PostgreSQL database.
  - Free projects pause, and the free tier has no backups.
  - It doesn't host the server.

---

## 13. Plan: subscriptions with Razorpay

**Not built yet.** Shops pay you to use the CRM.

### How it works for a shop
1. Register, and you approve.
2. **Free trial**, for example 14 days.
3. **Billing** page in Profile: the plan, the amount and what's included.
4. **Subscribe:** Razorpay Checkout, with **UPI Autopay** or card auto-debit set up once.
5. Charged automatically each month, with a GST invoice emailed.

### Calculating the amount automatically
- **Plan amount** through Razorpay Subscriptions.
- **Extras:** before each renewal, usage and extras are added as Razorpay **add-ons**.

**Example bill:**

| Item | Amount |
|---|---|
| Standard plan | ₹299 |
| e-PAN email reading switched on | ₹99 |
| 340 applications (40 above the 300 included × ₹1) | ₹40 |
| **Subtotal** | **₹438** |
| GST 18% (only if GST-registered) | ₹78.84 |
| **Total** | **₹516.84** |

**Also possible:** yearly plans, coupons, and charging only the difference for a mid-month upgrade.

### When a payment fails
1. Razorpay retries.
2. The shop sees a banner, plus email and WhatsApp reminders.
3. Grace period, for example 7 days.
4. **Read-only:** the shop can view and export, but can't add customers. Its data is never locked away.
5. Paying turns everything back on instantly.

### Admin billing page
- Each shop's plan, status, next charge and amount.
- Revenue, payments, refunds and invoices.
- Marking offline (cash or UPI) payments as paid.
- Extra trial days, coupons and plan changes.
- Still no customer data.

### To build
- Billing tables (plans, subscriptions, payments, invoices).
- The Billing page and the admin billing section.
- **A Razorpay webhook** with signature checks.
- A monthly usage count sent as add-ons.
- GST invoice PDFs.
- Read-only enforcement on the server.
- Reminders.

### Needed before going live
- **Domain and server move**, because Razorpay needs a fixed `https://` link for webhooks.
- **Razorpay KYC:** PAN, bank account, and Udyam or GST proof.
- **Policy pages:** Terms, Privacy, Refund/Cancellation, Contact and Pricing.
- **Fees:** about 2% per payment on the standard plan. Money reaches your bank in about 2 working days.
- **Testing:** can be built and tested in Razorpay **test mode** before going live.

### Decisions still needed
1. **Plans:** one plan or Basic / Standard / Premium? Monthly, yearly, or both?
2. **Pricing:** flat, or extra above a number of applications?
3. **Trial length** and **grace period**.
4. **GST:** are you GST-registered?

---

## 14. Plan: feature switches per shop

**Not built yet.**
- **Built once:** every feature is built once into the same website.
- **Switched per shop:** the admin turns features on or off for each shop with switches, such as PAN receipt upload, e-PAN emails, Aadhaar storage, the phone app, or a new feature made for one shop.
- **Switched off means gone:** the feature disappears for that shop, and the **server also refuses it**.
- **For new shops:** you choose which features they start with.
- **One version, one update:** no separate copy per shop.
- **Ties in with plans.** Proposed plans, not built yet:

| | Standard | Premium |
|---|---|---|
| Monthly | ₹399 | ₹599 |
| Yearly (2 months free) | ₹3,990 | ₹5,990 |
| All services, automatic TNeDistrict checks | ✅ | ✅ |
| One-click Tamil WhatsApp, Informed list, search | ✅ | ✅ |
| Dashboard and notices | ✅ | ✅ |
| Operators, with operator stats | Unlimited | Unlimited |
| PAN UTI receipt PDF upload | ✅ | ✅ |
| Reports and CSV download | ✅ | ✅ |
| Aadhaar number storage (encrypted) | ✅ | ✅ |
| TTD booking helper | – | ✅ |
| e-PAN email reading | – | ✅ |
| Phone app (`/calls` and SP Calls APK) | – | ✅ |
| Automatic WhatsApp messages (Business API) | – | ✅ |
| Features made on request | – | ✅ |

**Notes on the plans:**
- **Free trial:** 14 days of Premium.
- **Aadhaar storage:** off by default for each shop, even on Standard and Premium. Switch it on only for shops that need it, and check the Aadhaar rules with a CA or lawyer before offering it widely.

---

## 15. Plan: more services

**Not built yet.** Each one can be a feature switch.

**Most useful:**
- Patta transfer / land records (TN eServices, Tamil Nilam)
- Passport (Passport Seva)
- Driving licence and LLR (Parivahan Sarathi)
- Vehicle RC (Parivahan Vahan)
- EB connection (TNPDCL)
- Kalaignar Magalir Urimai Thogai
- PM-Kisan
- Birth and death certificates

**Also common:**
- Udyam, GST and FSSAI
- e-Shram
- Labour Welfare Boards
- CMCHIS / Ayushman card
- Scholarships
- Marriage registration and encumbrance certificate (TNREGINET)
- Income tax return

**How each would be updated:**
- **By hand** (most, because of captchas or OTP). Quick to add.
- **Automatically**, only where the site has no captcha; each needs checking first.
- **From emails**, like e-PAN, where the portal emails results (GST ARN, Udyam, Passport).

**Next step:** pick the 3–4 services your shops handle most.

---

## 16. TTD booking helper

**Built on 12 November 2026.** Pages: `/ttd` (bookings) and `/ttd/book` (booking mode; `?side=1` for the side window). Code: `lib/ttd.js`, `lib/ttd-api.js`, the `ttd_bookings` / `ttd_pilgrims` tables, `client/src/Ttd.jsx`, `TtdForm.jsx`, `TtdBook.jsx`, `ttdShared.js`.

TTD tickets sell out in minutes, so every detail TTD asks for is prepared the day before and is **one click to copy**, in the same order as the TTD form. The CRM **never fills in the TTD site by itself** and never gets around its captcha or OTP: staff paste each detail themselves.

### Booking types and their rules
| Type | Pilgrims | Date choice | Extra check |
|---|---|---|---|
| ₹300 Special Entry Darshan | 1 to 6 | Yes | – |
| Angapradakshinam | 1 or 2 | Yes | – |
| E-DIP | 1 or 2 | **No date** | – |
| Senior citizen | 1 or 2 | Yes | At least one member aged **75 or over** |

**Date choice** (all types except E-DIP): **one fixed date**, **any date in a range**, or **any date**.

### Details saved for each booking
These follow the TTD form.
- **General details, once per booking:** email address, city, state (Tamil Nadu by default), country (India by default), pincode (6 digits).
- **Pilgrim details, one row per pilgrim:** name, age, gender (Male / Female / Other), photo ID proof (**Aadhaar**), photo ID number.
  - The Aadhaar number is checked with Verhoeff and stored encrypted, like today.
- **For the CRM itself:** the customer's WhatsApp number (for sending the ticket), the operator, and notes. Details can also be filled in from an existing customer.
- **Ready:** a booking becomes Ready once every check passes.

### Booking mode (on booking day)
- **Copy buttons in TTD's order:** Email, City, State, Country, Pincode; then for each pilgrim Name, Age, Gender, ID proof, ID number. One click copies, and the next field lights up.
- **Gender and ID proof** are dropdowns on TTD, so they are shown in big letters to pick, not copied.
- **Copy next:** one key copies the next field each time, so staff just alternate between paste and that key.
- **Shortcuts:** ↑ ↓ to choose a pilgrim, number keys to copy a field.
- **Side window:** booking mode can open narrow, beside the TTD site.
- **Loaded before release time,** with a countdown and a beep a minute before.
- **Queue** of Ready bookings, with **Booked**, **Failed** and **Try again** buttons.
- **Aadhaar numbers:** booking mode opens all the ready bookings' Aadhaar numbers once when it loads (logged as "Opened TTD booking mode", at most 40 loads per 10 minutes), so copying during the rush never waits for the server.
- **Copying works** on `https://` and on the shop Wi-Fi `http://` address.

### After booking
- Save the **TTD reference number** and the **ticket PDF**.
- Send the customer the ticket details on WhatsApp in Tamil, with one click.
- Bookings show on the dashboard and in reports.

**Plan:** Premium only.

---

## 17. Open items and to-do

**Waiting on you:**
- [ ] Send a sample **NSDL receipt PDF**, so NSDL receipt reading can be built.
- [ ] Set up the **e-PAN mailbox** and its `.env` values, then test the real Gmail connection.
- [ ] Choose a **domain name**.
- [ ] Answer the **subscription decisions** in section 13.
- [ ] Choose which **new services** to add first.
- [ ] Have a native Tamil reader check the Tamil wording, especially the short labels in the phone app: "ஏற்பு", "நிராகரிப்பு", "அழைத்தவை", "அழைத்தேன்".
- [ ] Try SP Calls on a **real Android phone**.

**To build (agreed or suggested):**
- [ ] Automatic WhatsApp API messages in **Tamil**, to match one-click.
- [ ] e-PAN emails for many shops (section 6).
- [ ] Feature switches per shop (section 14).
- [ ] Server setup files and the move (section 11), including `BEHIND_PROXY` if using Caddy.
- [ ] Razorpay subscriptions (section 13).
- [ ] New services (section 15).
- [ ] Try the TTD booking helper on a real booking day, and check the Tamil wording.
- [ ] "Who called" operator pick in the phone app.

**Housekeeping:**
- [ ] **Commit** everything since `2602f58`, then push the source code to GitHub, never `.env` or data.
- [ ] Back up `~/.android/debug.keystore` (the APK signing key) and the `AADHAAR_KEY`.
