# Run the CRM on an old laptop, on your own network

This turns a spare laptop into the shop server for the trial. Every computer and phone on the same Wi-Fi opens it at **https://ethunaivan.local**, and your main computer can be switched off.

**You need:** a 64-bit laptop with at least 2 GB of RAM (4 GB is better), 20 GB of disk, a USB drive of 8 GB or more, and about an hour.

Installing Linux **erases everything on the laptop**. Copy anything you want to keep first.

## Part 1: Install Ubuntu Server on the laptop

1. On your main computer, download the latest **Ubuntu Server LTS** from [ubuntu.com/download/server](https://ubuntu.com/download/server).
2. Write it to the USB drive with [balenaEtcher](https://etcher.balena.io/) or Rufus. This erases the USB drive.
3. Put the USB drive in the laptop and start it from USB. The key to choose USB is usually F12, F9, F2 or Esc.
4. Follow the installer, and choose these options:
   - **Network:** connect to the shop Wi-Fi, or better, plug in a network cable to the router.
   - **Storage:** use the entire disk, and tick **Encrypt the LVM group with LUKS**. Choose a strong password and write it down.
   - **Profile:** any name for now (the setup renames it to `ethunaivan`), a user name and a password.
   - **SSH:** tick **Install OpenSSH server**.
5. Remove the USB drive when asked, and restart.

**About the encryption password:** the laptop asks for it at every start, so after a power cut the site stays off until someone types it on the laptop. It protects your customers' details if the laptop is stolen, so keep it while you hold real customer data.

## Part 2: Find the laptop's address

Log in on the laptop and run:

```bash
hostname -I
```

The first number is the laptop's address, like `192.168.1.50`. You only need it for this first copy. After the setup, the laptop is also reachable as `ethunaivan.local`.

**Recommended:** in your router's settings, give the laptop a fixed address (often called *DHCP reservation* or *static lease*). The name works without this, but a fixed address is a good backup.

## Part 3: Copy the site to the laptop

On your **main computer**, in the CRM folder, make the package. It holds the site, a copy of your database, the Aadhaar key and your UPI details:

```bash
bash deploy/make-package.sh
```

Copy it across. Replace `USER` with the laptop's user name and `192.168.1.50` with its address:

```bash
scp crm-laptop.tar.gz USER@192.168.1.50:~
```

The package holds your customers' details, so delete it once it's copied:

```bash
rm crm-laptop.tar.gz
```

## Part 4: Run the setup

Connect to the laptop from your main computer:

```bash
ssh USER@192.168.1.50
```

Then, **on the laptop**, unpack and run the setup. It takes about 10 minutes.

```bash
tar -xzf crm-laptop.tar.gz
```

```bash
cd crm-laptop
```

```bash
sudo bash deploy/laptop/setup.sh
```

The setup:
- installs PostgreSQL, Node and the name service (so `ethunaivan.local` works)
- renames the laptop to `ethunaivan`
- restores your data, builds the site, and makes its HTTPS certificate
- runs the site on the normal web ports (no `:3000` to type)
- keeps the laptop awake with the lid closed, and backs up every night

When it finishes it prints the addresses to use. You can show them again any time with:

```bash
crm-address
```

Remove the package from the laptop too, because the database is now restored:

```bash
cd ~ && rm -rf crm-laptop crm-laptop.tar.gz
```

From now on you can connect with `ssh USER@ethunaivan.local`.

**Shops outside your network too?** Run the setup with `--with-tunnel` instead. It also gives a `trycloudflare.com` link that works from anywhere; show it with `sudo crm-link`. That link changes after every restart.

## Part 5: Set up each computer and phone (once)

**1. Stop the server on your main computer.** Press `Ctrl + C` in its terminal. If both run, they would both check applications and both send WhatsApp messages, and the two copies of your data would no longer match.

**2. Trust the laptop's certificate**, so browsers stop saying "Not private". On each device, open this address, which downloads the certificate:

`http://ethunaivan.local/ethunaivan-ca.crt`

- **Windows:** double-click the downloaded file → **Install Certificate** → **Current User** → **Place all certificates in the following store** → **Browse** → **Trusted Root Certification Authorities** → **Finish** → **Yes**. Restart the browser.
- **Android:** Settings → Security → **Encryption & credentials** → **Install a certificate** → **CA certificate** → choose the downloaded file.
- **This Linux computer (Brave/Chrome):** see part 3 of `docs/HTTPS.md`.

**3. Open the CRM** at **https://ethunaivan.local** and log in. Your logins from the main computer work here too.

If a computer can't find `ethunaivan.local` (some older Windows computers), use the laptop's address instead, for example `https://192.168.1.50`. Run `crm-address` to see it.

**4. Phone app (eThunaivan Calls):** on the phone, open `http://ethunaivan.local/ethunaivan-calls.apk`, install it, and open it while on the shop Wi-Fi. It finds the laptop by itself. If it asks, type `ethunaivan.local`.

**5. Check it works:**
- Add a customer with a real TNeDistrict number and press the check button, to confirm the government website answers the laptop.
- Try a restart with `sudo reboot`. Type the encryption password on the laptop when it asks, then open https://ethunaivan.local again.

**6. Add your WhatsApp or UPI details** if you use them and they weren't packed. Run `sudo nano /opt/crm/.env`, fill them in, save with `Ctrl + O`, Enter, then `Ctrl + X`, and run `sudo systemctl restart crm`.

## Every day

Nothing to do: the address stays **https://ethunaivan.local** after restarts and power cuts. If the laptop gets a new Wi-Fi address, the certificate updates itself on the next start, and the phone app searches for the laptop again.

Useful commands on the laptop:

| To do this | Run |
|---|---|
| Show the addresses to use | `crm-address` |
| See if the site is running | `systemctl status crm` |
| See recent server messages | `journalctl -u crm -n 50` |
| Restart the site | `sudo systemctl restart crm` |
| Create the first admin, if you have none | `cd /opt/crm && sudo -u crm node create-admin.js` |

## Backups

The laptop saves the database every night at 2 AM to `/opt/crm/backups`, and keeps 14 days of copies.

Saved Aadhaar numbers are encrypted, so backups are useless for them without the key. Show the key with `sudo grep AADHAAR_KEY /opt/crm/.env`, and keep a copy in a password manager or written down somewhere locked. Keep it apart from the backups.

Old laptop disks fail without warning, so copy the backups off it every week. On your **main computer**:

```bash
scp "USER@ethunaivan.local:/opt/crm/backups/crm-*.sql" ~/crm-laptop-backups/
```

Create the folder first with `mkdir ~/crm-laptop-backups`. These files hold customer details, so keep them private.

## Update the site after changes

On your **main computer**, in the CRM folder:

```bash
bash deploy/make-package.sh --code-only
```

```bash
scp crm-laptop.tar.gz USER@ethunaivan.local:~
```

Then **on the laptop**:

```bash
tar -xzf crm-laptop.tar.gz && cd crm-laptop && sudo bash deploy/laptop/setup.sh
```

Updating keeps the laptop's data, `.env` and certificate, so devices don't need to trust it again.

## Keep the laptop healthy

- Leave it plugged in, on a hard surface with space around it.
- A network cable to the router is more reliable than Wi-Fi.
- If the battery looks swollen, stop using it and remove it. It's a fire risk.
- If the laptop gets hot with the lid closed, leave the lid slightly open.
- A small UPS for the router and laptop keeps the site up through short power cuts.
- In the laptop's BIOS, turn on **Power on after AC loss** (if it has it), so it starts by itself when power returns.
