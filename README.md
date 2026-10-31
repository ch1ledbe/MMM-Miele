# MMM-Miele

MagicMirror² module that displays Miele device state using the Miele OAuth2 API.

![Miele](miele-logo.png)

## Features

- Shows device name, status, program phase, elapsed / remaining time and temperature
- Animated icon for washing machines
- OAuth2 Authorization Code flow with automatic token refresh
- Reads the first Miele device or a configured `deviceId`
- Multi-language UI labels: EN, DE, IT, FR, ES (`sp` alias included)

## Requirements

- [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) (Node.js 18 or newer)
- A Miele account with your appliances added in the Miele app
- A Miele developer client (client ID and client secret), see step 1

The module has no npm dependencies, so `npm install` is not needed.

## Installation

### 1. Get a Miele client ID and secret

1. Register at the [Miele Developer portal](https://www.miele.com/developer/) and request access to the third-party API.
2. Note the **client ID** and **client secret** you receive.
3. Register this callback URL (redirect URI) for your client:

   ```
   http://YOUR_MAGICMIRROR_HOST:8080/MMM-Miele/oauth/callback
   ```

   Replace `YOUR_MAGICMIRROR_HOST` with the IP address or host name of your MagicMirror (for example `192.168.1.50`) and `8080` with the port MagicMirror runs on. You will need exactly the same URL in step 4.

### 2. Download the module

```bash
cd ~/MagicMirror/modules
git clone https://github.com/ch1ledbe/MMM-Miele.git
```

### 3. Store the client ID and secret

MagicMirror sends `config.js` to every browser that opens the mirror, so do not put the secret there. Create `secrets.json` in the module folder instead:

```bash
nano ~/MagicMirror/modules/MMM-Miele/secrets.json
```

```json
{
  "clientId": "YOUR_MIELE_CLIENT_ID",
  "clientSecret": "YOUR_MIELE_CLIENT_SECRET"
}
```

Make the file readable only for your user:

```bash
chmod 600 ~/MagicMirror/modules/MMM-Miele/secrets.json
```

Alternatively, set the environment variables `MIELE_CLIENT_ID` and `MIELE_CLIENT_SECRET` for the MagicMirror process (they take precedence over `secrets.json`). `clientId` / `clientSecret` in `config.js` still work, but the module logs a warning.

### 4. Add the module to `config.js`

Open `~/MagicMirror/config/config.js` and add this block to the `modules` array:

```javascript
{
  module: "MMM-Miele",
  position: "top_left",
  header: "Miele",
  config: {
    redirectUri: "http://YOUR_MAGICMIRROR_HOST:8080/MMM-Miele/oauth/callback"
  }
},
```

`redirectUri` must match the URL from step 1 exactly.

If you want to authorize from another device (phone, laptop), MagicMirror must be reachable in your home network. Set this at the top level of `config.js`:

```javascript
address: "0.0.0.0",
ipWhitelist: ["127.0.0.1", "::ffff:127.0.0.1", "::1", "192.168.1.0/24"],
```

Adjust `192.168.1.0/24` to your home network.

### 5. Start MagicMirror and sign in to Miele

1. Restart MagicMirror (for example `pm2 restart MagicMirror` or `npm run start`).
2. The module shows **Authorization required** and a link. On the Raspberry Pi the link opens automatically in the browser (`autoOpenAuthInBrowser`).
3. Otherwise open the link in a browser on any device in your network.
4. Sign in with your Miele account and allow access.
5. When you see *Miele authorization successful*, close the browser window.

The module stores its tokens in `tokens.json` (readable only by its owner) and refreshes them automatically. After a few seconds your appliance appears on the mirror.

## Updating

```bash
cd ~/MagicMirror/modules/MMM-Miele
git pull
```

Then restart MagicMirror. `secrets.json` and `tokens.json` are not touched by updates.

## Configuration options

| Option | Default | Description |
|---|---|---|
| `redirectUri` | `http://localhost:8090/MMM-Miele/oauth/callback` | Callback URL, must match the one registered at Miele |
| `deviceId` | `null` | Miele device ID (fabrication number) to show; `null` uses the first device |
| `updateInterval` | `60000` | Update interval in milliseconds (minimum 15000) |
| `showDeviceName` | `true` | Show the device name |
| `showProgramPhase` | `true` | Show the current program phase |
| `showElapsedRemaining` | `true` | Show elapsed and remaining time while a program runs |
| `fallbackLabel` | `"Miele"` | Title used when no device name is available |
| `animationSpeed` | `0` | Fade time for display updates in milliseconds |
| `autoOpenAuthInBrowser` | `true` | Open the authorization link on the MagicMirror device (uses `xdg-open`) |
| `autoOpenOnlyOnce` | `true` | Open the link only once per start |
| `authEndpoint` | Miele default | OAuth authorization URL |
| `tokenEndpoint` | Miele default | OAuth token URL |
| `apiBase` | `https://api.mcs3.miele.com/v1` | Miele API base URL |
| `scope` | `"openid mcs_thirdparty_read"` | Requested OAuth scope |
| `tokenFile` | `"tokens.json"` | File name for stored tokens (in the module folder) |

You normally only need `redirectUri`, and `deviceId` if you have more than one appliance.

## Troubleshooting

- **Invalid configuration** on the mirror: check `redirectUri` and any endpoint you changed (see *Security*). The MagicMirror log shows details.
- **Missing OAuth2 configuration**: `secrets.json` is missing, has a typo, or is not in the module folder.
- **Miele authorization failed**: the redirect URI does not match the one registered at Miele, or the link is older than 10 minutes. Restart MagicMirror for a new link.
- **Configured deviceId not found**: check the ID in the Miele app or remove `deviceId`.
- **Link another Miele account**: delete `tokens.json` in the module folder and restart MagicMirror.

## Files

- `MMM-Miele.js` – front-end module
- `node_helper.js` – OAuth2 and API calls
- `miele.css` – styling
- `miele-logo.png` – logo
- `translations/*.json` – translations
- `secrets.json` – your client ID and secret (you create it, not in Git)
- `tokens.json` – created automatically after the first successful login (not in Git)

## Security

- `authEndpoint`, `tokenEndpoint` and `apiBase` must be `https` URLs on `miele.com` or `miele-iot.com`; other values are rejected.
- `tokenFile` must be a plain file name (e.g. `tokens.json`); it is always stored in the module folder.
- The configuration is accepted once per MagicMirror start. After changing `config.js`, restart MagicMirror.
- `/MMM-Miele/oauth/start` is refused while the module is authorized. To link another account, delete `tokens.json` and restart.
- An authorization link is valid for 10 minutes and can be used once.
- With an `http://` `redirectUri` the authorization code travels unencrypted through your local network. Keep MagicMirror reachable only from your home network (`address` / `ipWhitelist` in `config.js`), or use `https`.

## License

[MIT](LICENSE)
