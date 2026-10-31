# MMM-Miele

MagicMirror² module that displays Miele device state using the Miele OAuth2 API.

## Features

- OAuth2 Authorization Code flow
- Automatic token refresh
- Reads first Miele device or a configured `deviceId`
- Multi-language UI labels: EN, DE, IT, FR, ES (`sp` alias included)

## Files

- `MMM-Miele.js` – front-end module
- `node_helper.js` – OAuth2 and API calls
- `miele.css` – styling
- `miele-logo.png` – logo
- `translations/*.json` – translations
- `secrets.json` – optional, holds `clientId` / `clientSecret` (see below)
- `tokens.json` – created automatically after first successful login (readable only by its owner)

## Installation

Copy the folder into your MagicMirror modules directory:

```bash
cd ~/MagicMirror/modules
unzip MMM-Miele.zip
```

## MagicMirror config

Add this block to `config/config.js`:

```javascript
{
  module: "MMM-Miele",
  position: "top_left",
  header: "Appliance",
  config: {
    updateInterval: 60000,
    deviceId: null,

    redirectUri: "http://YOUR_MAGICMIRROR_HOST:8080/MMM-Miele/oauth/callback",
    authEndpoint: "https://auth.domestic.miele-iot.com/partner/realms/mcs/protocol/openid-connect/auth",
    tokenEndpoint: "https://auth.domestic.miele-iot.com/partner/realms/mcs/protocol/openid-connect/token",
    apiBase: "https://api.mcs3.miele.com/v1",
    scope: "openid mcs_thirdparty_read",
    tokenFile: "tokens.json"
  }
}
```

## Client ID and secret

MagicMirror sends `config.js` to every browser that opens the mirror, so do not put
`clientSecret` there. Use one of these instead (first match wins):

1. Environment variables `MIELE_CLIENT_ID` and `MIELE_CLIENT_SECRET`
2. A file `secrets.json` in the module folder:

```json
{
  "clientId": "YOUR_MIELE_CLIENT_ID",
  "clientSecret": "YOUR_MIELE_CLIENT_SECRET"
}
```

```bash
chmod 600 ~/MagicMirror/modules/MMM-Miele/secrets.json
```

`clientId` / `clientSecret` in `config.js` still work, but the module logs a warning.

## First-time OAuth setup

1. Start MagicMirror.
2. The module will show an authorization URL.
3. Open that URL in a browser.
4. Sign in to Miele and approve device access.
5. After the callback succeeds, close the browser window.
6. The module will store tokens in `tokens.json` and refresh them automatically.

## Notes

- `redirectUri` must exactly match the callback URI registered in your Miele app.
- The port in `redirectUri` must be the port MagicMirror runs on (MagicMirror default: 8080). If `redirectUri` is not set, the module falls back to `http://localhost:8090/MMM-Miele/oauth/callback`.
- The helper uses MagicMirror's Express app at `/MMM-Miele/oauth/callback`.
- If `deviceId` is not set, the first device returned by the API is used.

## Security

- `authEndpoint`, `tokenEndpoint` and `apiBase` must be `https` URLs on `miele.com` or `miele-iot.com`; other values are rejected.
- `tokenFile` must be a plain file name (e.g. `tokens.json`); it is always stored in the module folder.
- The configuration is accepted once per MagicMirror start. After changing `config.js`, restart MagicMirror.
- `/MMM-Miele/oauth/start` is refused while the module is authorized. To link another account, delete `tokens.json` and restart.
- An authorization link is valid for 10 minutes and can be used once.
- With an `http://` `redirectUri` the authorization code travels unencrypted through your local network. Keep MagicMirror reachable only from your home network (`address` / `ipWhitelist` in `config.js`), or use `https`.
