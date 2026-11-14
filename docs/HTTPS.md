# HTTPS on the shop's computer and Wi-Fi

The site runs on two addresses at the same time:

| Address | Used for |
|---|---|
| `https://localhost:3443` and `https://<Wi-Fi address>:3443` | Everyday use in the browser. Needed for the pinned TTD booking window on other computers. |
| `http://localhost:3000` and `http://<Wi-Fi address>:3000` | The SP Calls phone app and the Cloudflare tunnel. Left as it is. |

Change the ports with `HTTPS_PORT=` and `PORT=` in `.env`. To turn HTTPS off, set `HTTPS=off`.

## 1. Make the certificate (once)

```bash
node create-https-cert.js
```

This creates `data/https/`, which is never pushed to GitHub:

- `ca.crt`: the shop's own "certificate authority". Each device trusts it once.
- `ca.key`: its private key. **Keep it private.** Anyone holding it could fake websites on devices that trust `ca.crt`. Never send it to anyone or copy it to other devices.
- `server.crt` and `server.key`: the site's certificate. It covers `localhost`, this computer's name and its current Wi-Fi address.

If the Wi-Fi address changes (for example the router gives a new one), run the command again and restart the server. The certificate authority stays the same, so devices don't need to trust it again.

Extra names can be added: `node create-https-cert.js 192.168.1.20 crm.local`

## 2. Restart the server

Stop it with `Ctrl + C`, then run `node server.js`. It prints:

```
Secure (HTTPS): https://localhost:3443
Secure on your network: https://192.168.0.104:3443
```

## 3. Trust `ca.crt` on each device (once)

Until you do this, the browser shows "Your connection is not private".

**Brave or Chrome on Linux (this laptop)**
1. Open `brave://settings/certificates` (Chrome: `chrome://settings/certificates`).
2. Open **Manage imported certificates from Linux** if it is shown, then go to **Authorities**, then **Import**.
3. Choose `data/https/ca.crt` and tick **Trust this certificate for identifying websites**.
4. Close the browser fully and open it again.

**Windows (other shop computers)**
1. Copy only `ca.crt` to the computer (by pen drive or WhatsApp to yourself).
2. Double-click it and choose **Install Certificate**, then **Current User**.
3. Choose **Place all certificates in the following store**, then **Browse**, then **Trusted Root Certification Authorities**.
4. Click **Finish** and **Yes**, then restart the browser.

**Firefox (any computer)**
Go to Settings → Privacy & Security → Certificates → **View Certificates**, open **Authorities**, click **Import**, choose `ca.crt` and tick **Trust this CA to identify websites**.

**Android phone (only to open the site in the phone's browser)**
Go to Settings → Security → **Encryption & credentials** → **Install a certificate** → **CA certificate** and choose `ca.crt`. The SP Calls app keeps using the `http://` address and needs nothing.

## When the site moves to a real domain

On the server, Caddy gets a free, trusted certificate for the domain by itself. Then nobody needs to install `ca.crt`, and this local setup is only for the laptop.
