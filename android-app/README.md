# eThunaivan Calls: the Android app

A small Android app for the phone page at `/calls`. It doesn't hold any customers itself.

1. It opens on its own start page (`www/index.html`) and asks for the shop link: the one `sudo crm-link` shows on the laptop.
2. It checks that the link really is the CRM, through `/ping.json`.
3. It opens `<link>/calls`.

The quick tunnel's link changes when the laptop restarts. When that happens:
- The app shows the start page again and asks for the new link.
- Inside the app, **Change link** at the top of the call list goes back to the same page.

The app can't add or edit customers. A login made in it is read-only on the server too.

## Building the APK

You need the Android SDK in `~/Android/Sdk` and Java 21. Both are on this laptop.

```bash
cd android-app
npm install
npx cap sync android
cd android
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk ../../client/public/ethunaivan-calls.apk
cd ../.. && npm run build
```

The website then offers it at `/ethunaivan-calls.apk`.

**Signing:** the APK is signed with this laptop's debug key, `~/.android/debug.keystore`.
- Android only installs an update over the app if it's signed with the same key, so keep building updates on this laptop or back that file up.
- Raise `versionCode` in `android/app/build.gradle` for each new version.

## Things that only apply here

- `capacitor.config.json` → `allowNavigation`: the hosts the app may open inside itself.
  - Included: `*.trycloudflare.com` and home-network addresses.
  - If you move to your own domain, add it there and rebuild.
  - Other links, such as WhatsApp and the dial pad, open in their own apps.
- `appendUserAgent: SPCallsApp`: how the `/calls` page knows it's inside the app. It uses this to show **Change link**.
- `errorPath: index.html`: if the shop link stops working while the app is open, Android shows the start page instead of a blank error.
