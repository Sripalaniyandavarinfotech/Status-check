# Run the CRM on an old laptop

This turns a spare laptop into a server. Shop owners open an `https://` link from anywhere, and your main computer can be switched off.

**You need:** a 64-bit laptop with at least 2 GB of RAM (4 GB is better), 20 GB of disk, a USB drive of 8 GB or more, and about an hour.

Installing Linux **erases everything on the laptop**. Copy anything you want to keep first.

## Part 1: Install Ubuntu Server on the laptop

1. On your main computer, download the latest **Ubuntu Server LTS** from [ubuntu.com/download/server](https://ubuntu.com/download/server).
2. Write it to the USB drive with [balenaEtcher](https://etcher.balena.io/) or Rufus. This erases the USB drive.
3. Put the USB drive in the laptop and start it from USB. The key to choose USB is usually F12, F9, F2 or Esc.
4. Follow the installer, and choose these options:
   - **Network:** connect to your Wi-Fi, or plug in a network cable.
   - **Storage:** use the entire disk, and tick **Encrypt the LVM group with LUKS**. Choose a strong password and write it down.
   - **Profile:** choose a name for the laptop, a user name and a password.
   - **SSH:** tick **Install OpenSSH server**.
5. Remove the USB drive when asked, and restart.

**About the encryption password:** the laptop asks for it at every start, so after a power cut the site stays off until someone types it on the laptop. This protects your customers' details if the laptop is stolen, so keep it on while you hold real customer data.

## Part 2: Find the laptop's address

Log in on the laptop and run:

```bash
hostname -I
```

The first number is the laptop's address, like `192.168.1.50`. You can now close the laptop's lid later and control it from your main computer.

## Part 3: Copy the site to the laptop

On your **main computer**, in the CRM folder, run this to make the package:

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

When it finishes, it shows your link, ending in `.trycloudflare.com`.

Remove the package from the laptop too, because the database is now restored:

```bash
cd ~ && rm -rf crm-laptop crm-laptop.tar.gz
```

## Part 5: Before you give the link to anyone

1. **Stop the server on your main computer.** Press `Ctrl + C` in its terminal. If both run, they would both check applications and both send WhatsApp messages, and the two copies of your data would no longer match.
2. **Open the link on your phone using mobile data**, not Wi-Fi, and log in.
3. **Test a real TNeDistrict number.** Add a customer and press the check button, to confirm the government website answers the laptop.
4. **Add your WhatsApp details** if you use them. Run `sudo nano /opt/crm/.env`, fill in `WA_TOKEN` and `WA_PHONE_NUMBER_ID`, save with `Ctrl + O`, Enter, then `Ctrl + X`. Then run `sudo systemctl restart crm`.
5. **Try a restart** with `sudo reboot`. Type the encryption password on the laptop when it asks, then run `sudo crm-link` and check the new link opens.

Your logins from the main computer work on the laptop too.

## Every day

**The link changes each time the laptop or tunnel restarts.** After a power cut, get the new link and send it to the shop owners:

```bash
sudo crm-link
```

This also updates password reset emails to use the new link.

Useful commands on the laptop:

| To do this | Run |
|---|---|
| See if the site is running | `systemctl status crm crm-tunnel` |
| See recent server messages | `journalctl -u crm -n 50` |
| Restart the site | `sudo systemctl restart crm` |
| Restart the tunnel (gives a new link) | `sudo systemctl restart crm-tunnel` |
| Create the first admin, if you have none | `cd /opt/crm && sudo -u crm node create-admin.js` |

## Backups

The laptop saves the database every night at 2 AM to `/opt/crm/backups`, and keeps 14 days of copies.

Saved Aadhaar numbers are encrypted, so backups are useless for them without the key. Show the key with `sudo grep AADHAAR_KEY /opt/crm/.env`, and keep a copy in a password manager or written down somewhere locked. Keep it apart from the backups.

Old laptop disks fail without warning, so copy the backups off it every week. On your **main computer**:

```bash
scp "USER@192.168.1.50:/opt/crm/backups/crm-*.sql" ~/crm-laptop-backups/
```

Create the folder first with `mkdir ~/crm-laptop-backups`. These files hold customer details, so keep them private.

## Update the site after changes

On your **main computer**, in the CRM folder:

```bash
bash deploy/make-package.sh --code-only
```

```bash
scp crm-laptop.tar.gz USER@192.168.1.50:~
```

Then **on the laptop**:

```bash
tar -xzf crm-laptop.tar.gz && cd crm-laptop && sudo bash deploy/laptop/setup.sh
```

Updating keeps the laptop's data and `.env`. The tunnel restarts, so run `sudo crm-link` and share the new link.

## Keep the laptop healthy

- Leave it plugged in, on a hard surface with space around it.
- If the battery looks swollen, stop using it and remove it. It's a fire risk.
- If the laptop gets hot with the lid closed, leave the lid slightly open.
- A small UPS for the router and laptop keeps the site up through short power cuts.

## Later: a link that never changes

A quick tunnel is for trials only, and Cloudflare gives no uptime promise for it. If the trial goes well, buy a cheap domain and switch to a named Cloudflare tunnel, which keeps the same link after restarts.
