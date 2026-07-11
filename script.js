/* ============================================================
   SIKYORIFY — APPLICATION LOGIC
   Pure vanilla JS. All data lives in localStorage. Offline only.
============================================================ */

(function () {
  "use strict";

  /* ============================================================
     1. STORAGE LAYER
  ============================================================ */
  const LS = {
    USERS: "sikyorify_users",
    DEVICES: "sikyorify_devices",
    SESSION: "sikyorify_session",
    SETTINGS: "sikyorify_settings",
    ACTIVITY: "sikyorify_activity",
    BACKUPS: "sikyorify_backups",
    REMEMBER: "sikyorify_remember"
  };

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function nowISO() { return new Date().toISOString(); }
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  function fmtDateTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    return d + "d ago";
  }
  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str).replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
  }

  /* ============================================================
     2. SEED DEFAULT DATA
  ============================================================ */
  function seedIfEmpty() {
    let users = load(LS.USERS, null);
    if (!users) {
      users = [{
        id: uid("usr"),
        username: "admin",
        password: "admin123",
        role: "admin",
        enabled: true,
        createdAt: nowISO(),
        displayName: "Admin"
      }];
      save(LS.USERS, users);
    }
    let devices = load(LS.DEVICES, null);
    if (!devices) {
      const sampleOwner = users[0].username;
      devices = [
        mkDevice({ mac: "AA:BB:CC:11:22:33", owner: sampleOwner, ssid: "HomeNet_5G", deviceName: "Living Room Router", deviceType: "Router", brand: "TP-Link", model: "Archer AX55", location: "Living Room", description: "Main household router." }),
        mkDevice({ mac: "10:20:30:40:50:60", owner: sampleOwner, ssid: "HomeNet_5G", deviceName: "Kitchen Camera", deviceType: "IP Camera", brand: "Hikvision", model: "DS-2CD", location: "Kitchen", description: "" }),
        mkDevice({ mac: "F4:5C:89:AB:CD:EF", owner: sampleOwner, ssid: "HomeNet_2G", deviceName: "Study Laptop", deviceType: "Laptop", brand: "Dell", model: "XPS 13", location: "Study Room", description: "" })
      ];
      save(LS.DEVICES, devices);
    }
    if (!load(LS.SETTINGS, null)) {
      save(LS.SETTINGS, { theme: "dark", language: "en", fontSize: "md", autoSave: true });
    }
    if (!load(LS.ACTIVITY, null)) save(LS.ACTIVITY, []);
    if (!load(LS.BACKUPS, null)) save(LS.BACKUPS, []);
  }

  function mkDevice(fields) {
    const t = nowISO();
    return Object.assign({
      id: uid("dev"), mac: "", owner: "", ssid: "", deviceName: "", deviceType: "",
      brand: "", model: "", location: "", description: "", dateAdded: t, lastUpdated: t
    }, fields, { id: uid("dev"), dateAdded: t, lastUpdated: t });
  }

  /* ============================================================
     3. GLOBAL STATE
  ============================================================ */
  const state = {
    session: load(LS.SESSION, null),
    settings: load(LS.SETTINGS, { theme: "dark", language: "en", fontSize: "md", autoSave: true }),
    currentView: "dashboard",
    devicePage: 1,
    devicePageSize: 8,
    deviceSort: "dateAdded_desc",
    deviceFilterType: "",
    deviceSearch: "",
    selectedDeviceIds: new Set(),
    advField: "all"
  };

  function currentUser() {
    if (!state.session) return null;
    const users = load(LS.USERS, []);
    return users.find(u => u.id === state.session.userId) || null;
  }
  function isAdmin() {
    const u = currentUser();
    return u && u.role === "admin";
  }

  /* ============================================================
     4. ACTIVITY LOG
  ============================================================ */
  function logActivity(type, message) {
    const list = load(LS.ACTIVITY, []);
    list.unshift({ id: uid("act"), type, message, time: nowISO() });
    if (list.length > 60) list.length = 60;
    save(LS.ACTIVITY, list);
  }

  /* ============================================================
     5. TOASTS
  ============================================================ */
  function toast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    const el = document.createElement("div");
    const icons = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" };
    el.className = `toast-custom ${type}`;
    el.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span><button class="toast-close"><i class="fa-solid fa-xmark"></i></button>`;
    container.appendChild(el);
    const remove = () => { el.classList.add("hide"); setTimeout(() => el.remove(), 280); };
    el.querySelector(".toast-close").addEventListener("click", remove);
    setTimeout(remove, 4200);
  }

  /* ============================================================
     6. CONFIRM MODAL (generic, promise-based)
  ============================================================ */
  let confirmModalInstance;
  function confirmAction(title, body) {
    return new Promise(resolve => {
      document.getElementById("confirmModalTitle").innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(title)}`;
      document.getElementById("confirmModalBody").textContent = body;
      const modalEl = document.getElementById("confirmModal");
      confirmModalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
      const yesBtn = document.getElementById("confirmModalYes");
      const handler = () => { cleanup(); confirmModalInstance.hide(); resolve(true); };
      const hiddenHandler = () => { resolve(false); };
      function cleanup() {
        yesBtn.removeEventListener("click", handler);
        modalEl.removeEventListener("hidden.bs.modal", hiddenHandler);
      }
      yesBtn.addEventListener("click", handler);
      modalEl.addEventListener("hidden.bs.modal", hiddenHandler, { once: true });
      confirmModalInstance.show();
    });
  }

  /* ============================================================
     7. RIPPLE EFFECT
  ============================================================ */
  document.addEventListener("click", function (e) {
    const btn = e.target.closest(".btn-primary-glow, .btn-danger-glow, .btn-ghost, .icon-btn, .nav-item, .fab");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height);
    ripple.className = "ripple";
    ripple.style.width = ripple.style.height = size + "px";
    ripple.style.left = (e.clientX - rect.left - size / 2) + "px";
    ripple.style.top = (e.clientY - rect.top - size / 2) + "px";
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 650);
  });

  /* ============================================================
     8. THEME
  ============================================================ */
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const icon = document.querySelector("#themeToggleBtn i");
    if (icon) icon.className = theme === "dark" ? "fa-solid fa-moon" : "fa-solid fa-sun";
    document.querySelectorAll("#themeSegment button").forEach(b => b.classList.toggle("active", b.dataset.val === theme));
  }
  function applyFontSize(size) {
    document.documentElement.setAttribute("data-font", size);
    document.querySelectorAll("#fontSegment button").forEach(b => b.classList.toggle("active", b.dataset.val === size));
  }

  /* ============================================================
     9. VALIDATION HELPERS
  ============================================================ */
  const MAC_RE = /^([0-9A-Fa-f]{2}[:\-]){5}([0-9A-Fa-f]{2})$/;
  function normalizeMac(mac) {
    return mac.trim().toUpperCase().replace(/-/g, ":");
  }
  function isValidMac(mac) { return MAC_RE.test(mac.trim()); }

  /* ============================================================
     10. AUTH
  ============================================================ */
  function attemptLogin(username, password) {
    const users = load(LS.USERS, []);
    const user = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return { ok: false, error: "No account found with that username." };
    if (!user.enabled) return { ok: false, error: "This account has been disabled. Contact an administrator." };
    if (user.password !== password) return { ok: false, error: "Incorrect password. Please try again." };
    return { ok: true, user };
  }

  function doLogin(user, remember) {
    state.session = { userId: user.id, loginAt: nowISO() };
    save(LS.SESSION, state.session);
    save(LS.REMEMBER, !!remember);
    logActivity("login", `${user.username} signed in`);
    showApp();
  }

  function doLogout() {
    logActivity("logout", `${currentUser()?.username || "user"} signed out`);
    state.session = null;
    save(LS.SESSION, null);
    showLogin();
  }

  /* ============================================================
     11. SCAN CANVAS (login screen signature animation)
  ============================================================ */
  function initScanCanvas() {
    const canvas = document.getElementById("scanCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let w, h, points = [];
    function resize() {
      w = canvas.width = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      const count = Math.floor((w * h) / 26000);
      points = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25
      }));
    }
    window.addEventListener("resize", resize);
    resize();
    let angle = 0;
    function frame() {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.42;
      angle += 0.012;
      points.forEach(p => {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1;
        if (p.y < 0 || p.y > h) p.vy *= -1;
      });
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          const dx = points[i].x - points[j].x, dy = points[i].y - points[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.strokeStyle = `rgba(96,165,250,${0.12 * (1 - dist / 120)})`;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(points[i].x, points[i].y); ctx.lineTo(points[j].x, points[j].y); ctx.stroke();
          }
        }
        ctx.fillStyle = "rgba(147,197,253,0.55)";
        ctx.beginPath(); ctx.arc(points[i].x, points[i].y, 1.6, 0, Math.PI * 2); ctx.fill();
      }
      // radar sweep
      const maxR = Math.max(w, h) * 0.6;
      const grad = ctx.createConicGradient ? ctx.createConicGradient(angle, cx, cy) : null;
      if (grad) {
        grad.addColorStop(0, "rgba(59,130,246,0)");
        grad.addColorStop(0.06, "rgba(59,130,246,0.25)");
        grad.addColorStop(0.12, "rgba(59,130,246,0)");
        grad.addColorStop(1, "rgba(59,130,246,0)");
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, maxR, 0, Math.PI * 2); ctx.fill();
      }
      for (let r = 1; r <= 3; r++) {
        ctx.strokeStyle = "rgba(96,165,250,0.12)";
        ctx.beginPath(); ctx.arc(cx, cy, r * 90, 0, Math.PI * 2); ctx.stroke();
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  /* ============================================================
     12. NAVIGATION / VIEW SWITCHING
  ============================================================ */
  function switchView(view) {
    if (view === "users" && !isAdmin()) view = "dashboard";
    if (view === "backup" && !isAdmin()) view = "dashboard";
    if (view === "restore" && !isAdmin()) view = "dashboard";
    state.currentView = view;
    document.querySelectorAll(".view").forEach(v => v.classList.add("d-none"));
    const target = document.getElementById("view-" + view);
    if (target) target.classList.remove("d-none");
    document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.getElementById("mainContent").scrollTop = 0;
    closeMobileSidebar();
    renderCurrentView();
  }

  function renderCurrentView() {
    switch (state.currentView) {
      case "dashboard": renderDashboard(); break;
      case "devices": renderDevicesView(); break;
      case "users": renderUsersView(); break;
      case "search": renderAdvSearch(); break;
      case "backup": renderBackupView(); break;
      default: break;
    }
  }

  function closeMobileSidebar() {
    document.getElementById("appShell").classList.remove("sidebar-open");
  }

  /* ============================================================
     13. DASHBOARD RENDERING
  ============================================================ */
  function renderDashboard() {
    const user = currentUser();
    const devices = load(LS.DEVICES, []);
    const users = load(LS.USERS, []);
    const backups = load(LS.BACKUPS, []);
    document.getElementById("dashUserName").textContent = user ? (user.displayName || user.username) : "";
    document.getElementById("dashSubtitle").textContent = isAdmin()
      ? "Here's what's happening across all devices today."
      : "Here's a snapshot of your registered devices.";

    const myDevices = isAdmin() ? devices : devices.filter(d => d.owner === user.username);
    const today = new Date().toDateString();
    const todaysDevices = myDevices.filter(d => new Date(d.dateAdded).toDateString() === today);

    const grid = document.getElementById("statGrid");
    if (isAdmin()) {
      grid.innerHTML = `
        <div class="stat-card glass"><div class="stat-icon"><i class="fa-solid fa-users"></i></div><h4>${users.length}</h4><p>Total Users</p></div>
        <div class="stat-card glass success"><div class="stat-icon"><i class="fa-solid fa-wifi"></i></div><h4>${devices.length}</h4><p>Total Devices</p></div>
        <div class="stat-card glass warn"><div class="stat-icon"><i class="fa-solid fa-calendar-day"></i></div><h4>${todaysDevices.length}</h4><p>Today's Devices</p></div>
        <div class="stat-card glass"><div class="stat-icon"><i class="fa-solid fa-database"></i></div><h4>${backups.length}</h4><p>Backups Created</p></div>`;
    } else {
      grid.innerHTML = `
        <div class="stat-card glass success"><div class="stat-icon"><i class="fa-solid fa-wifi"></i></div><h4>${myDevices.length}</h4><p>My Devices</p></div>
        <div class="stat-card glass warn"><div class="stat-icon"><i class="fa-solid fa-calendar-day"></i></div><h4>${todaysDevices.length}</h4><p>Today's Added</p></div>
        <div class="stat-card glass"><div class="stat-icon"><i class="fa-solid fa-clock"></i></div><h4>${myDevices.length ? timeAgo(myDevices[0].dateAdded) : "—"}</h4><p>Most Recent</p></div>`;
    }

    drawDevicesChart(myDevices);
    drawTypesChart(myDevices);
    renderActivityList();
  }

  function renderActivityList() {
    const list = load(LS.ACTIVITY, []);
    const el = document.getElementById("activityList");
    if (!list.length) { el.innerHTML = `<li class="activity-empty">No recent activity yet.</li>`; return; }
    const iconMap = { login: "fa-right-to-bracket", logout: "fa-right-from-bracket", add: "fa-plus", edit: "fa-pen", delete: "fa-trash", backup: "fa-database", restore: "fa-clock-rotate-left", import: "fa-file-import", export: "fa-file-export", user: "fa-user" };
    el.innerHTML = list.slice(0, 12).map(a => `
      <li>
        <span class="act-icon ${a.type === 'delete' ? 'del' : (a.type === 'add' ? 'add' : '')}"><i class="fa-solid ${iconMap[a.type] || 'fa-circle-info'}"></i></span>
        <span class="act-body">${escapeHtml(a.message)}</span>
        <span class="act-time">${timeAgo(a.time)}</span>
      </li>`).join("");
  }

  /* ---- Charts (pure canvas, no libraries) ---- */
  function drawDevicesChart(devices) {
    const canvas = document.getElementById("chartDevices");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth - 40;
    canvas.width = cssW * dpr; canvas.height = 220 * dpr;
    canvas.style.width = cssW + "px"; canvas.style.height = "220px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, 220);

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d);
    }
    const counts = days.map(d => devices.filter(dev => new Date(dev.dateAdded).toDateString() === d.toDateString()).length);
    const max = Math.max(1, ...counts);
    const padL = 30, padB = 26, chartW = cssW - padL - 10, chartH = 220 - padB - 14;
    const barW = chartW / days.length * 0.5;
    const gap = chartW / days.length;

    const styles = getComputedStyle(document.documentElement);
    const gridColor = "rgba(148,163,184,0.14)";
    const textColor = styles.getPropertyValue("--text-faint") || "#888";

    // grid lines
    ctx.strokeStyle = gridColor; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 14 + (chartH / 4) * i;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - 10, y); ctx.stroke();
    }

    counts.forEach((c, i) => {
      const x = padL + gap * i + (gap - barW) / 2;
      const barH = (c / max) * chartH;
      const y = 14 + chartH - barH;
      const grad = ctx.createLinearGradient(0, y, 0, 14 + chartH);
      grad.addColorStop(0, "#60A5FA"); grad.addColorStop(1, "#2563EB");
      ctx.fillStyle = grad;
      roundRectPath(ctx, x, y, barW, Math.max(barH, 2), 6);
      ctx.fill();
      ctx.fillStyle = textColor.trim() || "#94A3B8";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(days[i].toLocaleDateString(undefined, { weekday: "short" }), x + barW / 2, 220 - 6);
      if (c > 0) {
        ctx.fillStyle = "#93C5FD";
        ctx.font = "11px Inter, sans-serif";
        ctx.fillText(c, x + barW / 2, y - 6);
      }
    });
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawTypesChart(devices) {
    const canvas = document.getElementById("chartTypes");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth - 40;
    canvas.width = cssW * dpr; canvas.height = 220 * dpr;
    canvas.style.width = cssW + "px"; canvas.style.height = "220px";
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, 220);

    const tally = {};
    devices.forEach(d => { const t = d.deviceType || "Other"; tally[t] = (tally[t] || 0) + 1; });
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!entries.length) {
      ctx.fillStyle = "#94A3B8"; ctx.font = "13px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("No device data yet", cssW / 2, 110);
      return;
    }
    const total = entries.reduce((s, e) => s + e[1], 0);
    const colors = ["#3B82F6", "#22C55E", "#F59E0B", "#8B5CF6", "#EF4444", "#14B8A6"];
    const cx = 66, cy = 110, radius = 62;
    let start = -Math.PI / 2;
    entries.forEach(([type, count], i) => {
      const slice = (count / total) * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius, start, start + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      start += slice;
    });
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath(); ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";

    // legend
    let ly = 34;
    entries.forEach(([type, count], i) => {
      ctx.fillStyle = colors[i % colors.length];
      roundRectPath(ctx, 150, ly - 8, 10, 10, 3); ctx.fill();
      ctx.fillStyle = "#CBD5E1"; ctx.font = "12px Inter, sans-serif"; ctx.textAlign = "left";
      ctx.fillText(`${type} (${count})`, 168, ly + 1);
      ly += 22;
    });
  }

  /* ============================================================
     14. DEVICES: CRUD + RENDER
  ============================================================ */
  function getVisibleDevices() {
    const user = currentUser();
    const all = load(LS.DEVICES, []);
    return isAdmin() ? all : all.filter(d => d.owner === user.username);
  }

  function populateTypeFilter() {
    const select = document.getElementById("filterType");
    const types = [...new Set(getVisibleDevices().map(d => d.deviceType).filter(Boolean))].sort();
    const currentVal = select.value;
    select.innerHTML = `<option value="">All Types</option>` + types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join("");
    select.value = types.includes(currentVal) ? currentVal : "";
  }

  function filterSortDevices(list) {
    let out = list.slice();
    const q = state.deviceSearch.trim().toLowerCase();
    if (q) {
      out = out.filter(d => [d.mac, d.owner, d.ssid, d.deviceName, d.brand, d.model, d.location, fmtDate(d.dateAdded)]
        .some(f => (f || "").toLowerCase().includes(q)));
    }
    if (state.deviceFilterType) out = out.filter(d => d.deviceType === state.deviceFilterType);
    const [field, dir] = state.deviceSort.split("_");
    out.sort((a, b) => {
      let av = a[field === "owner" ? "owner" : field === "device" ? "deviceName" : field === "brand" ? "brand" : "dateAdded"];
      let bv = b[field === "owner" ? "owner" : field === "device" ? "deviceName" : field === "brand" ? "brand" : "dateAdded"];
      if (field === "dateAdded") { av = new Date(av).getTime(); bv = new Date(bv).getTime(); }
      else { av = (av || "").toLowerCase(); bv = (bv || "").toLowerCase(); }
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ? 1 : -1;
      return 0;
    });
    return out;
  }

  function renderDevicesView() {
    populateTypeFilter();
    const filtered = filterSortDevices(getVisibleDevices());
    const totalPages = Math.max(1, Math.ceil(filtered.length / state.devicePageSize));
    state.devicePage = Math.min(state.devicePage, totalPages);
    const startIdx = (state.devicePage - 1) * state.devicePageSize;
    const pageItems = filtered.slice(startIdx, startIdx + state.devicePageSize);

    const tbody = document.getElementById("devicesTableBody");
    const emptyState = document.getElementById("devicesEmptyState");
    const table = document.getElementById("devicesTable");

    if (!filtered.length) {
      table.classList.add("d-none"); emptyState.classList.remove("d-none");
      tbody.innerHTML = "";
    } else {
      table.classList.remove("d-none"); emptyState.classList.add("d-none");
      tbody.innerHTML = pageItems.map(d => `
        <tr data-id="${d.id}">
          <td><input type="checkbox" class="dev-check" data-id="${d.id}" ${state.selectedDeviceIds.has(d.id) ? "checked" : ""}></td>
          <td><span class="mac-pill">${escapeHtml(d.mac)}</span></td>
          <td>${escapeHtml(d.owner)}</td>
          <td>${escapeHtml(d.ssid)}</td>
          <td>${escapeHtml(d.deviceName)}</td>
          <td><span class="type-badge">${escapeHtml(d.deviceType || "—")}</span></td>
          <td>${escapeHtml(d.brand || "—")} ${d.model ? "/ " + escapeHtml(d.model) : ""}</td>
          <td>${escapeHtml(d.location || "—")}</td>
          <td>${fmtDate(d.dateAdded)}</td>
          <td>
            <div class="row-actions">
              <button class="act-view" title="View" data-act="view" data-id="${d.id}"><i class="fa-solid fa-eye"></i></button>
              <button class="act-copy" title="Copy MAC" data-act="copy" data-id="${d.id}"><i class="fa-solid fa-copy"></i></button>
              <button class="act-edit" title="Edit" data-act="edit" data-id="${d.id}"><i class="fa-solid fa-pen"></i></button>
              <button class="act-delete" title="Delete" data-act="delete" data-id="${d.id}"><i class="fa-solid fa-trash"></i></button>
            </div>
          </td>
        </tr>`).join("");
    }

    renderPagination(state.devicePage, totalPages);
    document.getElementById("selectAllDevices").checked = pageItems.length > 0 && pageItems.every(d => state.selectedDeviceIds.has(d.id));
  }

  function renderPagination(page, totalPages) {
    const el = document.getElementById("devicesPagination");
    let btns = `<button class="pg-btn" data-pg="prev" ${page <= 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
      if (totalPages > 7 && Math.abs(i - page) > 2 && i !== 1 && i !== totalPages) {
        if (i === 2 || i === totalPages - 1) btns += `<span style="padding:0 4px;color:var(--text-faint)">…</span>`;
        continue;
      }
      btns += `<button class="pg-btn ${i === page ? "active" : ""}" data-pg="${i}">${i}</button>`;
    }
    btns += `<button class="pg-btn" data-pg="next" ${page >= totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>`;
    el.innerHTML = `<span class="text-muted-2" style="font-size:12.5px">Page ${page} of ${totalPages}</span><div style="display:flex;gap:6px;flex-wrap:wrap">${btns}</div>`;
  }

  function openDeviceModal(deviceId) {
    const form = document.getElementById("deviceForm");
    form.reset();
    document.getElementById("macHint").textContent = "";
    document.getElementById("macHint").classList.remove("error");
    if (deviceId) {
      const d = load(LS.DEVICES, []).find(x => x.id === deviceId);
      if (!d) return;
      document.getElementById("deviceModalTitle").innerHTML = `<i class="fa-solid fa-pen"></i> Edit Device`;
      document.getElementById("deviceId").value = d.id;
      document.getElementById("deviceMac").value = d.mac;
      document.getElementById("deviceOwner").value = d.owner;
      document.getElementById("deviceSsid").value = d.ssid;
      document.getElementById("deviceName").value = d.deviceName;
      document.getElementById("deviceType").value = d.deviceType;
      document.getElementById("deviceBrand").value = d.brand;
      document.getElementById("deviceModel").value = d.model;
      document.getElementById("deviceLocation").value = d.location;
      document.getElementById("deviceDescription").value = d.description;
    } else {
      document.getElementById("deviceModalTitle").innerHTML = `<i class="fa-solid fa-wifi"></i> Add Device`;
      document.getElementById("deviceId").value = "";
      if (!isAdmin()) document.getElementById("deviceOwner").value = currentUser().username;
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById("deviceModal")).show();
  }

  function handleDeviceFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("deviceId").value;
    const macRaw = document.getElementById("deviceMac").value;
    const mac = normalizeMac(macRaw);
    const macHint = document.getElementById("macHint");

    if (!isValidMac(mac)) {
      macHint.textContent = "Enter a valid MAC address, e.g. AA:BB:CC:DD:EE:FF";
      macHint.classList.add("error");
      return;
    }
    const devices = load(LS.DEVICES, []);
    const dupe = devices.find(d => d.mac === mac && d.id !== id);
    if (dupe) {
      macHint.textContent = "This MAC address is already registered.";
      macHint.classList.add("error");
      return;
    }
    macHint.textContent = ""; macHint.classList.remove("error");

    const fields = {
      mac,
      owner: document.getElementById("deviceOwner").value.trim(),
      ssid: document.getElementById("deviceSsid").value.trim(),
      deviceName: document.getElementById("deviceName").value.trim(),
      deviceType: document.getElementById("deviceType").value,
      brand: document.getElementById("deviceBrand").value.trim(),
      model: document.getElementById("deviceModel").value.trim(),
      location: document.getElementById("deviceLocation").value.trim(),
      description: document.getElementById("deviceDescription").value.trim()
    };

    if (id) {
      const idx = devices.findIndex(d => d.id === id);
      devices[idx] = Object.assign({}, devices[idx], fields, { lastUpdated: nowISO() });
      logActivity("edit", `Updated device "${fields.deviceName}"`);
      toast("Device updated successfully.", "success");
    } else {
      devices.unshift(mkDevice(fields));
      logActivity("add", `Added new device "${fields.deviceName}" (${mac})`);
      toast("Device added successfully.", "success");
    }
    save(LS.DEVICES, devices);
    bootstrap.Modal.getInstance(document.getElementById("deviceModal")).hide();
    state.devicePage = 1;
    renderDevicesView();
    if (state.currentView === "dashboard") renderDashboard();
  }

  async function deleteDevice(id) {
    const devices = load(LS.DEVICES, []);
    const d = devices.find(x => x.id === id);
    if (!d) return;
    const confirmed = await confirmAction("Delete Device", `Permanently delete "${d.deviceName}" (${d.mac})? This cannot be undone.`);
    if (!confirmed) return;
    save(LS.DEVICES, devices.filter(x => x.id !== id));
    state.selectedDeviceIds.delete(id);
    logActivity("delete", `Deleted device "${d.deviceName}" (${d.mac})`);
    toast("Device deleted.", "success");
    renderDevicesView();
  }

  function viewDeviceDetails(id) {
    const d = load(LS.DEVICES, []).find(x => x.id === id);
    if (!d) return;
    const body = document.getElementById("deviceDetailsBody");
    body.innerHTML = `
      <div class="device-detail-grid">
        <div><label>MAC Address</label><div class="val mac-pill">${escapeHtml(d.mac)}</div></div>
        <div><label>Owner</label><div class="val">${escapeHtml(d.owner)}</div></div>
        <div><label>SSID</label><div class="val">${escapeHtml(d.ssid)}</div></div>
        <div><label>Device Name</label><div class="val">${escapeHtml(d.deviceName)}</div></div>
        <div><label>Type</label><div class="val">${escapeHtml(d.deviceType || "—")}</div></div>
        <div><label>Brand / Model</label><div class="val">${escapeHtml(d.brand || "—")} ${d.model ? "/ " + escapeHtml(d.model) : ""}</div></div>
        <div><label>Location</label><div class="val">${escapeHtml(d.location || "—")}</div></div>
        <div><label>Date Added</label><div class="val">${fmtDateTime(d.dateAdded)}</div></div>
        <div><label>Last Updated</label><div class="val">${fmtDateTime(d.lastUpdated)}</div></div>
        <div class="dd-full"><label>Description</label><div class="val">${escapeHtml(d.description || "No description provided.")}</div></div>
      </div>`;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("deviceDetailsModal")).show();
  }

  function copyMac(id) {
    const d = load(LS.DEVICES, []).find(x => x.id === id);
    if (!d) return;
    navigator.clipboard.writeText(d.mac).then(() => toast("MAC address copied to clipboard.", "success"))
      .catch(() => toast("Could not copy to clipboard.", "error"));
  }

  /* ---- Export / Print ---- */
  function downloadFile(filename, content, mime = "text/plain") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  function exportDevicesJSON(list, filename) {
    if (!list.length) { toast("No devices to export.", "error"); return; }
    downloadFile(filename, JSON.stringify(list, null, 2), "application/json");
    logActivity("export", `Exported ${list.length} device record(s) to JSON`);
    toast(`Exported ${list.length} device(s).`, "success");
  }

  function printDevices(list) {
    if (!list.length) { toast("No devices to print.", "error"); return; }
    const rows = list.map(d => `<tr><td>${escapeHtml(d.mac)}</td><td>${escapeHtml(d.owner)}</td><td>${escapeHtml(d.ssid)}</td><td>${escapeHtml(d.deviceName)}</td><td>${escapeHtml(d.deviceType)}</td><td>${escapeHtml(d.brand)}</td><td>${fmtDate(d.dateAdded)}</td></tr>`).join("");
    const win = window.open("", "_blank");
    win.document.write(`<html><head><title>Sikyorify — Device Report</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;} h1{font-size:18px;} table{width:100%;border-collapse:collapse;margin-top:16px;} th,td{border:1px solid #ccc;padding:8px;font-size:12px;text-align:left;} th{background:#f0f0f0;}</style>
      </head><body><h1>Sikyorify — Device Report (${list.length} devices)</h1><p>Generated ${fmtDateTime(nowISO())}</p>
      <table><thead><tr><th>MAC</th><th>Owner</th><th>SSID</th><th>Device</th><th>Type</th><th>Brand</th><th>Date Added</th></tr></thead><tbody>${rows}</tbody></table>
      </body></html>`);
    win.document.close();
    win.print();
  }

  /* ============================================================
     15. USERS: CRUD + RENDER (admin only)
  ============================================================ */
  let userSearchTerm = "";
  function renderUsersView() {
    const users = load(LS.USERS, []);
    const devices = load(LS.DEVICES, []);
    const q = userSearchTerm.trim().toLowerCase();
    const filtered = users.filter(u => !q || u.username.toLowerCase().includes(q) || u.role.includes(q));
    const tbody = document.getElementById("usersTableBody");
    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted-2 py-4">No users match your search.</td></tr>`;
      return;
    }
    tbody.innerHTML = filtered.map(u => {
      const count = devices.filter(d => d.owner === u.username).length;
      return `
      <tr>
        <td><div style="display:flex;align-items:center;gap:10px"><span class="avatar" style="width:32px;height:32px;font-size:12px">${escapeHtml(u.username[0].toUpperCase())}</span><div><strong>${escapeHtml(u.displayName || u.username)}</strong><div class="text-muted-2" style="font-size:12px">@${escapeHtml(u.username)}</div></div></div></td>
        <td><span class="role-badge">${u.role}</span></td>
        <td><span class="status-badge ${u.enabled ? "enabled" : "disabled"}">${u.enabled ? "Enabled" : "Disabled"}</span></td>
        <td>${count}</td>
        <td>${fmtDate(u.createdAt)}</td>
        <td>
          <div class="row-actions">
            <button class="act-edit" title="Edit" data-uact="edit" data-id="${u.id}"><i class="fa-solid fa-pen"></i></button>
            <button class="act-copy" title="Reset Password" data-uact="reset" data-id="${u.id}"><i class="fa-solid fa-key"></i></button>
            <button class="act-view" title="${u.enabled ? "Disable" : "Enable"}" data-uact="toggle" data-id="${u.id}"><i class="fa-solid ${u.enabled ? "fa-lock" : "fa-lock-open"}"></i></button>
            <button class="act-delete" title="Delete" data-uact="delete" data-id="${u.id}"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>`;
    }).join("");
  }

  function openUserModal(userId) {
    const form = document.getElementById("userForm");
    form.reset();
    document.getElementById("userPasswordLabel").textContent = userId ? "New Password (leave blank to keep current)" : "Password *";
    document.getElementById("userPassword").required = !userId;
    if (userId) {
      const u = load(LS.USERS, []).find(x => x.id === userId);
      if (!u) return;
      document.getElementById("userModalTitle").innerHTML = `<i class="fa-solid fa-pen"></i> Edit User`;
      document.getElementById("userId").value = u.id;
      document.getElementById("userUsername").value = u.username;
      document.getElementById("userRole").value = u.role;
      document.getElementById("userEnabled").checked = u.enabled;
    } else {
      document.getElementById("userModalTitle").innerHTML = `<i class="fa-solid fa-user-plus"></i> Add User`;
      document.getElementById("userId").value = "";
      document.getElementById("userEnabled").checked = true;
    }
    bootstrap.Modal.getOrCreateInstance(document.getElementById("userModal")).show();
  }

  function handleUserFormSubmit(e) {
    e.preventDefault();
    const id = document.getElementById("userId").value;
    const username = document.getElementById("userUsername").value.trim();
    const password = document.getElementById("userPassword").value;
    const role = document.getElementById("userRole").value;
    const enabled = document.getElementById("userEnabled").checked;
    const users = load(LS.USERS, []);

    const dupe = users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== id);
    if (dupe) { toast("That username is already taken.", "error"); return; }

    if (id) {
      const idx = users.findIndex(u => u.id === id);
      users[idx].username = username;
      users[idx].role = role;
      users[idx].enabled = enabled;
      if (password) users[idx].password = password;
      logActivity("user", `Updated user "${username}"`);
      toast("User updated.", "success");
    } else {
      if (!password) { toast("Password is required for new users.", "error"); return; }
      users.push({ id: uid("usr"), username, password, role, enabled, createdAt: nowISO(), displayName: username });
      logActivity("user", `Created new user "${username}" (${role})`);
      toast("User created.", "success");
    }
    save(LS.USERS, users);
    bootstrap.Modal.getInstance(document.getElementById("userModal")).hide();
    renderUsersView();
  }

  async function deleteUser(id) {
    const users = load(LS.USERS, []);
    const u = users.find(x => x.id === id);
    if (!u) return;
    if (u.username === "admin") { toast("The primary admin account cannot be deleted.", "error"); return; }
    if (currentUser().id === id) { toast("You cannot delete your own account while logged in.", "error"); return; }
    const confirmed = await confirmAction("Delete User", `Delete user "${u.username}"? Their devices will remain but become unassigned.`);
    if (!confirmed) return;
    save(LS.USERS, users.filter(x => x.id !== id));
    logActivity("user", `Deleted user "${u.username}"`);
    toast("User deleted.", "success");
    renderUsersView();
  }

  async function toggleUserEnabled(id) {
    const users = load(LS.USERS, []);
    const u = users.find(x => x.id === id);
    if (!u) return;
    if (u.username === "admin") { toast("The primary admin account cannot be disabled.", "error"); return; }
    u.enabled = !u.enabled;
    save(LS.USERS, users);
    logActivity("user", `${u.enabled ? "Enabled" : "Disabled"} user "${u.username}"`);
    toast(`User ${u.enabled ? "enabled" : "disabled"}.`, "success");
    renderUsersView();
  }

  async function resetUserPassword(id) {
    const users = load(LS.USERS, []);
    const u = users.find(x => x.id === id);
    if (!u) return;
    const confirmed = await confirmAction("Reset Password", `Reset "${u.username}"'s password to the default "changeme123"?`);
    if (!confirmed) return;
    u.password = "changeme123";
    save(LS.USERS, users);
    logActivity("user", `Reset password for "${u.username}"`);
    toast(`Password reset to "changeme123".`, "success");
  }

  /* ============================================================
     16. ADVANCED SEARCH VIEW
  ============================================================ */
  function renderAdvSearch() {
    const input = document.getElementById("advSearchInput");
    const q = input.value.trim().toLowerCase();
    const tbody = document.getElementById("advSearchTableBody");
    const empty = document.getElementById("advSearchEmptyState");
    const table = document.querySelector("#view-search table");

    if (!q) {
      table.classList.add("d-none"); empty.classList.remove("d-none");
      empty.querySelector("h4").textContent = "Start typing to search";
      empty.querySelector("p").textContent = "Results will appear here instantly.";
      tbody.innerHTML = "";
      return;
    }
    const fieldMap = { mac: "mac", owner: "owner", ssid: "ssid", device: "deviceName", brand: "brand", dateAdded: "dateAdded" };
    const results = getVisibleDevices().filter(d => {
      if (state.advField === "all") {
        return [d.mac, d.owner, d.ssid, d.deviceName, d.brand, d.model, fmtDate(d.dateAdded)].some(f => (f || "").toLowerCase().includes(q));
      }
      const f = state.advField === "dateAdded" ? fmtDate(d.dateAdded) : d[fieldMap[state.advField]];
      return (f || "").toLowerCase().includes(q);
    });

    if (!results.length) {
      table.classList.add("d-none"); empty.classList.remove("d-none");
      empty.querySelector("h4").textContent = "No matches found";
      empty.querySelector("p").textContent = `Nothing matches "${input.value}". Try a different term.`;
      tbody.innerHTML = "";
      return;
    }
    table.classList.remove("d-none"); empty.classList.add("d-none");
    tbody.innerHTML = results.map(d => `
      <tr>
        <td><span class="mac-pill">${escapeHtml(d.mac)}</span></td>
        <td>${escapeHtml(d.owner)}</td>
        <td>${escapeHtml(d.ssid)}</td>
        <td>${escapeHtml(d.deviceName)}</td>
        <td>${escapeHtml(d.brand || "—")}</td>
        <td>${fmtDate(d.dateAdded)}</td>
        <td><div class="row-actions"><button class="act-view" data-act="view" data-id="${d.id}"><i class="fa-solid fa-eye"></i></button><button class="act-edit" data-act="edit" data-id="${d.id}"><i class="fa-solid fa-pen"></i></button></div></td>
      </tr>`).join("");
  }

  /* ============================================================
     17. BACKUP / RESTORE / TXT IMPORT-EXPORT
  ============================================================ */
  function renderBackupView() {
    const backups = load(LS.BACKUPS, []);
    const el = document.getElementById("backupHistoryList");
    if (!backups.length) { el.innerHTML = `<li class="activity-empty">No backups created yet.</li>`; return; }
    el.innerHTML = backups.slice(0, 10).map(b => `
      <li>
        <span class="act-icon"><i class="fa-solid fa-box-archive"></i></span>
        <span class="act-body"><strong>${b.label}</strong> — ${b.userCount} users, ${b.deviceCount} devices</span>
        <span class="act-time">${fmtDateTime(b.time)}</span>
      </li>`).join("");
  }

  function createBackup() {
    const snapshot = {
      version: "1.0.0",
      exportedAt: nowISO(),
      users: load(LS.USERS, []),
      devices: load(LS.DEVICES, []),
      settings: load(LS.SETTINGS, {})
    };
    const backups = load(LS.BACKUPS, []);
    const label = "Backup_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    backups.unshift({ id: uid("bk"), label, time: nowISO(), userCount: snapshot.users.length, deviceCount: snapshot.devices.length, data: snapshot });
    if (backups.length > 20) backups.length = 20;
    save(LS.BACKUPS, backups);
    logActivity("backup", `Created backup "${label}"`);
    toast("Backup created successfully.", "success");
    renderBackupView();
    return snapshot;
  }

  function downloadLastBackup() {
    const backups = load(LS.BACKUPS, []);
    if (!backups.length) { toast("No backups exist yet. Create one first.", "error"); return; }
    downloadFile(backups[0].label + ".json", JSON.stringify(backups[0].data, null, 2), "application/json");
    toast("Backup downloaded.", "success");
  }

  function exportTxt() {
    const user = currentUser();
    const devices = getVisibleDevices();
    if (!devices.length) { toast("No devices to export.", "error"); return; }
    const lines = devices.map(d => [d.mac, d.owner, d.ssid, d.deviceName, fmtDate(d.dateAdded)].join("|"));
    downloadFile(`${user.username}.txt`, lines.join("\n"));
    logActivity("export", `Exported ${devices.length} device(s) to ${user.username}.txt`);
    toast(`Exported to ${user.username}.txt`, "success");
  }

  function importTxtFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/).filter(l => l.trim());
      const devices = load(LS.DEVICES, []);
      const user = currentUser();
      let added = 0, skipped = 0;
      lines.forEach(line => {
        const parts = line.split("|").map(p => p.trim());
        if (parts.length < 4) { skipped++; return; }
        const [mac, owner, ssid, deviceName, dateAdded] = parts;
        const normMac = normalizeMac(mac);
        if (!isValidMac(normMac) || devices.find(d => d.mac === normMac)) { skipped++; return; }
        devices.unshift(mkDevice({ mac: normMac, owner: owner || user.username, ssid, deviceName, deviceType: "Other" }));
        added++;
      });
      save(LS.DEVICES, devices);
      logActivity("import", `Imported ${added} device(s) from TXT file`);
      toast(`Imported ${added} device(s). ${skipped ? skipped + " skipped." : ""}`, added ? "success" : "error");
      renderCurrentView();
    };
    reader.onerror = () => toast("Could not read the file.", "error");
    reader.readAsText(file);
  }

  function restoreFromBackupFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.users || !data.devices) throw new Error("Invalid backup structure");
        const confirmed = await confirmAction("Restore Backup", `This will overwrite ALL current users and devices with the backup from ${fmtDateTime(data.exportedAt || nowISO())}. Continue?`);
        if (!confirmed) return;
        save(LS.USERS, data.users);
        save(LS.DEVICES, data.devices);
        if (data.settings) save(LS.SETTINGS, data.settings);
        logActivity("restore", `Restored data from backup file`);
        toast("Backup restored successfully. Reloading…", "success");
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        toast("Invalid or corrupted backup file.", "error");
      }
    };
    reader.readAsText(file);
  }

  async function resetApp() {
    const confirmed = await confirmAction("Reset Application", "This will permanently delete ALL users, devices, backups, and settings. This cannot be undone.");
    if (!confirmed) return;
    Object.values(LS).forEach(k => localStorage.removeItem(k));
    toast("Application reset. Reloading…", "success");
    setTimeout(() => location.reload(), 1000);
  }

  /* ============================================================
     18. SETTINGS VIEW
  ============================================================ */
  function loadSettingsIntoUI() {
    const s = state.settings;
    applyTheme(s.theme);
    applyFontSize(s.fontSize);
    document.getElementById("languageSelect").value = s.language;
    document.getElementById("autoSaveToggle").checked = s.autoSave;
    document.querySelectorAll("#fontSegment button").forEach(b => b.classList.toggle("active", b.dataset.val === s.fontSize));
    const user = currentUser();
    if (user) document.getElementById("settingsDisplayName").value = user.displayName || user.username;
  }

  function saveSetting(key, value) {
    state.settings[key] = value;
    save(LS.SETTINGS, state.settings);
  }

  /* ============================================================
     19. NOTIFICATIONS DROPDOWN
  ============================================================ */
  function renderNotifications() {
    const list = load(LS.ACTIVITY, []).slice(0, 6);
    const el = document.getElementById("notifList");
    const dot = document.getElementById("notifDot");
    if (!list.length) {
      el.innerHTML = `<div class="dropdown-item" style="opacity:.6">No notifications yet</div>`;
      dot.classList.add("d-none");
      return;
    }
    dot.classList.toggle("d-none", (Date.now() - new Date(list[0].time).getTime()) > 60000);
    el.innerHTML = list.map(a => `<div class="dropdown-item" style="cursor:default"><i class="fa-solid fa-circle-info" style="color:var(--blue-400)"></i><span style="font-size:12.5px">${escapeHtml(a.message)} · ${timeAgo(a.time)}</span></div>`).join("");
  }

  /* ============================================================
     20. GLOBAL EVENT WIRING
  ============================================================ */
  function wireEvents() {
    // Login
    document.getElementById("loginForm").addEventListener("submit", e => {
      e.preventDefault();
      const username = document.getElementById("loginUsername").value;
      const password = document.getElementById("loginPassword").value;
      const remember = document.getElementById("rememberMe").checked;
      const result = attemptLogin(username, password);
      const errorBox = document.getElementById("loginError");
      if (!result.ok) {
        errorBox.querySelector("span").textContent = result.error;
        errorBox.classList.remove("d-none");
        void errorBox.offsetWidth;
        errorBox.style.animation = "none"; void errorBox.offsetWidth; errorBox.style.animation = "";
        return;
      }
      errorBox.classList.add("d-none");
      doLogin(result.user, remember);
    });
    document.getElementById("togglePw").addEventListener("click", () => {
      const input = document.getElementById("loginPassword");
      const icon = document.querySelector("#togglePw i");
      input.type = input.type === "password" ? "text" : "password";
      icon.className = input.type === "password" ? "fa-solid fa-eye" : "fa-solid fa-eye-slash";
    });
    document.getElementById("quickAdminBtn").addEventListener("click", () => {
      document.getElementById("loginUsername").value = "admin";
      document.getElementById("loginPassword").value = "admin123";
    });

    // Logout
    document.getElementById("logoutBtn").addEventListener("click", doLogout);
    document.getElementById("dropdownLogout").addEventListener("click", doLogout);

    // Sidebar nav
    document.querySelectorAll(".nav-item[data-view], .dropdown-item[data-view]").forEach(btn => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
    document.getElementById("sidebarCollapseBtn").addEventListener("click", () => {
      document.getElementById("appShell").classList.toggle("collapsed");
    });
    document.getElementById("mobileMenuBtn").addEventListener("click", () => {
      document.getElementById("appShell").classList.add("sidebar-open");
    });
    document.getElementById("sidebarOverlay").addEventListener("click", closeMobileSidebar);

    // Theme toggle (topbar)
    document.getElementById("themeToggleBtn").addEventListener("click", () => {
      const next = state.settings.theme === "dark" ? "light" : "dark";
      saveSetting("theme", next);
      applyTheme(next);
      renderCurrentView();
    });
    document.getElementById("themeSegment").addEventListener("click", e => {
      const btn = e.target.closest("button"); if (!btn) return;
      saveSetting("theme", btn.dataset.val); applyTheme(btn.dataset.val); renderCurrentView();
    });
    document.getElementById("fontSegment").addEventListener("click", e => {
      const btn = e.target.closest("button"); if (!btn) return;
      saveSetting("fontSize", btn.dataset.val); applyFontSize(btn.dataset.val);
    });
    document.getElementById("languageSelect").addEventListener("change", e => {
      saveSetting("language", e.target.value);
      toast("Language preference saved. (UI translation coming soon!)", "info");
    });
    document.getElementById("autoSaveToggle").addEventListener("change", e => {
      saveSetting("autoSave", e.target.checked);
      toast(`Auto save ${e.target.checked ? "enabled" : "disabled"}.`, "info");
    });
    document.getElementById("saveProfileBtn").addEventListener("click", () => {
      const users = load(LS.USERS, []);
      const user = currentUser();
      const idx = users.findIndex(u => u.id === user.id);
      const newName = document.getElementById("settingsDisplayName").value.trim();
      const newPw = document.getElementById("settingsNewPassword").value;
      if (newName) users[idx].displayName = newName;
      if (newPw) users[idx].password = newPw;
      save(LS.USERS, users);
      document.getElementById("settingsNewPassword").value = "";
      updateProfileChip();
      toast("Profile saved.", "success");
      logActivity("user", `${user.username} updated their profile`);
    });
    document.getElementById("settingsResetBtn").addEventListener("click", resetApp);
    document.getElementById("resetAppBtn").addEventListener("click", resetApp);

    // Devices view
    document.getElementById("addDeviceBtn").addEventListener("click", () => openDeviceModal(null));
    document.getElementById("emptyAddDeviceBtn").addEventListener("click", () => openDeviceModal(null));
    document.getElementById("deviceForm").addEventListener("submit", handleDeviceFormSubmit);
    document.getElementById("deviceSearchInput").addEventListener("input", e => { state.deviceSearch = e.target.value; state.devicePage = 1; renderDevicesView(); });
    document.getElementById("filterType").addEventListener("change", e => { state.deviceFilterType = e.target.value; state.devicePage = 1; renderDevicesView(); });
    document.getElementById("sortField").addEventListener("change", e => { state.deviceSort = e.target.value; renderDevicesView(); });
    document.getElementById("exportAllBtn").addEventListener("click", () => exportDevicesJSON(getVisibleDevices(), "sikyorify_all_devices.json"));
    document.getElementById("exportSelectedBtn").addEventListener("click", () => {
      const list = getVisibleDevices().filter(d => state.selectedDeviceIds.has(d.id));
      exportDevicesJSON(list, "sikyorify_selected_devices.json");
    });
    document.getElementById("printDevicesBtn").addEventListener("click", () => printDevices(filterSortDevices(getVisibleDevices())));
    document.getElementById("selectAllDevices").addEventListener("change", e => {
      const rows = document.querySelectorAll(".dev-check");
      rows.forEach(r => { r.checked = e.target.checked; e.target.checked ? state.selectedDeviceIds.add(r.dataset.id) : state.selectedDeviceIds.delete(r.dataset.id); });
    });
    document.getElementById("devicesTableBody").addEventListener("change", e => {
      if (e.target.classList.contains("dev-check")) {
        e.target.checked ? state.selectedDeviceIds.add(e.target.dataset.id) : state.selectedDeviceIds.delete(e.target.dataset.id);
      }
    });
    document.getElementById("devicesTableBody").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === "view") viewDeviceDetails(id);
      if (act === "edit") openDeviceModal(id);
      if (act === "delete") deleteDevice(id);
      if (act === "copy") copyMac(id);
    });
    document.getElementById("devicesPagination").addEventListener("click", e => {
      const btn = e.target.closest("button[data-pg]"); if (!btn) return;
      const pg = btn.dataset.pg;
      if (pg === "prev") state.devicePage--; else if (pg === "next") state.devicePage++; else state.devicePage = parseInt(pg, 10);
      renderDevicesView();
    });

    // Users view
    document.getElementById("addUserBtn").addEventListener("click", () => openUserModal(null));
    document.getElementById("userForm").addEventListener("submit", handleUserFormSubmit);
    document.getElementById("userSearchInput").addEventListener("input", e => { userSearchTerm = e.target.value; renderUsersView(); });
    document.getElementById("usersTableBody").addEventListener("click", e => {
      const btn = e.target.closest("button[data-uact]"); if (!btn) return;
      const { uact, id } = btn.dataset;
      if (uact === "edit") openUserModal(id);
      if (uact === "delete") deleteUser(id);
      if (uact === "toggle") toggleUserEnabled(id);
      if (uact === "reset") resetUserPassword(id);
    });

    // Advanced search
    document.getElementById("advSearchInput").addEventListener("input", renderAdvSearch);
    document.getElementById("advSearchChips").addEventListener("click", e => {
      const chip = e.target.closest(".chip"); if (!chip) return;
      document.querySelectorAll("#advSearchChips .chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      state.advField = chip.dataset.field;
      renderAdvSearch();
    });
    document.getElementById("advSearchTableBody").addEventListener("click", e => {
      const btn = e.target.closest("button[data-act]"); if (!btn) return;
      const { act, id } = btn.dataset;
      if (act === "view") viewDeviceDetails(id);
      if (act === "edit") openDeviceModal(id);
    });

    // Global search bar -> jumps to search view
    document.getElementById("globalSearch").addEventListener("input", e => {
      if (e.target.value.trim()) {
        switchView("search");
        document.getElementById("advSearchInput").value = e.target.value;
        renderAdvSearch();
      }
    });

    // Backup / Restore
    document.getElementById("backupAllBtn").addEventListener("click", createBackup);
    document.getElementById("downloadBackupBtn").addEventListener("click", downloadLastBackup);
    document.getElementById("exportTxtBtn").addEventListener("click", exportTxt);
    document.getElementById("importTxtBtn").addEventListener("click", () => document.getElementById("importTxtFile").click());
    document.getElementById("importTxtFile").addEventListener("change", e => { if (e.target.files[0]) importTxtFile(e.target.files[0]); e.target.value = ""; });
    document.getElementById("restoreBackupBtn").addEventListener("click", () => document.getElementById("restoreBackupFile").click());
    document.getElementById("restoreBackupFile").addEventListener("change", e => { if (e.target.files[0]) restoreFromBackupFile(e.target.files[0]); e.target.value = ""; });

    // FAB + scroll to top
    document.getElementById("fab").addEventListener("click", () => openDeviceModal(null));
    const content = document.getElementById("mainContent");
    content.addEventListener("scroll", () => {
      document.getElementById("scrollTopBtn").classList.toggle("d-none", content.scrollTop < 300);
    });
    document.getElementById("scrollTopBtn").addEventListener("click", () => content.scrollTo({ top: 0, behavior: "smooth" }));

    // Notifications
    document.getElementById("notifBtn").addEventListener("click", renderNotifications);

    // Keyboard shortcuts
    document.addEventListener("keydown", e => {
      if (document.getElementById("appShell").classList.contains("d-none")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); switchView("search"); document.getElementById("advSearchInput").focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") { e.preventDefault(); openDeviceModal(null); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); switchView("dashboard"); }
    });

    window.addEventListener("resize", () => { if (state.currentView === "dashboard") renderDashboard(); });
  }

  function updateProfileChip() {
    const user = currentUser();
    if (!user) return;
    document.getElementById("profileAvatar").textContent = user.username[0].toUpperCase();
    document.getElementById("profileName").textContent = user.displayName || user.username;
    document.getElementById("profileRole").textContent = user.role === "admin" ? "Administrator" : "Standard User";
  }

  function applyRoleVisibility() {
    document.querySelectorAll(".admin-only").forEach(el => el.classList.toggle("d-none", !isAdmin()));
  }

  /* ============================================================
     21. SHOW LOGIN / SHOW APP
  ============================================================ */
  function showLogin() {
    document.getElementById("appShell").classList.add("d-none");
    document.getElementById("loginScreen").classList.remove("d-none");
    document.getElementById("loginForm").reset();
    document.getElementById("loginError").classList.add("d-none");
  }

  function showApp() {
    document.getElementById("loginScreen").classList.add("d-none");
    document.getElementById("appShell").classList.remove("d-none");
    updateProfileChip();
    applyRoleVisibility();
    loadSettingsIntoUI();
    switchView("dashboard");
    renderNotifications();
  }

  /* ============================================================
     22. INIT
  ============================================================ */
  function init() {
    seedIfEmpty();
    wireEvents();
    initScanCanvas();

    setTimeout(() => {
      document.getElementById("loadingScreen").style.opacity = "0";
      setTimeout(() => {
        document.getElementById("loadingScreen").style.display = "none";
        if (state.session && load(LS.USERS, []).find(u => u.id === state.session.userId)) {
          document.getElementById("loginScreen").classList.remove("d-none");
          showApp();
        } else {
          showLogin();
        }
      }, 350);
    }, 900);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
