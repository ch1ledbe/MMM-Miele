const NodeHelper = require("node_helper");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ALLOWED_ENDPOINT_DOMAINS = ["miele.com", "miele-iot.com"];
const CALLBACK_PATH = "/MMM-Miele/oauth/callback";
const OAUTH_STATE_MAX_AGE = 10 * 60 * 1000;
const MIN_UPDATE_GAP = 15 * 1000;
const SECRETS_FILE = "secrets.json";

module.exports = NodeHelper.create({
  start: function () {
    this.config = null;
    this.timer = null;
    this.tokens = null;
    this.tokenExpiresAt = 0;
    this.oauthState = null;
    this.oauthStateCreatedAt = 0;
    this.pendingAuthUrl = null;
    this.routesInitialized = false;
    this.routeRetryTimer = null;
    this.authBrowserOpened = false;
    this.lastUpdateAt = 0;
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification !== "MMM_MIELE_CONFIG") {
      return;
    }

    // The config is accepted only once. Later messages (page reloads, other
    // browsers) just trigger a refresh and can no longer change endpoints or files.
    if (this.config) {
      if (Date.now() - this.lastUpdateAt > MIN_UPDATE_GAP) {
        this.updateNow();
      }
      return;
    }

    const problems = this.validateConfig(payload);
    if (problems.length) {
      console.log("[MMM-Miele] Rejected config:", problems.join("; "));
      this.sendSocketNotification("MMM_MIELE_ERROR", {
        message: `Invalid configuration: ${problems.join("; ")}`
      });
      return;
    }

    this.config = this.applySecrets(payload);
    this.loadTokens();
    this.ensureRoutesEventually();
    this.scheduleUpdates();

    setTimeout(() => {
      this.updateNow();
    }, 8000);
  },

  isAllowedEndpoint: function (value) {
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        url.protocol === "https:" &&
        ALLOWED_ENDPOINT_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
      );
    } catch (_) {
      return false;
    }
  },

  validateConfig: function (config) {
    const problems = [];

    if (!config || typeof config !== "object") {
      return ["config missing"];
    }

    for (const key of ["authEndpoint", "tokenEndpoint", "apiBase"]) {
      if (!this.isAllowedEndpoint(config[key])) {
        problems.push(`${key} must be an https URL on ${ALLOWED_ENDPOINT_DOMAINS.join(" or ")}`);
      }
    }

    try {
      const redirect = new URL(config.redirectUri);
      if (!["http:", "https:"].includes(redirect.protocol) || redirect.pathname !== CALLBACK_PATH) {
        problems.push(`redirectUri must be an http(s) URL ending in ${CALLBACK_PATH}`);
      }
    } catch (_) {
      problems.push("redirectUri is not a valid URL");
    }

    const tokenFile = config.tokenFile || "tokens.json";
    if (typeof tokenFile !== "string" || !/^[\w.-]+\.json$/.test(tokenFile) || tokenFile === SECRETS_FILE) {
      problems.push("tokenFile must be a plain file name like tokens.json");
    }

    if (config.deviceId !== null && config.deviceId !== undefined && typeof config.deviceId !== "string") {
      problems.push("deviceId must be a string");
    }

    if (config.scope !== undefined && typeof config.scope !== "string") {
      problems.push("scope must be a string");
    }

    return problems;
  },

  // clientId/clientSecret can be kept out of config.js (which MagicMirror sends
  // to every browser): environment variables win, then secrets.json, then config.
  applySecrets: function (config) {
    let fileSecrets = {};
    try {
      fileSecrets = JSON.parse(fs.readFileSync(path.join(__dirname, SECRETS_FILE), "utf8")) || {};
    } catch (_) {
      fileSecrets = {};
    }

    const clientId = process.env.MIELE_CLIENT_ID || fileSecrets.clientId || config.clientId;
    const clientSecret = process.env.MIELE_CLIENT_SECRET || fileSecrets.clientSecret || config.clientSecret;

    if (config.clientSecret) {
      console.log(
        "[MMM-Miele] Warning: clientSecret in config.js is visible to every browser that opens MagicMirror. " +
        `Move it to ${SECRETS_FILE} or MIELE_CLIENT_SECRET.`
      );
    }

    return { ...config, clientId, clientSecret };
  },

  ensureRoutesEventually: function () {
    if (this.routesInitialized) {
      return;
    }

    if (this.ensureRoutes()) {
      return;
    }

    if (this.routeRetryTimer) {
      clearTimeout(this.routeRetryTimer);
    }

    this.routeRetryTimer = setTimeout(() => {
      this.ensureRoutesEventually();
    }, 2000);
  },

  getExpressAppSafe: function () {
    if (this.expressApp && typeof this.expressApp.get === "function") {
      return this.expressApp;
    }

    if (this.router && typeof this.router.get === "function") {
      return this.router;
    }

    if (this.parent?.expressApp && typeof this.parent.expressApp.get === "function") {
      return this.parent.expressApp;
    }

    if (this.parent?.app && typeof this.parent.app.get === "function") {
      return this.parent.app;
    }

    return null;
  },

  ensureRoutes: function () {
    if (this.routesInitialized) {
      return true;
    }

    const app = this.getExpressAppSafe();
    if (!app) {
      console.log("[MMM-Miele] Express app not ready yet, retrying route setup.");
      return false;
    }

    // Responses are plain text and never echo request data, so nothing from the
    // URL can end up as HTML on the MagicMirror origin.
    app.get("/MMM-Miele/oauth/start", (req, res) => {
      res.type("text/plain");

      if (!this.config) {
        res.status(503).send("MMM-Miele is not configured yet.");
        return;
      }

      if (this.tokens?.refresh_token) {
        res.status(409).send("MMM-Miele is already authorized. Delete the token file to authorize again.");
        return;
      }

      try {
        res.redirect(this.getOrCreateAuthUrl());
      } catch (error) {
        console.log("[MMM-Miele] Failed to start OAuth:", error.message);
        res.status(500).send("Failed to start OAuth. See the MagicMirror log for details.");
      }
    });

    app.get("/MMM-Miele/oauth/callback", async (req, res) => {
      res.type("text/plain");

      try {
        const { code, state, error } = req.query;

        if (error) {
          throw new Error(`Authorization was denied or failed (${String(error).slice(0, 100)})`);
        }

        if (typeof code !== "string" || !code) {
          throw new Error("Missing authorization code");
        }

        const stateValid =
          typeof state === "string" &&
          typeof this.oauthState === "string" &&
          state.length === this.oauthState.length &&
          crypto.timingSafeEqual(Buffer.from(state), Buffer.from(this.oauthState)) &&
          Date.now() - this.oauthStateCreatedAt < OAUTH_STATE_MAX_AGE;

        if (!stateValid) {
          throw new Error("Invalid or expired OAuth state");
        }

        // Each state can be used only once.
        this.clearPendingAuth();
        await this.exchangeCodeForToken(code);
        this.authBrowserOpened = false;

        res.send("Miele authorization successful. You can close this window.");
        this.updateNow();
      } catch (err) {
        console.log("[MMM-Miele] OAuth callback failed:", err.message);
        res.status(400).send("Miele authorization failed. See the MagicMirror log for details.");
      }
    });

    this.routesInitialized = true;
    console.log("[MMM-Miele] OAuth routes registered.");
    return true;
  },

  scheduleUpdates: function () {
    if (this.timer) {
      clearInterval(this.timer);
    }

    const interval = Math.max(15000, Number(this.config?.updateInterval) || 60000);
    this.timer = setInterval(() => {
      this.updateNow();
    }, interval);
  },

  updateNow: async function () {
    try {
      if (!this.config) {
        return;
      }

      this.lastUpdateAt = Date.now();

      if (!this.config.clientId || !this.config.clientSecret || !this.config.redirectUri) {
        throw new Error(
          `Missing OAuth2 configuration: clientId, clientSecret (${SECRETS_FILE} or MIELE_CLIENT_SECRET), or redirectUri`
        );
      }

      const token = await this.getValidAccessToken();

      if (!token) {
        const authUrl = this.getOrCreateAuthUrl();

        this.sendSocketNotification("MMM_MIELE_AUTH_REQUIRED", { authUrl });
        this.openAuthUrlOnPi(authUrl);
        return;
      }

      const devices = await this.fetchJson(`${this.config.apiBase}/devices`, token);
      const entries = Object.entries(devices || {});

      if (!entries.length) {
        throw new Error("No devices returned by Miele API");
      }

      let selected;
      if (this.config.deviceId) {
        selected = entries.find(([deviceId]) => deviceId === this.config.deviceId);
        if (!selected) {
          throw new Error(`Configured deviceId not found: ${this.config.deviceId}`);
        }
      } else {
        selected = entries[0];
      }

      const [deviceId, deviceInfo] = selected;
      const ident = deviceInfo?.ident || {};
      const state = await this.fetchJson(
        `${this.config.apiBase}/devices/${encodeURIComponent(deviceId)}/state`,
        token
      );

      this.sendSocketNotification(
        "MMM_MIELE_STATE",
        this.normalizeDevice(deviceId, ident, state)
      );
    } catch (error) {
      console.log("[MMM-Miele] updateNow error:", error.message || error);
      this.sendSocketNotification("MMM_MIELE_ERROR", {
        message: error.message || String(error)
      });
    }
  },

  openAuthUrlOnPi: function (authUrl) {
    if (!this.config.autoOpenAuthInBrowser) {
      return;
    }

    if (this.config.autoOpenOnlyOnce && this.authBrowserOpened) {
      return;
    }

    const env = {
      ...process.env,
      DISPLAY: process.env.DISPLAY || ":0",
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`
    };

    execFile("xdg-open", [authUrl], { env }, (error) => {
      if (error) {
        console.log("[MMM-Miele] Failed to open local browser:", error.message);
        return;
      }

      console.log("[MMM-Miele] Opened local browser for OAuth.");
      this.authBrowserOpened = true;
    });
  },

  getOrCreateAuthUrl: function () {
    if (this.pendingAuthUrl && this.oauthState && Date.now() - this.oauthStateCreatedAt < OAUTH_STATE_MAX_AGE) {
      return this.pendingAuthUrl;
    }

    this.oauthState = crypto.randomBytes(24).toString("hex");
    this.oauthStateCreatedAt = Date.now();

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      response_type: "code",
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope || "openid mcs_thirdparty_read",
      state: this.oauthState
    });

    this.pendingAuthUrl = `${this.config.authEndpoint}?${params.toString()}`;
    return this.pendingAuthUrl;
  },

  clearPendingAuth: function () {
    this.pendingAuthUrl = null;
    this.oauthState = null;
    this.oauthStateCreatedAt = 0;
  },

  exchangeCodeForToken: async function (code) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      code,
      redirect_uri: this.config.redirectUri
    });

    const response = await fetch(this.config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      await this.logErrorBody("Token exchange", response);
      throw new Error(`Token exchange failed (${response.status})`);
    }

    this.setTokens(await response.json());
  },

  refreshAccessToken: async function () {
    if (!this.tokens?.refresh_token) {
      return null;
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.tokens.refresh_token
    });

    const response = await fetch(this.config.tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    if (!response.ok) {
      await this.logErrorBody("Token refresh", response);

      // A rejected refresh token will never work again: drop it so the module
      // asks for a new authorization instead of failing forever.
      if (response.status === 400 || response.status === 401) {
        this.clearTokens();
      }

      throw new Error(`Token refresh failed (${response.status})`);
    }

    this.setTokens(await response.json());
    return this.tokens.access_token;
  },

  getValidAccessToken: async function () {
    const now = Date.now();

    if (this.tokens?.access_token && now < this.tokenExpiresAt - 60000) {
      return this.tokens.access_token;
    }

    if (this.tokens?.refresh_token) {
      return await this.refreshAccessToken();
    }

    return null;
  },

  setTokens: function (data) {
    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || this.tokens?.refresh_token || null,
      expires_in: Number(data.expires_in || 3600)
    };

    this.tokenExpiresAt = Date.now() + (this.tokens.expires_in * 1000);
    this.saveTokens();
  },

  tokenFilePath: function () {
    return path.join(__dirname, path.basename(this.config.tokenFile || "tokens.json"));
  },

  loadTokens: function () {
    try {
      const raw = fs.readFileSync(this.tokenFilePath(), "utf8");
      const data = JSON.parse(raw);
      this.tokens = data.tokens || null;
      this.tokenExpiresAt = Number(data.tokenExpiresAt || 0);
    } catch (_) {
      this.tokens = null;
      this.tokenExpiresAt = 0;
    }
  },

  saveTokens: function () {
    const file = this.tokenFilePath();

    // Only the MagicMirror user may read the tokens. chmod also fixes files
    // created by older versions with default permissions.
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          tokens: this.tokens,
          tokenExpiresAt: this.tokenExpiresAt
        },
        null,
        2
      ),
      { encoding: "utf8", mode: 0o600 }
    );
    fs.chmodSync(file, 0o600);
  },

  clearTokens: function () {
    this.tokens = null;
    this.tokenExpiresAt = 0;

    try {
      fs.unlinkSync(this.tokenFilePath());
    } catch (_) {
      // No token file yet.
    }
  },

  fetchJson: async function (url, token) {
    let response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (response.status === 401 && this.tokens?.refresh_token) {
      const refreshedToken = await this.refreshAccessToken();
      response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${refreshedToken}`,
          Accept: "application/json"
        }
      });
    }

    if (!response.ok) {
      await this.logErrorBody("API request", response);
      throw new Error(`API request failed (${response.status})`);
    }

    return await response.json();
  },

  // Server error bodies go to the log only (shortened), never to the mirror display.
  logErrorBody: async function (label, response) {
    let text = "";
    try {
      text = await response.text();
    } catch (_) {
      text = "";
    }

    console.log(`[MMM-Miele] ${label} failed (${response.status}):`, text.slice(0, 300));
  },

  normalizeDevice: function (deviceId, ident, state) {
    return {
      deviceId,
      name: ident?.deviceName || ident?.type?.value_localized || ident?.type?.value || `Miele ${deviceId}`,
      rawTypeLabel: this.pickValue(ident?.type?.value_localized, ident?.type?.value),
      statusLabel: this.cleanUnknown(this.pickValue(state?.status?.value_localized, state?.status?.value)),
      programPhaseLabel: this.cleanUnknown(this.pickValue(state?.programPhase?.value_localized, state?.programPhase?.value)),
      temperatureLabel: this.cleanUnknown(this.pickValue(state?.temperature?.value_localized, state?.temperature?.value)),
      statusValue: this.cleanRawValue(state?.status?.value),
      programPhaseValue: this.cleanRawValue(state?.programPhase?.value),
      deviceTypeValue: this.cleanRawValue(ident?.type?.value),
      elapsedTimeLabel: this.formatTime(state?.elapsedTime),
      remainingTimeLabel: this.formatTime(state?.remainingTime)
    };
  },

  cleanRawValue: function (value) {
    if (value === null || value === undefined || value === -32768 || value === "-32768") {
      return null;
    }

    if (Array.isArray(value)) {
      return value.length ? value[0] : null;
    }

    return value;
  },

  pickValue: function (localized, raw) {
    const localizedValue = this.unwrap(localized);
    if (this.isMeaningful(localizedValue)) {
      return localizedValue;
    }

    const rawValue = this.unwrap(raw);
    if (this.isMeaningful(rawValue)) {
      return rawValue;
    }

    return "";
  },

  unwrap: function (value) {
    if (value === null || value === undefined) {
      return "";
    }

    if (Array.isArray(value)) {
      return value.length > 1 ? value[1] : value[0];
    }

    if (typeof value === "object") {
      if (Object.prototype.hasOwnProperty.call(value, "value_localized")) {
        return this.unwrap(value.value_localized);
      }
      if (Object.prototype.hasOwnProperty.call(value, "value")) {
        return this.unwrap(value.value);
      }
    }

    return String(value);
  },

  isMeaningful: function (value) {
    return value !== "" && value !== null && value !== undefined && value !== "-32768";
  },

  cleanUnknown: function (value) {
    return this.isMeaningful(value) ? value : "";
  },

  formatTime: function (timeObj) {
    if (!timeObj || typeof timeObj !== "object") {
      return "";
    }

    const hrs = Number(timeObj[0] ?? timeObj.hours ?? 0);
    const mins = Number(timeObj[1] ?? timeObj.minutes ?? 0);

    if (Number.isNaN(hrs) || Number.isNaN(mins)) {
      return "";
    }

    return `${hrs}:${String(mins).padStart(2, "0")}`;
  }
});