# Status providers

Each file in this folder is one status source the CRM can check, such as
Certificate (e-District), Ration Card (TNPDS) or Voter Status (ECI). The server loads
every `.js` file here automatically. A provider shows up in the **Service type**
dropdown, in the customers list, in the API and in the 4-times-a-day automatic
check, with nothing else to wire up.

| File | Service | State |
|---|---|---|
| `certificate.js` | Certificate (e-District) | Working |
| `smartcard.js` | Ration Card (TNPDS) | Manual. The site blocks automated requests |
| `voter.js` | Voter Status (ECI) | Manual. Tracking needs a personal sign-in |

## Manual services

Set `manual: true` and `ready: false` when the CRM can't check a site itself. Do
not work around bot protection, captchas or sign-ins to make a service automatic.
Ask the department for official access instead.

A manual service adds these fields:

- `officialUrl`: the official status page
- `openLabel`: the button text, for example `Open TNPDS`
- `stages`: the stages in the dropdown

The button copies the customer's number and opens `officialUrl`. Choosing a stage
saves it without sending anything. Approved and rejected customers wait until
someone clicks **Send WhatsApp to ... customers** above the list. Automatic checks
skip these customers. `lookup()` only needs to throw an error.

## Adding a brand-new service

Copy `certificate.js` to a new file, say `patta.js`. Give it a unique `id` and
`name`, write `lookup()` and set `pattern` to the real number format. `lib/http.js`
gives you `request()`, which keeps cookies between calls and sends forms, and
`text()`, which strips HTML. To control where it appears in the dropdown,
add its `id` to `ORDER` in `index.js`. Files whose names start with `_` are ignored.

## What a provider exports

```js
module.exports = {
  id: 'patta',                       // stored on each customer; never change it once used
  name: 'Patta (TN)',                // shown in the dropdown and the list
  numberLabel: 'Reference number',   // label of the number field on the form
  placeholder: 'e.g. ...',           // optional hint inside the field
  pattern: '^[A-Z0-9/-]{5,30}$',     // valid number format (upper-cased first)
  page: '/patta',                    // optional: detail page that accepts ?no=
  ready: true,                       // false = no automatic checks
  lookup,                            // async (number) => result
};
```

`lookup(number)` returns one of these:

```js
// Found
{ found: true, number, status: 'Approved', remarks: '', title: 'New Patta',
  details: [['Name', '...'], ['District', '...']], sourceUrl: 'https://...' }

// The site says it doesn't exist
{ found: false, number, message: 'Application not found' }
```

Throw an `Error` for anything unexpected, such as the site being down or its
layout changing. The check is then counted as failed and the old status is kept.

You can test a provider directly:

```
http://localhost:3000/api/status?type=certificate&no=YOUR-NUMBER
```
