/* global Module */

Module.register("MMM-Miele", {
  defaults: {
    updateInterval: 60 * 1000,
    animationSpeed: 0,
    deviceId: null,
    fallbackLabel: "Miele",
    showDeviceName: true,
    showProgramPhase: true,
    showElapsedRemaining: true,

    clientId: "",
    clientSecret: "",
    redirectUri: "http://localhost:8090/MMM-Miele/oauth/callback",
    authEndpoint: "https://auth.domestic.miele-iot.com/partner/realms/mcs/protocol/openid-connect/auth",
    tokenEndpoint: "https://auth.domestic.miele-iot.com/partner/realms/mcs/protocol/openid-connect/token",
    apiBase: "https://api.mcs3.miele.com/v1",
    scope: "openid mcs_thirdparty_read",
    tokenFile: "tokens.json",
    autoOpenAuthInBrowser: true,
    autoOpenOnlyOnce: true
  },

  start: function () {
    this.loaded = false;
    this.error = null;
    this.device = null;
    this.authUrl = null;
    this.lastRenderKey = null;

    this.sendSocketNotification("MMM_MIELE_CONFIG", this.config);
  },

  getStyles: function () {
    return [this.file("miele.css")];
  },

  getTranslations: function () {
    return {
      en: "translations/en.json",
      de: "translations/de.json",
      it: "translations/it.json",
      fr: "translations/fr.json",
      es: "translations/es.json"
    };
  },

  socketNotificationReceived: function (notification, payload) {
    if (notification === "MMM_MIELE_STATE") {
      const nextRenderKey = this.buildRenderKey(payload);
      if (this.lastRenderKey === nextRenderKey) {
        return;
      }

      this.lastRenderKey = nextRenderKey;
      this.loaded = true;
      this.error = null;
      this.authUrl = null;
      this.device = payload;
      this.updateDom(this.config.animationSpeed);
      return;
    }

    if (notification === "MMM_MIELE_AUTH_REQUIRED") {
      const nextRenderKey = `auth:${payload && payload.authUrl ? payload.authUrl : ""}`;
      if (this.lastRenderKey === nextRenderKey) {
        return;
      }

      this.lastRenderKey = nextRenderKey;
      this.loaded = true;
      this.error = null;
      this.device = null;
      this.authUrl = payload.authUrl;
      this.updateDom(this.config.animationSpeed);
      return;
    }

    if (notification === "MMM_MIELE_ERROR") {
      const nextRenderKey = `error:${payload && payload.message ? payload.message : String(payload)}`;
      if (this.lastRenderKey === nextRenderKey) {
        return;
      }

      this.lastRenderKey = nextRenderKey;
      this.loaded = true;
      this.error = payload;
      this.updateDom(this.config.animationSpeed);
    }
  },

  buildRenderKey: function (payload) {
    const statusClass = this.getStatusClass(
      payload.statusLabel,
      payload.statusValue
    );

    const includeTime =
      statusClass === "running" ||
      statusClass === "paused" ||
      statusClass === "finished";

    return JSON.stringify({
      deviceId: payload.deviceId,
      name: payload.name,
      rawTypeLabel: payload.rawTypeLabel,
      statusLabel: payload.statusLabel,
      statusValue: payload.statusValue,
      programPhaseLabel: payload.programPhaseLabel,
      programPhaseValue: payload.programPhaseValue,
      temperatureLabel: payload.temperatureLabel,
      deviceTypeValue: payload.deviceTypeValue,
      elapsedTimeLabel: includeTime ? payload.elapsedTimeLabel : "",
      remainingTimeLabel: includeTime ? payload.remainingTimeLabel : ""
    });
  },

  getDom: function () {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-miele";

    if (!this.loaded) {
      wrapper.classList.add("dimmed", "light");
      wrapper.textContent = this.translate("LOADING");
      return wrapper;
    }

    if (this.authUrl) {
      wrapper.innerHTML = `
        <div class="miele-title">${this.escapeHtml(this.config.fallbackLabel)}</div>
        <div class="miele-status">${this.translate("AUTH_REQUIRED")}</div>
        <div class="miele-meta small">${this.translate("OPEN_THIS_URL")}</div>
        <div class="miele-link small">${this.escapeHtml(this.authUrl)}</div>
      `;
      return wrapper;
    }

    if (this.error) {
      wrapper.innerHTML = `
        <div class="miele-title">${this.escapeHtml(this.config.fallbackLabel)}</div>
        <div class="miele-error">${this.translate("ERROR")}: ${this.escapeHtml(this.error.message || String(this.error))}</div>
      `;
      return wrapper;
    }

    if (!this.device) {
      wrapper.classList.add("dimmed");
      wrapper.textContent = this.translate("NO_DEVICE_FOUND");
      return wrapper;
    }

    const deviceName = this.translateDeviceName(
      this.device.name || this.device.rawTypeLabel || this.config.fallbackLabel
    );

    const status = this.translateStatus(
      this.device.statusLabel,
      this.device.statusValue
    );

    const phase = this.translatePhase(
      this.device.programPhaseLabel,
      this.device.programPhaseValue
    );

    const statusClass = this.getStatusClass(
      this.device.statusLabel,
      this.device.statusValue
    );

    const isActive =
      statusClass === "running" ||
      statusClass === "paused" ||
      statusClass === "finished";

    const remaining = this.device.remainingTimeLabel || "";
    const elapsed = this.device.elapsedTimeLabel || "";

    const isWashingMachine = this.isWashingMachine(
      this.device.rawTypeLabel || this.device.name || ""
    );

    let html = `<div class="miele-card">`;

    if (isWashingMachine) {
      html += `
        <div class="miele-icon-block ${statusClass}">
          <div class="washer-icon">
            <div class="washer-topbar"></div>
            <div class="washer-button washer-button-1"></div>
            <div class="washer-button washer-button-2"></div>
            <div class="washer-door">
              <div class="washer-glass">
                <div class="washer-water"></div>
                <div class="washer-bubble washer-bubble-1"></div>
                <div class="washer-bubble washer-bubble-2"></div>
                <div class="washer-bubble washer-bubble-3"></div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    html += `<div class="miele-content">`;

    if (this.config.showDeviceName) {
      html += `<div class="miele-title">${this.escapeHtml(deviceName)}</div>`;
    }

    html += `<div class="miele-status">${this.escapeHtml(status)}</div>`;

    if (this.config.showProgramPhase && phase) {
      html += `<div class="miele-phase">${this.translate("PHASE")}: ${this.escapeHtml(phase)}</div>`;
    }

    if (this.config.showElapsedRemaining && isActive && (elapsed || remaining)) {
      const timeBits = [];
      if (elapsed) {
        timeBits.push(`${this.translate("ELAPSED")} ${this.escapeHtml(elapsed)}`);
      }
      if (remaining) {
        timeBits.push(`${this.translate("REMAINING")} ${this.escapeHtml(remaining)}`);
      }
      html += `<div class="miele-time">${timeBits.join(" • ")}</div>`;
    }

    if (this.device.temperatureLabel) {
      html += `<div class="miele-meta">${this.translate("TEMP")}: ${this.escapeHtml(this.device.temperatureLabel)}</div>`;
    }

    html += `</div></div>`;
    wrapper.innerHTML = html;
    return wrapper;
  },

  isWashingMachine: function (value) {
    const s = String(value || "").toLowerCase();

    return (
      s.includes("washing") ||
      s.includes("washer") ||
      s.includes("wasch") ||
      s.includes("lavatrice") ||
      s.includes("lave-linge") ||
      s.includes("lavadora")
    );
  },

  translateDeviceName: function (name) {
    if (!name) {
      return this.config.fallbackLabel;
    }

    const n = String(name).toLowerCase();

    if (
      n.includes("washing") ||
      n.includes("washer") ||
      n.includes("wasch") ||
      n.includes("lavatrice") ||
      n.includes("lave-linge") ||
      n.includes("lavadora")
    ) {
      return this.translate("DEVICE_WASHING_MACHINE");
    }

    if (
      n.includes("dryer") ||
      n.includes("trockner") ||
      n.includes("asciugatrice") ||
      n.includes("sèche") ||
      n.includes("secadora")
    ) {
      return this.translate("DEVICE_DRYER");
    }

    if (
      n.includes("dishwasher") ||
      n.includes("spül") ||
      n.includes("lavastoviglie") ||
      n.includes("lave-vaisselle") ||
      n.includes("lavavajillas")
    ) {
      return this.translate("DEVICE_DISHWASHER");
    }

    if (
      n.includes("oven") ||
      n.includes("backofen") ||
      n.includes("forno") ||
      n.includes("four") ||
      n.includes("horno")
    ) {
      return this.translate("DEVICE_OVEN");
    }

    return name;
  },

  translateStatus: function (statusLabel, statusValue) {
    const raw = statusValue !== null && statusValue !== undefined
      ? String(statusValue).toLowerCase()
      : "";

    if (raw) {
      // Add exact raw-value mappings here later if needed.
    }

    if (!statusLabel) {
      return this.translate("UNKNOWN");
    }

    const s = String(statusLabel).toLowerCase();

    if (
      s.includes("in use") ||
      s.includes("run") ||
      s.includes("progress") ||
      s.includes("läuft") ||
      s.includes("en cours") ||
      s.includes("esecuzione") ||
      s.includes("in benutzung") ||
      s.includes("utilisation") ||
      s === "uso"
    ) {
      return this.translate("STATUS_RUNNING");
    }

    if (
      s.includes("ready") ||
      s.includes("idle") ||
      s.includes("bereit") ||
      s.includes("pronto") ||
      s.includes("prêt") ||
      s.includes("listo")
    ) {
      return this.translate("STATUS_READY");
    }

    if (
      s.includes("finish") ||
      s.includes("done") ||
      s.includes("complete") ||
      s.includes("fertig") ||
      s.includes("terminato") ||
      s.includes("terminé") ||
      s.includes("finalizado")
    ) {
      return this.translate("STATUS_FINISHED");
    }

    if (s.includes("pause") || s.includes("pausa")) {
      return this.translate("STATUS_PAUSED");
    }

    if (
      s.includes("error") ||
      s.includes("fault") ||
      s.includes("fehler") ||
      s.includes("errore")
    ) {
      return this.translate("STATUS_ERROR");
    }

    if (s.includes("off") || s.includes("aus") || s.includes("spento")) {
      return this.translate("STATUS_OFF");
    }

    return statusLabel;
  },

  translatePhase: function (phaseLabel, phaseValue) {
    const raw = phaseValue !== null && phaseValue !== undefined
      ? String(phaseValue).toLowerCase()
      : "";

    if (raw) {
      // Add exact raw-value mappings here later if needed.
    }

    if (!phaseLabel) {
      return "";
    }

    const p = String(phaseLabel).toLowerCase();

    if (p.includes("wash") || p.includes("lav") || p.includes("wasch")) {
      return this.translate("PHASE_WASH");
    }

    if (p.includes("rinsing") || p.includes("rinse") || p.includes("spül") || p.includes("risciac") || p.includes("rinç")) {
      return this.translate("PHASE_RINSE");
    }

    if (p.includes("spin") || p.includes("centrif") || p.includes("essorage") || p.includes("schleuder")) {
      return this.translate("PHASE_SPIN");
    }

    if (p.includes("dry") || p.includes("trock") || p.includes("asciug") || p.includes("séch")) {
      return this.translate("PHASE_DRY");
    }

    if (p.includes("heat") || p.includes("heiz") || p.includes("riscald") || p.includes("chauff")) {
      return this.translate("PHASE_HEATING");
    }

    if (p.includes("cool") || p.includes("raffredd") || p.includes("kühl") || p.includes("refroid")) {
      return this.translate("PHASE_COOLING");
    }

    if (p.includes("anti-crease") || p.includes("anti crease") || p.includes("knitter") || p.includes("creas") || p.includes("piega") || p.includes("froiss")) {
      return this.translate("PHASE_ANTI_CREASE");
    }

    return phaseLabel;
  },

  getStatusClass: function (statusLabel, statusValue) {
    const raw = statusValue !== null && statusValue !== undefined
      ? String(statusValue).toLowerCase()
      : "";

    if (raw) {
      // Add exact raw-value mappings here later if needed.
    }

    if (!statusLabel) {
      return "idle";
    }

    const s = String(statusLabel).toLowerCase();

    if (
      s.includes("in use") ||
      s.includes("run") ||
      s.includes("progress") ||
      s.includes("läuft") ||
      s.includes("en cours") ||
      s.includes("esecuzione") ||
      s.includes("in benutzung") ||
      s.includes("utilisation") ||
      s === "uso"
    ) {
      return "running";
    }

    if (s.includes("pause") || s.includes("pausa")) {
      return "paused";
    }

    if (
      s.includes("error") ||
      s.includes("fault") ||
      s.includes("fehler") ||
      s.includes("errore")
    ) {
      return "error";
    }

    if (
      s.includes("finish") ||
      s.includes("done") ||
      s.includes("complete") ||
      s.includes("fertig") ||
      s.includes("terminato") ||
      s.includes("terminé") ||
      s.includes("finalizado")
    ) {
      return "finished";
    }

    if (s.includes("off") || s.includes("aus") || s.includes("spento")) {
      return "off";
    }

    return "idle";
  },

  escapeHtml: function (value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});