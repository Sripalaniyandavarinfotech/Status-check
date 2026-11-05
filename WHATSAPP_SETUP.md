# Connecting your business WhatsApp

The CRM sends customers a WhatsApp message automatically when their application
moves to a new stage, for example from pending to approved or rejected. It uses
the official **WhatsApp Business Platform (Cloud API)** from Meta.

Until you finish these steps the CRM runs in **test mode**. It notes each update
it would have sent but sends nothing. You can see these notes on the main page
and in the server log.

## What it costs

Meta charges per message. Status updates count as **Utility** messages, which cost
a small fee each in India; check Meta's current WhatsApp pricing page for the rate.
Meta may also give some free messages each month. Messages that customers send
you, and your replies within 24 hours, are handled differently. See Meta's pricing
page for details.

## 1. Set up the WhatsApp Business Platform

1. Go to <https://business.facebook.com> and create a **Meta Business** account,
   or use the one you already have.
2. Go to <https://developers.facebook.com>, then **My Apps → Create app**.
   Choose **Business** as the type and add the **WhatsApp** product.
3. Under **WhatsApp → API Setup**, add your business phone number and verify it
   with the code Meta sends.
   - A number used on the normal WhatsApp or WhatsApp Business **app** may need to
     be moved over. Meta lets some Business app numbers keep using the app at the
     same time ("coexistence"). If Meta doesn't offer that for your number, use a
     separate number for the CRM.
4. On the same page, copy the **Phone number ID**. Be careful: this is not the
   phone number itself.

## 2. Create a permanent access token

The token shown on the API Setup page expires after 24 hours. To get one that
doesn't expire:

1. Open **Business Settings → Users → System users**, add a system user, and give
   it the **Admin** role.
2. Click **Add assets**, choose your app, and give it full control.
3. Click **Generate new token**. Choose your app and tick
   `whatsapp_business_messaging` and `whatsapp_business_management`.
4. Copy the token. This is your `WA_TOKEN`.

## 3. Create the message template

Meta only lets a business start a conversation with a template it has approved.

1. Open **WhatsApp Manager → Message templates → Create template**.
2. Fill it in like this:
   - Category: **Utility**
   - Name: `application_status_update`
   - Language: **English**
   - Body:
     ```
     Hello {{1}}, there is an update on your {{2}} application {{3}}. Current status: {{4}}. Thank you.
     ```
   The CRM fills the 4 blanks in this order: {{1}} customer name, {{2}} service
   (for example "Certificate (e-District)"), {{3}} application number,
   {{4}} new status.
3. Submit it. Approval usually takes from a few minutes to a few hours.

To use Tamil or other wording, create the template that way, keeping the same 4
blanks in the same order. Then set `WA_TEMPLATE` and `WA_TEMPLATE_LANG` (for
example `ta`) to match.

## 4. Put your details into the CRM

1. Copy `.env.example` to a new file named `.env` in the project folder.
2. Fill in your details:
   ```
   WA_TOKEN=paste-your-permanent-token
   WA_PHONE_NUMBER_ID=paste-the-phone-number-id
   WA_TEMPLATE=application_status_update
   WA_TEMPLATE_LANG=en
   ```
3. Restart the server.

The main page should now say **"WhatsApp connected."**

## 5. Test it

On the main page, click **Send update** on a customer whose number is your
own. You should get the message within a few seconds. If it fails, the error
message from Meta appears in the list and in the server log. The usual causes are:

- the template isn't approved yet
- the template name or language doesn't match
- the token has expired

## When messages are sent

- **Automatically:** when a check (scheduled or **Check**) finds a different status
  from last time, and the application exists.
- **Ration card and voter:** only when you click **Send WhatsApp to ... customers**
  above the customer list. It sends to everyone you marked as approved or rejected
  who hasn't had that update yet. Other stages are saved without a message.
- **Not on the first check** of a certificate after adding a customer. That check
  is only the starting point.
- **By hand:** click **Send update** to send the current status at any time.

Each customer keeps their last 20 send records. Hover over the note under the
status to see the exact text.

To stop all automatic messages, set `WA_NOTIFY=off` in `.env` and restart the
server.
