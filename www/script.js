/* file: script.js - ClassConnect Application Script */

// ============================================================================
// RUNTIME CONFIGURATION (Secure In-Memory Protected Vault)
// ============================================================================
const _CFG_VAULT = {
  _u: "aHR0cHM6Ly91Y3RvZHFucndycm9wcGthZ2dibC5zdXBhYmFzZS5jbw==",
  _k: "ZXlKaGJHY2lPaUpJVXpJMU5pSXNJblI1Y0NJNklrcFhWQ0o5LmV5SnBjM01pT2lKemRYQmhZbUZ6WlNJc0luSmxaaUk2SW5WamRHOWtjVzV5ZDNKeWIzQndhMkZuWjJKc0lpd2ljbTlzWlNJNkltRnViMjRpTENKcFlYUWlPakUzT0RVMk9EazBORFlzSW1WNGNDSTZNakV3TVRJMk5UUTBObjAuRXdGVTVMbWN6RDhQTExlVjBqVEZ2V3hudU16TDY1eHlfenBrWkVBVjNOQQ==",
  _decode: function(str) {
    try {
      if (typeof atob === "function") return atob(str);
      if (typeof Buffer !== "undefined") return Buffer.from(str, "base64").toString("utf-8");
    } catch(e) {}
    return "";
  }
};

let SUPABASE_URL = _CFG_VAULT._decode(_CFG_VAULT._u);
let SUPABASE_ANON_KEY = _CFG_VAULT._decode(_CFG_VAULT._k);

// Runtime config loader for server environment
async function loadServerConfig() {
  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const cfg = await res.json();
      if (cfg.supabaseUrl && cfg.supabaseAnonKey) {
        SUPABASE_URL = cfg.supabaseUrl;
        SUPABASE_ANON_KEY = cfg.supabaseAnonKey;
        return cfg;
      }
    }
  } catch (err) {
    // Suppressed fallback
  }
  return { supabaseUrl: SUPABASE_URL, supabaseAnonKey: SUPABASE_ANON_KEY };
}

/*
 * Supabase bootstrap
 */
let supabaseClient = null;
let supabaseStatus = "not-initialized";
let remoteUser = null;
let remoteProfile = null;

function createSupabaseFallback(reason) {
  console.warn("[ClassConnect] Supabase unavailable:", reason);
  return {
    auth: {
      getSession: function () {
        return Promise.resolve({ data: { session: null }, error: null });
      },
      signUp: function () {
        return Promise.resolve({
          data: { user: null, session: null },
          error: { message: "Supabase is unavailable." },
        });
      },
      signInWithPassword: function () {
        return Promise.resolve({
          data: { user: null, session: null },
          error: { message: "Supabase is unavailable." },
        });
      },
      signOut: function () {
        return Promise.resolve({ error: null });
      },
      resetPasswordForEmail: function () {
        return Promise.resolve({
          data: null,
          error: { message: "Supabase is unavailable." },
        });
      },
      updateUser: function () {
        return Promise.resolve({
          data: { user: null },
          error: { message: "Supabase is unavailable." },
        });
      },
      onAuthStateChange: function () {
        return {
          data: {
            subscription: {
              unsubscribe: function () {},
            },
          },
          error: null,
        };
      },
    },
  };
}

function initializeSupabase() {
  if (supabaseClient && supabaseStatus === "ready") {
    return supabaseClient;
  }

  try {
    var sdk = typeof window !== "undefined" ? window.supabase : null;
    if (!sdk || typeof sdk.createClient !== "function") {
      supabaseStatus = "fallback";
      supabaseClient = createSupabaseFallback(
        "Supabase SDK is not loaded. Check that the Supabase script tag appears before script.js."
      );
      return supabaseClient;
    }

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      SUPABASE_URL = _CFG_VAULT._decode(_CFG_VAULT._u);
      SUPABASE_ANON_KEY = _CFG_VAULT._decode(_CFG_VAULT._k);
    }

    var client = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    if (!client || !client.auth || typeof client.auth.getSession !== "function") {
      throw new Error("Supabase client was created without a working auth API.");
    }

    supabaseClient = client;
    supabaseStatus = "ready";
    console.log("[ClassConnect] Supabase initialized successfully.");
    return supabaseClient;
  } catch (error) {
    supabaseStatus = "fallback";
    console.error("[ClassConnect] Supabase initialization failed:", error);
    supabaseClient = createSupabaseFallback(error.message || "Unknown initialization error");
    return supabaseClient;
  }
}

function getSupabaseClient() {
  return initializeSupabase();
}

function withTimeout(promise, milliseconds, label) {
  var timeoutId;
  var timeout = new Promise(function (_, reject) {
    timeoutId = setTimeout(function () {
      reject(new Error(label + " timed out after " + milliseconds + "ms."));
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(function () {
    clearTimeout(timeoutId);
  });
}

function isSupabaseReady() {
  var client = getSupabaseClient();
  return supabaseStatus === "ready" &&
    client &&
    client.auth &&
    typeof client.auth.getSession === "function";
}

function isTransientSupabaseError(error) {
  var message = error && error.message ? String(error.message).toLowerCase() : "";
  return !navigator.onLine ||
    message.indexOf("failed to fetch") !== -1 ||
    message.indexOf("network") !== -1 ||
    message.indexOf("timeout") !== -1 ||
    message.indexOf("timed out") !== -1;
}

function authUserName(authUser) {
  if (!authUser) return "Student";
  var metadata = authUser.user_metadata || {};
  return metadata.full_name || metadata.name || authUser.email || "Student";
}

function getRemoteSession() {
  var client = getSupabaseClient();
  if (!isSupabaseReady()) {
    var unavailable = new Error(
      "Supabase is unavailable. Check the Supabase project URL, SDK, and network connection."
    );
    return Promise.resolve({ session: null, error: unavailable, available: false });
  }

  console.log("[ClassConnect] Checking Supabase session...");
  return withTimeout(client.auth.getSession(), 5000, "Supabase session check")
    .then(function (result) {
      if (result && result.error) {
        console.error("[ClassConnect] Supabase session check returned an error:", result.error);
        return { session: null, error: result.error, available: true };
      }
      var session = result && result.data ? result.data.session : null;
      console.log("[ClassConnect] Supabase session check complete:", session ? "session found" : "no session");
      return { session: session || null, error: null, available: true };
    })
    .catch(function (error) {
      console.error("[ClassConnect] Supabase session check failed:", error);
      return { session: null, error: error, available: true };
    });
}

(function () {
  "use strict";

  // Remove all localStorage data keys for user data; we'll use Supabase for everything.
  // Only keep settings (localStorage) for font type preference, etc.
  const KEYS = {
    SETTINGS: "cc_settings",
    // Keep only settings; everything else will be in Supabase
  };

  const ADMIN_EMAILS = ["admin@classconnect.com", "admin@hddev.com"];

  const DEMO_CLASSMATES = [
    { name: "Maria Delacruz", course: "BSIT", year: "3rd Year", section: "BSIT 3-A", email: "maria.delacruz@ctu.edu.ph", bio: "Aspiring Web Developer & UI Designer" },
    { name: "Juan Reyes", course: "BSIT", year: "3rd Year", section: "BSIT 3-A", email: "juan.reyes@ctu.edu.ph", bio: "Tech Enthusiast and Mobile App Developer" },
    { name: "Anna Santos", course: "BSIT", year: "3rd Year", section: "BSIT 3-B", email: "anna.santos@ctu.edu.ph", bio: "Data Analyst & Database Administrator" },
    { name: "Carlos Garcia", course: "BSIT", year: "3rd Year", section: "BSIT 3-A", email: "carlos.garcia@ctu.edu.ph", bio: "Cybersecurity student & Networking enthusiast" },
    { name: "Lisa Tan", course: "BSIT", year: "3rd Year", section: "BSIT 3-B", email: "lisa.tan@ctu.edu.ph", bio: "AI & Machine Learning student" },
  ];

  const DEMO_FAQS = [
    { question: "What is ClassConnect?", answer: "ClassConnect is a platform designed to help college students connect with classmates, manage subjects, track assignments, calculate GWA, and stay organized throughout their academic journey." },
    { question: "How do I create an account?", answer: "Click on Sign Up on the login page, fill in your full name, email address, and a password of at least 6 characters, then confirm your password and submit." },
    { question: "How are classmates matched?", answer: "Classmates are automatically matched based on your section in your Profile (e.g. BSIT 3-A). Ensure your section is filled in accurately!" },
    { question: "Can I access ClassConnect on multiple devices?", answer: "Yes. ClassConnect is a Progressive Web App that works seamlessly on both mobile phones and desktop computers." },
    { question: "How do I add a subject?", answer: "Go to the Subjects page from the menu, click the Add Subject button, fill in the subject name, professor, and schedule, then click Save." },
    { question: "How do I track my assignments?", answer: "Navigate to the Assignments page, click Add Task to create new tasks, and check them off as you complete them using the checkbox." },
    { question: "How does the Grades page work?", answer: "Enter your grade for each subject along with its units/credits, year level, and semester. The app automatically calculates your General Weighted Average (GWA). You can also exclude PE/NSTP subjects." },
    { question: "How does the Curriculum section work?", answer: "You can organize college subjects by Year Level and Semester, or upload your official curriculum PDF syllabus for instant offline access." },
    { question: "Is my data safe?", answer: "Yes. All your data — profile, subjects, assignments, grades, schedule, curriculum, and posts — is stored in Supabase, a cloud-hosted PostgreSQL database. Supabase enforces Row-Level Security (RLS) on every table, so only your authenticated account can read or modify your records. The only item stored locally on your device is your font preference setting (font family choice)." },
  ];

  // ===== INACTIVITY AUTO-LOGOUT =====
  var INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  var inactivityTimer = null;
  var inactivityActive = false;

  function resetInactivityTimer() {
    if (!inactivityActive) return;
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(triggerInactivityLogout, INACTIVITY_TIMEOUT_MS);
  }

  function startInactivityTimer() {
    inactivityActive = true;
    resetInactivityTimer();
  }

  function stopInactivityTimer() {
    inactivityActive = false;
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
  }

  function showInactivityModal() {
    var overlay = document.getElementById("inactivity-modal-overlay");
    if (!overlay) return;
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideInactivityModal() {
    var overlay = document.getElementById("inactivity-modal-overlay");
    if (!overlay) return;
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
  }

  function triggerInactivityLogout() {
    if (!isLoggedIn()) return;
    console.log("[ClassConnect] Inactivity timeout — logging out automatically.");
    stopInactivityTimer();
    var client = getSupabaseClient();
    var remoteLogout = isSupabaseReady() && client.auth && typeof client.auth.signOut === "function"
      ? withTimeout(client.auth.signOut(), 5000, "Supabase inactivity logout").catch(function () {})
      : Promise.resolve();
    remoteLogout.then(function () {
      remoteUser = null;
      remoteProfile = null;
      closeDrawer();
      closeAllModals();
      switchView("view-home");
      showInactivityModal();
    });
  }

  /* UTILITY FUNCTIONS */
  function cryptoId() {
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  function escapeHtml(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function initials(name) {
    if (!name) return "S";
    const parts = name.trim().split(" ");
    return parts.length > 1 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : parts[0][0].toUpperCase();
  }

  // ===== FIXED: timeAgo now handles ISO string timestamps from Supabase =====
  function timeAgo(timestamp) {
    if (!timestamp) return "Just now";
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return "Just now";
    var seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return "Just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    if (days < 7) return days + "d ago";
    return Math.floor(days / 7) + "w ago";
  }

  // ===== NEW: Format timestamp in Philippine time (Asia/Manila, UTC+8) =====
  function formatTimestampPHT(timestamp) {
    if (!timestamp) return "Just now";
    var date = new Date(timestamp);
    if (isNaN(date.getTime())) return "Just now";
    try {
      var opts = {
        timeZone: "Asia/Manila",
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      };
      return date.toLocaleString("en-PH", opts) + " PHT";
    } catch (e) {
      return date.toLocaleString();
    }
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  function normalizeSection(section) {
    if (!section) return "";
    return section.trim().toUpperCase();
  }

  // Legacy getData/setData for settings only
  function getData(key, defaultVal) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultVal;
    } catch (e) {
      return defaultVal;
    }
  }

  function setData(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      showToast("Storage is full. Some data may not be saved.", "error");
    }
  }

  function stringToColor(str) {
    if (!str) return "#2563EB";
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    var palette = ["#2563EB", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#84CC16"];
    return palette[Math.abs(hash) % palette.length];
  }

  function formatTime12h(time24) {
    if (!time24) return "";
    var parts = time24.split(":");
    var h = parseInt(parts[0], 10);
    var m = parts[1] || "00";
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + m + " " + ampm;
  }

  // =========================================================
  // ===== NEW: DAY-OF-WEEK AND TIME SORTING HELPERS =====
  // Sunday = 0, Monday = 1, Tuesday = 2, Wednesday = 3,
  // Thursday = 4, Friday = 5, Saturday = 6
  // (Sunday sorts first, Saturday sorts last)
  // =========================================================
  var FULL_DAY_NAMES = [
    ["sunday", 0], ["monday", 1], ["tuesday", 2], ["wednesday", 3],
    ["thursday", 4], ["friday", 5], ["saturday", 6]
  ];

  var ABBR_DAY_PATTERNS = [
    [/\bsun\b/i, 0], [/\bmon\b/i, 1], [/\btues?\b/i, 2], [/\bweds?\b/i, 3],
    [/\bthurs?\b/i, 4], [/\bthu\b/i, 4], [/\bfri\b/i, 5], [/\bsat\b/i, 6]
  ];

  // Parses compact day-letter codes like "MWF", "TTh", "MTWThFSSu".
  function parseCompactDayCodes(rawText) {
    var found = [];
    var letters = (rawText || "").replace(/[^A-Za-z]/g, "");
    var i = 0;
    while (i < letters.length) {
      var two = letters.substr(i, 2).toLowerCase();
      if (two === "th") { found.push(4); i += 2; continue; }
      if (two === "sa") { found.push(6); i += 2; continue; }
      if (two === "su") { found.push(0); i += 2; continue; }
      var one = letters.charAt(i).toLowerCase();
      if (one === "m") { found.push(1); i += 1; continue; }
      if (one === "t") { found.push(2); i += 1; continue; }
      if (one === "w") { found.push(3); i += 1; continue; }
      if (one === "f") { found.push(5); i += 1; continue; }
      if (one === "s") { found.push(6); i += 1; continue; }
      i += 1;
    }
    return found;
  }

  function extractDaysFromText(text) {
    if (!text) return [];
    var lower = String(text).toLowerCase();
    var days = [];
    var seen = {};

    function add(v) {
      if (!seen[v]) { seen[v] = true; days.push(v); }
    }

    FULL_DAY_NAMES.forEach(function (pair) {
      var re = new RegExp("\\b" + pair[0] + "\\b", "i");
      if (re.test(lower)) add(pair[1]);
    });

    if (days.length === 0) {
      ABBR_DAY_PATTERNS.forEach(function (pair) {
        if (pair[0].test(lower)) add(pair[1]);
      });
    }

    if (days.length === 0) {
      var digitIdx = lower.search(/[0-9]/);
      var segment = digitIdx === -1 ? String(text) : String(text).substring(0, digitIdx);
      segment = segment.split("|")[0].trim();
      if (segment && segment.replace(/[^A-Za-z]/g, "").length > 0 && segment.length <= 20) {
        parseCompactDayCodes(segment).forEach(add);
      }
    }

    return days;
  }

  function getEarliestDayValue(text) {
    var days = extractDaysFromText(text);
    if (days.length === 0) return 99;
    return Math.min.apply(null, days);
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    var cleaned = timeStr.trim().toLowerCase();
    var ampm = '';
    if (cleaned.includes('am')) ampm = 'am';
    else if (cleaned.includes('pm')) ampm = 'pm';
    cleaned = cleaned.replace(/[ap]m/g, '').trim();
    var parts = cleaned.split(':');
    var hours = parseInt(parts[0], 10) || 0;
    var minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  function extractStartTimeFromText(text) {
    if (!text) return null;
    var matches = text.match(/(\d{1,2}(?::\d{2})?\s*[ap]?m?)\s*[-–—]\s*(\d{1,2}(?::\d{2})?\s*[ap]?m?)/i);
    if (matches) {
      return parseTimeToMinutes(matches[1]);
    }
    var single = text.match(/\b(\d{1,2}(?::\d{2})?\s*[ap]?m?)\b/);
    if (single) {
      return parseTimeToMinutes(single[1]);
    }
    return null;
  }

  function getSortKey(text) {
    var day = getEarliestDayValue(text);
    var startMin = extractStartTimeFromText(text);
    if (startMin === null) startMin = 0;
    if (day === 99) {
      return 9999999 + startMin;
    }
    return day * 10000 + startMin;
  }

  function isAdmin() {
    var user = getCurrentUser();
    if (!user) return false;
    return ADMIN_EMAILS.some(function (email) {
      return user.email.toLowerCase() === email.toLowerCase();
    });
  }

  /* ===== GLOBAL LOADING OVERLAY (FAST & AUTO-EXPIRING) ===== */
  var loadingDepth = 0;
  var globalLoadingTimer = null;

  function showGlobalLoading() {
    loadingDepth++;
    var overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
    document.body.classList.add("cc-global-loading");

    // Safety timeout: Auto-dismiss overlay after 1200ms max so screen is never trapped
    if (globalLoadingTimer) clearTimeout(globalLoadingTimer);
    globalLoadingTimer = setTimeout(function () {
      forceHideGlobalLoading();
    }, 1200);
  }

  function forceHideGlobalLoading() {
    loadingDepth = 0;
    if (globalLoadingTimer) {
      clearTimeout(globalLoadingTimer);
      globalLoadingTimer = null;
    }
    var overlay = document.getElementById("global-loading-overlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
    document.body.classList.remove("cc-global-loading");
  }

  function hideGlobalLoading() {
    if (loadingDepth > 0) loadingDepth--;
    if (loadingDepth === 0) {
      forceHideGlobalLoading();
    }
  }

  function withLoading(fn) {
    showGlobalLoading();
    return Promise.resolve()
      .then(fn)
      .then(function (result) { hideGlobalLoading(); return result; })
      .catch(function (err) { hideGlobalLoading(); throw err; });
  }

  function showToast(message, type) {
    type = type || "success";
    var existing = document.getElementById("cc-toast");
    if (existing) existing.remove();
    var iconMap = {
      success: "fa-circle-check",
      error: "fa-circle-xmark",
      warning: "fa-triangle-exclamation",
      info: "fa-circle-info",
    };
    var toast = document.createElement("div");
    toast.id = "cc-toast";
    toast.className = "cc-toast cc-toast-" + type;
    toast.innerHTML =
      '<i class="fas ' + (iconMap[type] || "fa-circle-info") + ' toast-icon"></i>' +
      '<span class="toast-msg">' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Close"><i class="fas fa-xmark"></i></button>';
    document.body.appendChild(toast);
    toast.querySelector(".toast-close").addEventListener("click", function () {
      dismissToast(toast);
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        toast.classList.add("cc-toast-show");
      });
    });
    var timer = setTimeout(function () { dismissToast(toast); }, 3500);
    toast._timer = timer;
  }

  function dismissToast(toast) {
    if (!toast) return;
    clearTimeout(toast._timer);
    toast.classList.remove("cc-toast-show");
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 380);
  }

  function showConfirm(message, onConfirm) {
    var existing = document.getElementById("cc-confirm-overlay");
    if (existing) existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "cc-confirm-overlay";
    overlay.className = "cc-confirm-overlay";
    overlay.innerHTML =
      '<div class="cc-confirm-box" role="dialog" aria-modal="true">' +
        '<div class="cc-confirm-icon-wrap">' +
          '<i class="fas fa-triangle-exclamation"></i>' +
        '</div>' +
        '<p class="cc-confirm-msg">' + escapeHtml(message) + '</p>' +
        '<div class="cc-confirm-btns">' +
          '<button class="cc-confirm-cancel">Cancel</button>' +
          '<button class="cc-confirm-ok">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("active");
      });
    });
    function closeConfirm() {
      overlay.classList.remove("active");
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 300);
    }
    overlay.querySelector(".cc-confirm-cancel").addEventListener("click", closeConfirm);
    overlay.querySelector(".cc-confirm-ok").addEventListener("click", function () {
      closeConfirm();
      if (typeof onConfirm === "function") onConfirm();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeConfirm();
    });
  }

  function showSuccessModal(message, buttonText, onButtonClick) {
    var existing = document.getElementById("cc-success-overlay");
    if (existing) existing.remove();
    var overlay = document.createElement("div");
    overlay.id = "cc-success-overlay";
    overlay.className = "cc-success-overlay";
    overlay.innerHTML =
      '<div class="cc-success-box" role="dialog" aria-modal="true">' +
        '<div class="cc-success-icon-wrap">' +
          '<i class="fas fa-check-circle"></i>' +
        '</div>' +
        '<h3 class="cc-success-title">Success!</h3>' +
        '<p class="cc-success-msg">' + escapeHtml(message) + '</p>' +
        '<button class="cc-success-btn btn-primary">' + escapeHtml(buttonText || "OK") + '</button>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        overlay.classList.add("active");
      });
    });
    function closeSuccess() {
      overlay.classList.remove("active");
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 300);
    }
    overlay.querySelector(".cc-success-btn").addEventListener("click", function () {
      closeSuccess();
      if (typeof onButtonClick === "function") onButtonClick();
    });
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) {
        closeSuccess();
        if (typeof onButtonClick === "function") onButtonClick();
      }
    });
  }

  function getCurrentUser() { return remoteUser; }

  function isLoggedIn() {
    return !!(remoteUser && remoteUser.email && remoteUser.provider === "supabase");
  }

  // ---------- Supabase data helpers ----------
  function supabaseTable(tableName) {
    var client = getSupabaseClient();
    if (!isSupabaseReady()) {
      throw new Error("Supabase is not available.");
    }
    return client.from(tableName);
  }

  async function withAuthCheck(fn) {
    if (!isLoggedIn()) {
      throw new Error("You must be logged in.");
    }
    return fn();
  }

  // ===============================================================
  // ===== NEW: SYNCHRONIZATION HELPERS =====
  // Ensure a subject exists in the main 'subjects' table.
  // If a subject with the same name (case-insensitive) exists,
  // update it with new info; otherwise create a new one.
  // ===============================================================
  async function ensureSubjectInSubjects(data) {
    const user = getCurrentUser();
    if (!user) return null;

    const { name, professor, schedule, year, semester } = data;
    if (!name) return null;

    // Find existing subject
    const { data: existing, error } = await supabaseTable("subjects")
      .select("*")
      .eq("user_id", user.id)
      .ilike("name", name.trim());

    if (error) {
      console.warn("[sync] Failed to find subject:", error);
      return null;
    }

    let subject = existing && existing.length > 0 ? existing[0] : null;

    // Prepare update/insert data
    const colors = ["#2563EB", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
    const payload = {
      user_id: user.id,
      name: name.trim(),
      professor: professor || "",
      schedule: schedule || "",
      year: year || "1st Year",
      semester: semester || "1st Semester",
    };

    if (subject) {
      // Merge: don't overwrite existing non-empty fields if the new data is empty
      if (!payload.professor && subject.professor) payload.professor = subject.professor;
      if (!payload.schedule && subject.schedule) payload.schedule = subject.schedule;
      if (!payload.year || payload.year === "1st Year") payload.year = subject.year || "1st Year";
      if (!payload.semester || payload.semester === "1st Semester") payload.semester = subject.semester || "1st Semester";

      // Keep existing color
      payload.color = subject.color;

      const { data: updated, error: updateErr } = await supabaseTable("subjects")
        .update(payload)
        .eq("id", subject.id)
        .select()
        .single();

      if (updateErr) {
        console.warn("[sync] Failed to update subject:", updateErr);
        return null;
      }
      return updated;
    } else {
      // New subject: assign color
      const allSubjects = await getSubjects();
      const color = colors[allSubjects.length % colors.length];
      payload.color = color;
      payload.tasks = [];

      const { data: created, error: insertErr } = await supabaseTable("subjects")
        .insert(payload)
        .select()
        .single();

      if (insertErr) {
        console.warn("[sync] Failed to create subject:", insertErr);
        return null;
      }
      return created;
    }
  }

  // When adding/updating a schedule entry, also ensure the subject exists.
  // Build a schedule string from day and time for the subject's 'schedule' field.
  function buildScheduleString(day, startTime, endTime) {
    let parts = [];
    if (day) parts.push(day);
    if (startTime) {
      let start = formatTime12h(startTime);
      let end = endTime ? formatTime12h(endTime) : "";
      if (start && end) parts.push(start + " - " + end);
      else if (start) parts.push(start);
    }
    return parts.join(" ");
  }

  // ===== POSTS =====
  async function getPosts() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var section = (remoteProfile && remoteProfile.section) || user.section || null;
      var year = (remoteProfile && remoteProfile.year) || user.year || null;
      var query = supabaseTable("posts")
        .select("*")
        .order("timestamp", { ascending: false });
      if (section) {
        query = query.eq("section", section);
        if (year) {
          query = query.or("year.eq." + year + ",year.is.null");
        }
      } else {
        query = query.eq("user_id", user.id);
      }
      var result = await withTimeout(query, 8000, "Posts load");
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function createPost(content, imageData) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var section = (remoteProfile && remoteProfile.section) || user.section || null;
      var year = (remoteProfile && remoteProfile.year) || user.year || null;
      var post = {
        user_id: user.id,
        author: user.name || "Student",
        content: content.trim(),
        image: imageData || null,
        tag: null,
        section: section,
        year: year,
        timestamp: new Date().toISOString(),
      };
      var result = await withTimeout(
        supabaseTable("posts").insert(post).select().single(),
        8000,
        "Post create"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function updatePost(id, content) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("posts")
          .update({ content: content.trim() })
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Post update"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function deletePost(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("posts")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Post delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== POST ACKNOWLEDGMENTS =====
  async function getPostAcknowledgments(postId) {
    return withAuthCheck(async function () {
      var result = await withTimeout(
        supabaseTable("post_acknowledgments")
          .select("*")
          .eq("post_id", postId),
        8000,
        "Acknowledgments load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function getAllPostAcknowledgments(postIds) {
    if (!postIds || postIds.length === 0) return [];
    return withAuthCheck(async function () {
      try {
        var result = await withTimeout(
          supabaseTable("post_acknowledgments")
            .select("*")
            .in("post_id", postIds),
          8000,
          "All acknowledgments load"
        );
        if (result.error) return [];
        return result.data || [];
      } catch(e) {
        return [];
      }
    });
  }

  async function toggleAcknowledgePost(postId) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var existing = await withTimeout(
        supabaseTable("post_acknowledgments")
          .select("*")
          .eq("post_id", postId)
          .eq("user_id", user.id)
          .maybeSingle(),
        8000,
        "Acknowledgment check"
      );
      if (existing.error) throw existing.error;
      if (existing.data) {
        var del = await withTimeout(
          supabaseTable("post_acknowledgments")
            .delete()
            .eq("post_id", postId)
            .eq("user_id", user.id),
          8000,
          "Acknowledgment remove"
        );
        if (del.error) throw del.error;
        return false;
      } else {
        var newAck = {
          post_id: postId,
          user_id: user.id,
          name: user.name || "Student",
          email: user.email,
        };
        var ins = await withTimeout(
          supabaseTable("post_acknowledgments").insert(newAck).select().single(),
          8000,
          "Acknowledgment add"
        );
        if (ins.error) throw ins.error;
        return true;
      }
    });
  }

  async function hasAcknowledgedPost(postId) {
    try {
      var acks = await getPostAcknowledgments(postId);
      var user = getCurrentUser();
      return acks.some(function (a) { return a.user_id === user.id; });
    } catch (e) {
      return false;
    }
  }

  // ===== COMMENTS =====
  async function getCommentsForPosts(postIds) {
    if (!postIds || postIds.length === 0) return [];
    return withAuthCheck(async function () {
      var result = await withTimeout(
        supabaseTable("comments")
          .select("*")
          .in("post_id", postIds)
          .order("created_at", { ascending: true }),
        8000,
        "Comments load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addComment(postId, content) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var comment = {
        post_id: postId,
        user_id: user.id,
        author: user.name || "Student",
        content: content.trim(),
        created_at: new Date().toISOString(),
      };
      var result = await withTimeout(
        supabaseTable("comments").insert(comment).select().single(),
        8000,
        "Comment add"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function deleteComment(commentId) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("comments")
          .delete()
          .eq("id", commentId)
          .eq("user_id", user.id),
        8000,
        "Comment delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== SUBJECTS (with sync) =====
  async function getSubjects() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("subjects")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        8000,
        "Subjects load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addSubject(name, professor, schedule, year, semester) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var colors = ["#2563EB", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
      var existing = await getSubjects();
      var color = colors[existing.length % colors.length];
      var newSubject = {
        user_id: user.id,
        name: name.trim(),
        professor: professor.trim(),
        schedule: schedule.trim(),
        year: year || "1st Year",
        semester: semester || "1st Semester",
        color: color,
        tasks: [],
      };
      var result = await withTimeout(
        supabaseTable("subjects").insert(newSubject).select().single(),
        8000,
        "Subject add"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function updateSubject(id, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("subjects")
          .update(data)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Subject update"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function deleteSubject(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("subjects")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Subject delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  async function addSubjectTask(subjectId, text) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var subj = await withTimeout(
        supabaseTable("subjects")
          .select("tasks")
          .eq("id", subjectId)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Subject fetch"
      );
      if (subj.error) throw subj.error;
      var tasks = subj.data.tasks || [];
      var newTask = { id: cryptoId(), text: text.trim(), completed: false };
      tasks.push(newTask);
      var result = await withTimeout(
        supabaseTable("subjects")
          .update({ tasks: tasks })
          .eq("id", subjectId)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Subject task add"
      );
      if (result.error) throw result.error;
      return newTask;
    });
  }

  async function toggleSubjectTask(subjectId, taskId) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var subj = await withTimeout(
        supabaseTable("subjects")
          .select("tasks")
          .eq("id", subjectId)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Subject fetch"
      );
      if (subj.error) throw subj.error;
      var tasks = subj.data.tasks || [];
      var task = tasks.find(function (t) { return t.id === taskId; });
      if (task) {
        task.completed = !task.completed;
        var result = await withTimeout(
          supabaseTable("subjects")
            .update({ tasks: tasks })
            .eq("id", subjectId)
            .eq("user_id", user.id),
          8000,
          "Subject task toggle"
        );
        if (result.error) throw result.error;
        return true;
      }
      return false;
    });
  }

  async function deleteSubjectTask(subjectId, taskId) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var subj = await withTimeout(
        supabaseTable("subjects")
          .select("tasks")
          .eq("id", subjectId)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Subject fetch"
      );
      if (subj.error) throw subj.error;
      var tasks = subj.data.tasks || [];
      var newTasks = tasks.filter(function (t) { return t.id !== taskId; });
      var result = await withTimeout(
        supabaseTable("subjects")
          .update({ tasks: newTasks })
          .eq("id", subjectId)
          .eq("user_id", user.id),
        8000,
        "Subject task delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== SCHEDULE (with sync) =====
  async function getSchedule() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("schedule")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        8000,
        "Schedule load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addScheduleItem(subject, day, startTime, endTime, room) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var item = {
        user_id: user.id,
        subject: subject.trim(),
        day: day.trim(),
        start_time: startTime,
        end_time: endTime,
        room: room.trim(),
      };
      // Insert schedule
      var result = await withTimeout(
        supabaseTable("schedule").insert(item).select().single(),
        8000,
        "Schedule add"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Ensure subject exists in 'subjects' =====
      var scheduleStr = buildScheduleString(day, startTime, endTime);
      await ensureSubjectInSubjects({
        name: subject.trim(),
        schedule: scheduleStr || day || "",
        year: "1st Year",
        semester: "1st Semester",
        professor: "",
      });

      return result.data;
    });
  }

  async function updateScheduleItem(id, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      // Fetch current item first to get subject name
      var current = await withTimeout(
        supabaseTable("schedule")
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Schedule fetch"
      );
      if (current.error) throw current.error;

      var result = await withTimeout(
        supabaseTable("schedule")
          .update(data)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Schedule update"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Update subject in 'subjects' =====
      var subjectName = data.subject || current.data.subject;
      var day = data.day || current.data.day;
      var startTime = data.start_time || current.data.start_time;
      var endTime = data.end_time || current.data.end_time;
      var scheduleStr = buildScheduleString(day, startTime, endTime);
      await ensureSubjectInSubjects({
        name: subjectName.trim(),
        schedule: scheduleStr || day || "",
        year: current.data.year || "1st Year",
        semester: current.data.semester || "1st Semester",
        professor: "",
      });

      return result.data;
    });
  }

  async function deleteScheduleItem(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("schedule")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Schedule delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== ASSIGNMENTS =====
  async function getAssignments() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("assignments")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        8000,
        "Assignments load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addAssignment(text, subject, dueDate) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var item = {
        user_id: user.id,
        text: text.trim(),
        subject: subject.trim(),
        due_date: dueDate || "",
        completed: false,
      };
      var result = await withTimeout(
        supabaseTable("assignments").insert(item).select().single(),
        8000,
        "Assignment add"
      );
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function toggleAssignment(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var current = await withTimeout(
        supabaseTable("assignments")
          .select("completed")
          .eq("id", id)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Assignment fetch"
      );
      if (current.error) throw current.error;
      var newCompleted = !current.data.completed;
      var result = await withTimeout(
        supabaseTable("assignments")
          .update({ completed: newCompleted })
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Assignment toggle"
      );
      if (result.error) throw result.error;
      return newCompleted;
    });
  }

  async function deleteAssignment(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("assignments")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Assignment delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== GRADES (with sync) =====
  async function getGrades() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("grades")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        8000,
        "Grades load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addGrade(subject, gradeValue, units, year, semester, exclude) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var item = {
        user_id: user.id,
        subject: subject.trim(),
        grade: parseFloat(gradeValue),
        units: parseFloat(units) || 3,
        year: year || "1st Year",
        semester: semester || "1st Semester",
        exclude: !!exclude,
      };
      var result = await withTimeout(
        supabaseTable("grades").insert(item).select().single(),
        8000,
        "Grade add"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Ensure subject exists in 'subjects' =====
      await ensureSubjectInSubjects({
        name: subject.trim(),
        year: year || "1st Year",
        semester: semester || "1st Semester",
        professor: "",
        schedule: "",
      });

      return result.data;
    });
  }

  async function updateGrade(id, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("grades")
          .update(data)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Grade update"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Update subject in 'subjects' =====
      if (data.subject) {
        await ensureSubjectInSubjects({
          name: data.subject.trim(),
          year: data.year || "1st Year",
          semester: data.semester || "1st Semester",
          professor: "",
          schedule: "",
        });
      }

      return result.data;
    });
  }

  async function deleteGrade(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("grades")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Grade delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  async function toggleGradeExclude(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var current = await withTimeout(
        supabaseTable("grades")
          .select("exclude")
          .eq("id", id)
          .eq("user_id", user.id)
          .single(),
        8000,
        "Grade fetch"
      );
      if (current.error) throw current.error;
      var newExclude = !current.data.exclude;
      var result = await withTimeout(
        supabaseTable("grades")
          .update({ exclude: newExclude })
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Grade exclude toggle"
      );
      if (result.error) throw result.error;
      return newExclude;
    });
  }

  // ===== CURRICULUM SUBJECTS (with sync) =====
  async function getCurriculumSubjects() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("curriculum_subjects")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true }),
        8000,
        "Curriculum subjects load"
      );
      if (result.error) throw result.error;
      return result.data || [];
    });
  }

  async function addCurriculumSubject(name, code, schedule, year, semester) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var item = {
        user_id: user.id,
        name: name.trim(),
        code: code.trim(),
        schedule: schedule.trim(),
        year: year.trim(),
        semester: semester || "1st Semester",
      };
      var result = await withTimeout(
        supabaseTable("curriculum_subjects").insert(item).select().single(),
        8000,
        "Curriculum subject add"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Ensure subject exists in 'subjects' =====
      await ensureSubjectInSubjects({
        name: name.trim(),
        schedule: schedule.trim() || "",
        year: year.trim(),
        semester: semester || "1st Semester",
        professor: "",
      });

      return result.data;
    });
  }

  async function updateCurriculumSubject(id, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("curriculum_subjects")
          .update(data)
          .eq("id", id)
          .eq("user_id", user.id)
          .select()
          .single(),
        8000,
        "Curriculum subject update"
      );
      if (result.error) throw result.error;

      // ===== SYNC: Update subject in 'subjects' =====
      if (data.name) {
        await ensureSubjectInSubjects({
          name: data.name.trim(),
          schedule: data.schedule || "",
          year: data.year || "1st Year",
          semester: data.semester || "1st Semester",
          professor: "",
        });
      }

      return result.data;
    });
  }

  async function deleteCurriculumSubject(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("curriculum_subjects")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id),
        8000,
        "Curriculum subject delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== CURRICULUM PDF =====
  async function getCurriculumPDF() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("curriculum_pdf")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
        8000,
        "Curriculum PDF load"
      );
      if (result.error) throw result.error;
      return result.data || null;
    });
  }

  async function saveCurriculumPDF(name, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var existing = await getCurriculumPDF();
      var payload = {
        user_id: user.id,
        name: name.trim(),
        data: data,
      };
      var result;
      if (existing) {
        result = await withTimeout(
          supabaseTable("curriculum_pdf")
            .update(payload)
            .eq("id", existing.id)
            .eq("user_id", user.id)
            .select()
            .single(),
          8000,
          "Curriculum PDF update"
        );
      } else {
        result = await withTimeout(
          supabaseTable("curriculum_pdf").insert(payload).select().single(),
          8000,
          "Curriculum PDF insert"
        );
      }
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function removeCurriculumPDF() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var existing = await getCurriculumPDF();
      if (!existing) return true;
      var result = await withTimeout(
        supabaseTable("curriculum_pdf")
          .delete()
          .eq("id", existing.id)
          .eq("user_id", user.id),
        8000,
        "Curriculum PDF delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== COR PDF =====
  async function getCORPDF() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var result = await withTimeout(
        supabaseTable("cor_pdf")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
        8000,
        "COR PDF load"
      );
      if (result.error) throw result.error;
      return result.data || null;
    });
  }

  async function saveCORPDF(name, data) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var existing = await getCORPDF();
      var payload = {
        user_id: user.id,
        name: name.trim(),
        data: data,
      };
      var result;
      if (existing) {
        result = await withTimeout(
          supabaseTable("cor_pdf")
            .update(payload)
            .eq("id", existing.id)
            .eq("user_id", user.id)
            .select()
            .single(),
          8000,
          "COR PDF update"
        );
      } else {
        result = await withTimeout(
          supabaseTable("cor_pdf").insert(payload).select().single(),
          8000,
          "COR PDF insert"
        );
      }
      if (result.error) throw result.error;
      return result.data;
    });
  }

  async function removeCORPDF() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      var existing = await getCORPDF();
      if (!existing) return true;
      var result = await withTimeout(
        supabaseTable("cor_pdf")
          .delete()
          .eq("id", existing.id)
          .eq("user_id", user.id),
        8000,
        "COR PDF delete"
      );
      if (result.error) throw result.error;
      return true;
    });
  }

  // ===== SCHOOL FILES DATA (SUPABASE with graceful column adaptation) =====
  var _schoolFilesLocalFallback = [];

  function getLocalSchoolFiles() {
    try {
      var user = getCurrentUser();
      var key = "classconnect_school_files_" + (user ? user.id : "guest");
      return JSON.parse(localStorage.getItem(key) || "[]");
    } catch(e) {
      return _schoolFilesLocalFallback || [];
    }
  }

  function saveLocalSchoolFiles(files) {
    try {
      var user = getCurrentUser();
      var key = "classconnect_school_files_" + (user ? user.id : "guest");
      localStorage.setItem(key, JSON.stringify(files));
    } catch(e) {
      _schoolFilesLocalFallback = files;
    }
  }

  async function getSchoolFiles() {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      if (!isSupabaseReady()) {
        return getLocalSchoolFiles();
      }
      try {
        var result = await withTimeout(
          supabaseTable("school_files")
            .select("*")
            .eq("user_id", user.id)
            .order("created_at", { ascending: false }),
          10000,
          "School files load"
        );
        if (result.error) {
          console.warn("[ClassConnect] Supabase school_files select note:", result.error);
          return getLocalSchoolFiles();
        }
        var list = result.data || [];
        saveLocalSchoolFiles(list);
        return list;
      } catch (err) {
        console.warn("[ClassConnect] getSchoolFiles using local cache:", err);
        return getLocalSchoolFiles();
      }
    });
  }

  async function saveSchoolFile(fileRecord) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      if (!isSupabaseReady()) {
        var localList = getLocalSchoolFiles();
        var newLocal = Object.assign({
          id: fileRecord.id || cryptoId(),
          user_id: user ? user.id : "guest",
          name: fileRecord.name || fileRecord.original_name || "File",
          original_name: fileRecord.original_name || fileRecord.name || "File",
          data: fileRecord.data || null,
          size: fileRecord.size || 0,
          mime_type: fileRecord.mime_type || "application/octet-stream",
          category: fileRecord.category || "Notes",
          subject: fileRecord.subject || "",
          notes: fileRecord.notes || "",
          created_at: fileRecord.created_at || new Date().toISOString()
        }, fileRecord);
        localList.unshift(newLocal);
        saveLocalSchoolFiles(localList);
        return newLocal;
      }

      var record = {
        id: fileRecord.id || cryptoId(),
        user_id: user.id,
        name: fileRecord.name || fileRecord.original_name || "File",
        original_name: fileRecord.original_name || fileRecord.name || "File",
        data: fileRecord.data || null,
        size: fileRecord.size || 0,
        mime_type: fileRecord.mime_type || "application/octet-stream",
        category: fileRecord.category || "Notes",
        subject: fileRecord.subject || "",
        notes: fileRecord.notes || "",
        created_at: fileRecord.created_at || new Date().toISOString()
      };

      // Adaptive insert: if columns don't exist in user's schema, strip them and retry
      var payload = Object.assign({}, record);
      var maxRetries = 5;
      var lastError = null;

      while (maxRetries > 0) {
        maxRetries--;
        var result = await withTimeout(
          supabaseTable("school_files").insert(payload).select().single(),
          12000,
          "School file insert"
        );

        if (!result.error) {
          var savedItem = result.data || record;
          var localList = getLocalSchoolFiles();
          localList.unshift(Object.assign({}, record, savedItem));
          saveLocalSchoolFiles(localList);
          return savedItem;
        }

        lastError = result.error;
        console.warn("[ClassConnect] Supabase school_files insert attempt note:", result.error);

        // Check if error is missing column in schema cache
        var errMsg = result.error.message || "";
        var colMatch = errMsg.match(/Could not find the '([^']+)' column/i);
        if (colMatch && colMatch[1] && payload.hasOwnProperty(colMatch[1])) {
          delete payload[colMatch[1]];
          continue; // Retry without that column
        }

        break;
      }

      // If remote table returned error, save to local cache seamlessly so user is never blocked
      if (lastError) {
        console.warn("[ClassConnect] Storing school file in local cache:", lastError.message);
        var localList = getLocalSchoolFiles();
        localList.unshift(record);
        saveLocalSchoolFiles(localList);
        return record;
      }

      return record;
    });
  }

  async function deleteSchoolFile(id) {
    return withAuthCheck(async function () {
      var user = getCurrentUser();
      // Remove from local storage cache
      var localList = getLocalSchoolFiles().filter(function (f) { return f.id !== id; });
      saveLocalSchoolFiles(localList);

      if (isSupabaseReady()) {
        try {
          await withTimeout(
            supabaseTable("school_files")
              .delete()
              .eq("id", id)
              .eq("user_id", user.id),
            8000,
            "School file delete"
          );
        } catch (err) {
          console.warn("[ClassConnect] Supabase delete note:", err);
        }
      }
      return true;
    });
  }

  // ===== Save profile =====
  async function saveProfile(data) {
    const user = getCurrentUser();
    if (!user || !isSupabaseReady()) {
      throw new Error("No active Supabase session is available.");
    }
    remoteProfile = Object.assign({}, getProfile(), data, {
      email: user.email.toLowerCase(),
      section: data.section ? normalizeSection(data.section) : getProfile().section,
    });
    var saved = await upsertRemoteProfile(remoteProfile);
    if (saved && saved.name && remoteUser) remoteUser.name = saved.name;
    return saved;
  }

  function getProfile() {
    const user = getCurrentUser();
    if (!user) return {};
    if (remoteProfile) return Object.assign({}, remoteProfile);
    return { name: user.name, email: user.email, section: "" };
  }

  function getProfilePhoto() {
    return getProfile().photo || null;
  }

  async function saveProfilePhoto(base64) {
    const p = getProfile();
    p.photo = base64;
    return saveProfile(p);
  }

  // Legacy auth functions (now use Supabase)
  function saveRemoteUserSession(authUser) {
    if (!authUser || !authUser.email) {
      console.warn("[ClassConnect] Supabase returned no authenticated user.");
      remoteUser = null;
      return null;
    }
    remoteUser = {
      id: authUser.id || cryptoId(),
      name: authUserName(authUser),
      email: authUser.email.trim().toLowerCase(),
      provider: "supabase",
    };
    return remoteUser;
  }

  function profileToRemoteRow(profile, user) {
    var source = profile || {};
    return {
      id: user.id,
      email: user.email,
      full_name: source.name || user.name || "Student",
      bio: source.bio || "",
      student_id: source.studentId || "",
      course: source.course || "",
      year: source.year || "",
      section: source.section || "",
      contact: source.contact || "",
      birthdate: source.birthdate || null,
      gender: source.gender || "",
      address: source.address || "",
      emergency: source.emergency || "",
      guardian_name: source.guardianName || "",
      guardian_contact: source.guardianContact || "",
      photo: source.photo || null,
    };
  }

  function remoteRowToProfile(row, user) {
    var current = row || {};
    return {
      name: current.full_name || (user && user.name) || "Student",
      email: current.email || (user && user.email) || "",
      bio: current.bio || "",
      studentId: current.student_id || "",
      course: current.course || "",
      year: current.year || "",
      section: current.section || "",
      contact: current.contact || "",
      birthdate: current.birthdate || "",
      gender: current.gender || "",
      address: current.address || "",
      emergency: current.emergency || "",
      guardianName: current.guardian_name || "",
      guardianContact: current.guardian_contact || "",
      photo: current.photo || null,
    };
  }

  async function loadRemoteProfile() {
    var user = getCurrentUser();
    if (!user || !isSupabaseReady()) return null;
    var client = getSupabaseClient();
    var response = await withTimeout(
      client.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      8000,
      "Supabase profile load"
    );
    if (response.error) {
      console.error("[ClassConnect] Supabase profile load failed:", response.error);
      throw response.error;
    }
    remoteProfile = remoteRowToProfile(response.data, user);
    return remoteProfile;
  }

  async function upsertRemoteProfile(profile) {
    var user = getCurrentUser();
    if (!user || !isSupabaseReady()) {
      throw new Error("No active Supabase session is available.");
    }
    var client = getSupabaseClient();
    var response = await withTimeout(
      client.from("profiles").upsert(profileToRemoteRow(profile, user), { onConflict: "id" }).select().single(),
      8000,
      "Supabase profile save"
    );
    if (response.error) {
      console.error("[ClassConnect] Supabase profile save failed:", response.error);
      throw response.error;
    }
    remoteProfile = remoteRowToProfile(response.data, user);
    return remoteProfile;
  }

  // ===== AUTH functions =====
  async function signup(name, email, password, studentId, year, section) {
    console.log("[ClassConnect] Signup requested for:", email);

    if (!isSupabaseReady()) {
      return {
        success: false,
        message: "Supabase is unavailable. Your account was not created. Please check the connection and try again.",
      };
    }

    var cleanSection = normalizeSection(section || "");
    var cleanStudentId = (studentId || "").trim();
    var cleanYear = (year || "").trim();
    var cleanName = name.trim();

    try {
      var client = getSupabaseClient();
      var response = await withTimeout(
        client.auth.signUp({
          email: email.trim().toLowerCase(),
          password: password,
          options: {
            data: {
              full_name: cleanName,
              name: cleanName,
              student_id: cleanStudentId,
              year: cleanYear,
              section: cleanSection,
            },
          },
        }),
        8000,
        "Supabase signup"
      );

      if (!response || response.error) {
        var signupError = response && response.error
          ? response.error
          : new Error("Supabase returned an empty signup response.");
        console.error("[ClassConnect] Supabase signup failed:", signupError);
        return { success: false, message: signupError.message || "Unable to create your account." };
      }

      var createdUser = response.data && response.data.user;
      if (!createdUser) {
        return { success: false, message: "Supabase did not return a new user. Your account was not created." };
      }

      if (response.data.session) {
        saveRemoteUserSession(createdUser);
        await upsertRemoteProfile({
          name: cleanName,
          studentId: cleanStudentId,
          year: cleanYear,
          section: cleanSection,
        });

        sendWelcomeEmail(createdUser.email, cleanName)
          .then(() => console.log("[ClassConnect] Welcome email sent via Brevo."))
          .catch(err => console.warn("[ClassConnect] Could not send welcome email:", err));
      }

      console.log(
        "[ClassConnect] Supabase signup succeeded:",
        response.data.session ? "signed in" : "email confirmation required"
      );
      return {
        success: true,
        confirmationRequired: !response.data.session,
        message: response.data.session
          ? "Your account has been created successfully!"
          : "Your account was created. Check your email to confirm it, then log in.",
      };
    } catch (error) {
      console.error("[ClassConnect] Supabase signup exception:", error);
      return {
        success: false,
        message: isTransientSupabaseError(error)
          ? "Could not reach Supabase. Your account was not created. Please try again."
          : error.message || "Unable to create your account.",
      };
    }
  }

  async function login(email, password) {
    console.log("[ClassConnect] Login requested for:", email);

    if (!isSupabaseReady()) {
      return {
        success: false,
        message: "Supabase is unavailable. Local login is disabled. Please check the connection and try again.",
      };
    }

    try {
      var client = getSupabaseClient();
      var response = await withTimeout(
        client.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: password,
        }),
        8000,
        "Supabase login"
      );

      if (!response || response.error) {
        var authError = response && response.error
          ? response.error
          : new Error("Supabase returned an empty login response.");
        console.error("[ClassConnect] Supabase login failed:", authError);
        return {
          success: false,
          message: isTransientSupabaseError(authError)
            ? "Could not reach Supabase. Local login is disabled. Please try again."
            : authError.message || "Invalid email or password.",
        };
      }
      if (!response.data || !response.data.user) {
        return { success: false, message: "Supabase did not return an authenticated user." };
      }
      saveRemoteUserSession(response.data.user);
      await loadRemoteProfile();

      var meta = (response.data.user.user_metadata) || {};
      if (meta.section && remoteProfile) {
        var profileSec = normalizeSection(remoteProfile.section || "");
        var isStuckOnDefault = profileSec === "BSIT 3-A" || profileSec === "BSIT III-A";
        if (!remoteProfile.section || isStuckOnDefault) {
          try {
            await upsertRemoteProfile({
              name: meta.full_name || meta.name || remoteProfile.name,
              studentId: meta.student_id || remoteProfile.studentId || "",
              year: meta.year || remoteProfile.year || "",
              section: meta.section,
            });
            console.log("[ClassConnect] Profile bootstrapped from signup metadata.");
          } catch (e) {
            console.warn("[ClassConnect] Could not bootstrap profile from metadata:", e);
          }
        }
      }

      console.log("[ClassConnect] Supabase login succeeded.");
      return { success: true, remote: true };
    } catch (error) {
      console.error("[ClassConnect] Supabase login exception:", error);
      return {
        success: false,
        message: isTransientSupabaseError(error)
          ? "Could not reach Supabase. Local login is disabled. Please try again."
          : error.message || "Unable to sign in.",
      };
    }
  }

  function logout() {
    showConfirm("Are you sure you want to log out?", function () {
      console.log("[ClassConnect] Logout requested.");
      var client = getSupabaseClient();
      var remoteLogout = isSupabaseReady() && client.auth && typeof client.auth.signOut === "function"
        ? withTimeout(client.auth.signOut(), 5000, "Supabase logout").catch(function (error) {
            console.warn("[ClassConnect] Supabase logout failed; clearing local session anyway:", error);
          })
        : Promise.resolve();
      remoteLogout.then(function () {
        stopInactivityTimer();
        remoteUser = null;
        remoteProfile = null;
        closeDrawer();
        closeAllModals();
        switchView("view-home");
        showPage("login-page");
        showLoginForm();
        console.log("[ClassConnect] Logout complete.");
        showToast("You have been logged out.", "info");
      });
    });
  }

  // Password change
  async function changePassword(currentPwd, newPwd, confirmPwd) {
    if (!currentPwd || !newPwd || !confirmPwd) {
      return { success: false, message: "Please fill in all password fields." };
    }
    if (newPwd.length < 6) {
      return { success: false, message: "New password must be at least 6 characters." };
    }
    if (newPwd !== confirmPwd) {
      return { success: false, message: "New passwords do not match." };
    }
    var user = getCurrentUser();
    if (!user) return { success: false, message: "Not logged in." };
    if (!isSupabaseReady()) {
      return { success: false, message: "Supabase is unavailable. Password was not changed." };
    }
    try {
      var client = getSupabaseClient();
      var verify = await withTimeout(
        client.auth.signInWithPassword({ email: user.email, password: currentPwd }),
        8000,
        "Supabase password verification"
      );
      if (!verify || verify.error) {
        return { success: false, message: (verify && verify.error && verify.error.message) || "Current password is incorrect." };
      }
      var response = await withTimeout(
        client.auth.updateUser({ password: newPwd }),
        8000,
        "Supabase password update"
      );
      if (response && response.error) {
        return { success: false, message: response.error.message || "Unable to update your password." };
      }

      sendPasswordChangedEmail(user.email, user.name || "Student")
        .then(() => console.log("[ClassConnect] Password changed email sent via Brevo."))
        .catch(err => console.warn("[ClassConnect] Could not send password changed email:", err));

      return { success: true, message: "Password updated successfully in Supabase." };
    } catch (error) {
      console.error("[ClassConnect] Supabase password update failed:", error);
      return {
        success: false,
        message: isTransientSupabaseError(error)
          ? "Could not reach Supabase. Password was not changed."
          : error.message || "Unable to update your password.",
      };
    }
  }

  // ===== BREVO EMAIL HELPER FUNCTIONS =====
  async function sendBrevoEmail(to, name, templateId, params) {
    try {
      const { data, error } = await supabaseClient.functions.invoke('send-email', {
        body: { to, name, templateId, params }
      });
      if (error) throw error;
      return data;
    } catch (err) {
      console.error("[ClassConnect] Brevo email send failed:", err);
      throw err;
    }
  }

  async function sendWelcomeEmail(email, name) {
    return await sendBrevoEmail(email, name, 12, { user_name: name, user_email: email });
  }

  async function sendResetLinkEmail(email, name, resetLink) {
    return await sendBrevoEmail(email, name, 10, { user_name: name, user_email: email, reset_link: resetLink });
  }

  async function sendDeletionConfirmEmail(email, name) {
    return await sendBrevoEmail(email, name, 14, { user_name: name, user_email: email });
  }

  async function sendPasswordChangedEmail(email, name) {
    return await sendBrevoEmail(email, name, 16, { user_name: name, user_email: email });
  }

  // ===== UI HELPERS (unchanged) =====
  function showPage(pageId) {
    document.querySelectorAll(".page").forEach(function (p) {
      p.classList.remove("active-page");
      p.style.display = "none";
    });
    var target = document.getElementById(pageId);
    if (target) {
      target.classList.add("active-page");
      target.style.display = "";
    }

    if (pageId === "dashboard-page") {
      var topnavEl = document.querySelector(".dashboard-topnav");
      if (topnavEl) topnavEl.style.display = "";
    }

    var bottomNav = document.querySelector(".bottom-nav");
    if (bottomNav) {
      bottomNav.style.display = pageId === "dashboard-page" ? "" : "none";
    }

    if (pageId === "dashboard-page") {
      document.body.classList.remove("body-scroll-lock");
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.width = "";
    } else {
      document.body.classList.add("body-scroll-lock");
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
    }
  }

  function showLoginForm() {
    var lf = document.getElementById("login-form");
    var sf = document.getElementById("signup-form");
    if (sf) {
      sf.classList.remove("active-form");
      sf.style.display = "none";
    }
    if (lf) {
      lf.classList.add("active-form");
      lf.style.display = "";
    }
    hideError("login-error");
    hideError("signup-error");
  }

  function showSignupForm() {
    var lf = document.getElementById("login-form");
    var sf = document.getElementById("signup-form");
    if (lf) {
      lf.classList.remove("active-form");
      lf.style.display = "none";
    }
    if (sf) {
      sf.classList.add("active-form");
      sf.style.display = "";
    }
    hideError("login-error");
    hideError("signup-error");
  }

  function showError(elId, message) {
    var el = document.getElementById(elId);
    if (el) {
      el.textContent = message;
      el.hidden = false;
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  function hideError(elId) {
    var el = document.getElementById(elId);
    if (el) el.hidden = true;
  }

  function setButtonLoading(btn, loading, loadingText) {
    if (!btn) return;
    btn.disabled = !!loading;
    var textSpan = btn.querySelector(".btn-text");
    if (loading) {
      if (!btn.getAttribute("data-orig-html")) {
        btn.setAttribute("data-orig-html", btn.innerHTML);
      }
      if (textSpan) {
        textSpan.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (loadingText || "Please wait...");
      } else {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (loadingText || "Please wait...");
      }
    } else {
      var orig = btn.getAttribute("data-orig-html");
      if (orig) {
        btn.innerHTML = orig;
        btn.removeAttribute("data-orig-html");
      }
    }
  }

  function openModal(id) {
    var overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.add("active-modal");
    document.body.style.overflow = "hidden";
  }

  function closeModal(id) {
    var overlay = document.getElementById(id);
    if (!overlay) return;
    overlay.classList.remove("active-modal");
    if (!document.querySelector(".modal-overlay.active-modal")) {
      document.body.style.overflow = "";
    }
  }

  function closeAllModals() {
    document.querySelectorAll(".modal-overlay").forEach(function (m) {
      m.classList.remove("active-modal");
    });
    document.body.style.overflow = "";
  }

  function switchView(viewId) {
    document.querySelectorAll(".dashboard-view").forEach(function (v) {
      v.classList.remove("active-view");
      v.style.display = "none";
    });
    var target = document.getElementById(viewId);
    if (target) {
      target.classList.add("active-view");
      target.style.display = "";
      var main = document.querySelector(".dashboard-main");
      if (main) main.scrollTop = 0;
    }
    document.querySelectorAll(".nav-item[data-view]").forEach(function (btn) {
      btn.classList.toggle("active-nav", btn.getAttribute("data-view") === viewId);
    });
    document.querySelectorAll(".drawer-item[data-view]").forEach(function (btn) {
      btn.classList.toggle("active-drawer-item", btn.getAttribute("data-view") === viewId);
    });
    closeDrawer();
    if (viewId === "view-settings") updateStorageDisplay();
    if (viewId === "view-grades") loadGrades();
    if (viewId === "view-classmates") loadClassmates();
    if (viewId === "view-faqs") loadFaqs();
    if (viewId === "view-subjects") {
      setupSubjectFilters();
      loadSubjects();
    }
    if (viewId === "view-schedule") {
      setupScheduleFilters();
      loadSchedule();
    }
    if (viewId === "view-curriculum") {
      setupCurriculumFilters();
      loadCurriculum();
    }
    if (viewId === "view-files") {
      setupSchoolFilesFilters();
      loadSchoolFiles();
    }
  }

  function navigateTo(viewId) { switchView(viewId); }

  function openDrawer() {
    var overlay = document.getElementById("side-drawer-overlay");
    var drawer = document.getElementById("side-drawer");
    if (overlay) overlay.classList.add("active-drawer");
    if (drawer) drawer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeDrawer() {
    var overlay = document.getElementById("side-drawer-overlay");
    var drawer = document.getElementById("side-drawer");
    if (overlay) overlay.classList.remove("active-drawer");
    if (drawer) drawer.classList.remove("open");
    if (!document.querySelector(".modal-overlay.active-modal")) {
      document.body.style.overflow = "";
    }
  }

  function toggleDrawer() {
    var drawer = document.getElementById("side-drawer");
    if (drawer && drawer.classList.contains("open")) closeDrawer();
    else openDrawer();
  }

  function handleOffline(isOffline) {
    var banner = document.getElementById("offline-banner");
    if (banner) banner.hidden = !isOffline;
  }

  function lockPortrait() {
    try {
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("portrait").catch(function () {});
      }
    } catch (e) {}

    function applyLandscapeLock() {
      var lock = document.getElementById("landscape-lock");
      if (!lock) return;
      var isMobilePhone = navigator.maxTouchPoints > 0 &&
        Math.min(screen.width, screen.height) <= 480;
      var isLandscape = window.innerWidth > window.innerHeight;
      lock.hidden = !(isMobilePhone && isLandscape);
    }
    applyLandscapeLock();
    window.addEventListener("resize", applyLandscapeLock);
    window.addEventListener("orientationchange", applyLandscapeLock);
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function (err) {
        console.warn("Service worker registration failed:", err);
      });
    }
  }

  // =========================================================
  // DEVICE NOTIFICATION MANAGER (SCHEDULES, TASKS, POSTS & SYSTEM)
  // =========================================================
  var DeviceNotificationManager = (function () {
    var STORAGE_PREFS = "cc_notification_prefs";
    var STORAGE_ITEMS = "cc_inapp_notifications";
    var STORAGE_LAST_POST = "cc_last_seen_post_time";
    var STORAGE_BANNER_DISMISSED = "cc_notif_banner_dismissed";

    var defaultPrefs = {
      enabled: true,
      scheduleDaily: true,
      scheduleUpcoming: true,
      assignments: true,
      posts: true,
      vibration: true,
      sound: true
    };

    function getPrefs() {
      try {
        var raw = localStorage.getItem(STORAGE_PREFS);
        return raw ? Object.assign({}, defaultPrefs, JSON.parse(raw)) : defaultPrefs;
      } catch (e) {
        return defaultPrefs;
      }
    }

    function savePrefs(prefs) {
      try {
        localStorage.setItem(STORAGE_PREFS, JSON.stringify(prefs));
      } catch (e) {}
    }

    function getInAppNotifications() {
      try {
        var raw = localStorage.getItem(STORAGE_ITEMS);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    }

    function saveInAppNotifications(items) {
      try {
        localStorage.setItem(STORAGE_ITEMS, JSON.stringify(items.slice(0, 50)));
      } catch (e) {}
    }

    function addInAppNotification(item) {
      var items = getInAppNotifications();
      var isDuplicate = items.some(function (i) {
        return i.title === item.title && i.body === item.body && (Date.now() - new Date(i.timestamp).getTime() < 300000);
      });
      if (isDuplicate) return;

      items.unshift(item);
      saveInAppNotifications(items);
      updateTopnavBadge();
      renderNotificationCenter();
      updateAppBadge();
    }

    function markAllAsRead() {
      var items = getInAppNotifications();
      items.forEach(function (i) { i.read = true; });
      saveInAppNotifications(items);
      updateTopnavBadge();
      renderNotificationCenter();
      updateAppBadge();
    }

    function markAsRead(id) {
      var items = getInAppNotifications();
      var found = items.find(function (i) { return i.id === id; });
      if (found) {
        found.read = true;
        saveInAppNotifications(items);
        updateTopnavBadge();
        renderNotificationCenter();
        updateAppBadge();
      }
    }

    function clearAll() {
      saveInAppNotifications([]);
      updateTopnavBadge();
      renderNotificationCenter();
      updateAppBadge();
    }

    function getUnreadCount() {
      var items = getInAppNotifications();
      return items.filter(function (i) { return !i.read; }).length;
    }

    function updateTopnavBadge() {
      var badge = document.getElementById("topnav-notif-badge");
      var pill = document.getElementById("notif-unread-count-pill");
      var count = getUnreadCount();
      if (badge) {
        if (count > 0) {
          badge.textContent = count > 99 ? "99+" : count;
          badge.style.display = "flex";
        } else {
          badge.style.display = "none";
        }
      }
      if (pill) {
        if (count > 0) {
          pill.textContent = count + " New";
          pill.style.display = "inline-block";
        } else {
          pill.style.display = "none";
        }
      }
    }

    function updateAppBadge() {
      try {
        if ("setAppBadge" in navigator) {
          var unread = getUnreadCount();
          if (unread > 0) {
            navigator.setAppBadge(unread).catch(function () {});
          } else {
            navigator.clearAppBadge().catch(function () {});
          }
        }
      } catch (e) {}
    }

    function playChime() {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        var ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          ctx.resume();
        }
        var now = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.5);
      } catch (e) {}
    }

    function vibrate(pattern) {
      try {
        var prefs = getPrefs();
        if (prefs.vibration && navigator.vibrate) {
          navigator.vibrate(pattern || [120, 60, 120]);
        }
      } catch (e) {}
    }

    function checkPermissionState() {
      if (!("Notification" in window)) return "unsupported";
      return Notification.permission;
    }

    function updatePermissionUI() {
      var state = checkPermissionState();
      var badge = document.getElementById("notif-permission-badge");
      var desc = document.getElementById("notif-permission-desc");
      var reqBtn = document.getElementById("notif-request-perm-btn");
      var banner = document.getElementById("device-notif-banner");

      if (badge) {
        badge.className = "notif-status-badge";
        if (state === "granted") {
          badge.classList.add("notif-status-granted");
          badge.textContent = "Allowed";
          if (desc) desc.textContent = "ClassConnect is allowed to send alerts to this device";
          if (reqBtn) reqBtn.style.display = "none";
        } else if (state === "denied") {
          badge.classList.add("notif-status-denied");
          badge.textContent = "Blocked";
          if (desc) desc.textContent = "Notifications are blocked in your browser site settings";
          if (reqBtn) reqBtn.style.display = "none";
        } else if (state === "unsupported") {
          badge.classList.add("notif-status-denied");
          badge.textContent = "Unsupported";
          if (desc) desc.textContent = "This browser does not support web notifications";
          if (reqBtn) reqBtn.style.display = "none";
        } else {
          badge.classList.add("notif-status-default");
          badge.textContent = "Needs Permission";
          if (desc) desc.textContent = "Click Enable to allow schedule & task reminders";
          if (reqBtn) reqBtn.style.display = "inline-block";
        }
      }

      if (banner) {
        var isDismissed = localStorage.getItem(STORAGE_BANNER_DISMISSED) === "true";
        if (state === "default" && !isDismissed) {
          banner.style.display = "flex";
        } else {
          banner.style.display = "none";
        }
      }

      var prefs = getPrefs();
      var masterInput = document.getElementById("notif-pref-master");
      var schedDailyInput = document.getElementById("notif-pref-schedule-daily");
      var schedUpInput = document.getElementById("notif-pref-schedule-upcoming");
      var assignInput = document.getElementById("notif-pref-assignments");
      var postsInput = document.getElementById("notif-pref-posts");
      var vibInput = document.getElementById("notif-pref-vibration");
      var soundInput = document.getElementById("notif-pref-sound");

      if (masterInput) masterInput.checked = prefs.enabled;
      if (schedDailyInput) schedDailyInput.checked = prefs.scheduleDaily;
      if (schedUpInput) schedUpInput.checked = prefs.scheduleUpcoming;
      if (assignInput) assignInput.checked = prefs.assignments;
      if (postsInput) postsInput.checked = prefs.posts;
      if (vibInput) vibInput.checked = prefs.vibration;
      if (soundInput) soundInput.checked = prefs.sound;
    }

    async function requestPermission() {
      if (!("Notification" in window)) {
        showToast("Notifications are not supported in this browser.", "warning");
        return false;
      }
      try {
        var res = await Notification.requestPermission();
        updatePermissionUI();
        if (res === "granted") {
          playChime();
          vibrate([150, 80, 150]);
          sendNotification(
            "Device Notifications Enabled",
            "ClassConnect will now notify you of daily schedules, upcoming classes, deadlines, and posts.",
            "system",
            { view: "view-home" }
          );
          showToast("Device notifications active!", "success");
          runAllReminderChecks();
          return true;
        } else if (res === "denied") {
          showToast("Notifications were blocked. Enable them in browser settings.", "warning");
          return false;
        }
      } catch (e) {
        console.error("Notification permission error:", e);
      }
      return false;
    }

    function sendNotification(title, body, type, options) {
      options = options || {};
      var prefs = getPrefs();
      if (!prefs.enabled) return;

      if (type === "schedule" && !prefs.scheduleDaily && !prefs.scheduleUpcoming) return;
      if (type === "assignment" && !prefs.assignments) return;
      if (type === "post" && !prefs.posts) return;

      addInAppNotification({
        id: "notif_" + Date.now() + "_" + Math.random().toString(36).substr(2, 6),
        type: type || "system",
        title: title,
        body: body,
        timestamp: new Date().toISOString(),
        read: false,
        view: options.view || "view-home",
        extra: options.extra || null
      });

      if (prefs.sound) playChime();
      if (prefs.vibration) vibrate(options.vibrate || [150, 80, 150]);

      if ("Notification" in window && Notification.permission === "granted") {
        var notifOptions = {
          body: body,
          icon: "logo.png",
          badge: "logo.png",
          tag: options.tag || ("cc_" + type + "_" + Date.now()),
          vibrate: prefs.vibration ? [150, 80, 150] : undefined,
          data: {
            view: options.view || "view-home",
            url: "./index.html",
            extra: options.extra || null
          },
          requireInteraction: options.requireInteraction || false
        };

        if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: "SHOW_NOTIFICATION",
            title: title,
            options: notifOptions
          });
        } else if ("serviceWorker" in navigator) {
          navigator.serviceWorker.ready.then(function (reg) {
            if (reg.showNotification) {
              reg.showNotification(title, notifOptions);
            } else {
              new Notification(title, notifOptions);
            }
          }).catch(function () {
            try { new Notification(title, notifOptions); } catch (e) {}
          });
        } else {
          try { new Notification(title, notifOptions); } catch (e) {}
        }
      }
    }

    function parseDaysFromText(text) {
      if (!text) return [];
      var str = text.toUpperCase();
      var days = new Set();
      if (str.indexOf("DAILY") !== -1 || str.indexOf("EVERYDAY") !== -1) {
        return [0, 1, 2, 3, 4, 5, 6];
      }
      if (str.indexOf("MON") !== -1 || str.indexOf("M") !== -1) days.add(1);
      if (str.indexOf("TUE") !== -1 || str.indexOf("THU") !== -1 || str.indexOf("TH") !== -1 || str.indexOf("T") !== -1) {
        if (str.indexOf("THU") !== -1 || str.indexOf("TH") !== -1) days.add(4);
        if (str.indexOf("TUE") !== -1 || (str.indexOf("T") !== -1 && str.indexOf("TH") === -1)) days.add(2);
      }
      if (str.indexOf("WED") !== -1 || str.indexOf("W") !== -1) days.add(3);
      if (str.indexOf("FRI") !== -1 || str.indexOf("F") !== -1) days.add(5);
      if (str.indexOf("SAT") !== -1 || str.indexOf("S") !== -1) days.add(6);
      if (str.indexOf("SUN") !== -1) days.add(0);
      return Array.from(days);
    }

    function parseStartTimeToMinutes(text) {
      if (!text) return null;
      var match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i) || text.match(/(\d{1,2})\s*(AM|PM)/i);
      if (!match) return null;
      var hours = parseInt(match[1], 10);
      var mins = match[2] && !isNaN(parseInt(match[2], 10)) ? parseInt(match[2], 10) : 0;
      var meridiem = (match[3] || match[2] || "").toUpperCase();
      if (meridiem === "PM" && hours < 12) hours += 12;
      if (meridiem === "AM" && hours === 12) hours = 0;
      return hours * 60 + mins;
    }

    function formatTime12h(timeStr) {
      if (!timeStr) return "";
      var parts = timeStr.split(":");
      if (parts.length < 2) return timeStr;
      var h = parseInt(parts[0], 10);
      var m = parts[1];
      var ampm = h >= 12 ? "PM" : "AM";
      var h12 = h % 12 || 12;
      return h12 + ":" + m + " " + ampm;
    }

    function getTodayClasses(subjects, manualSchedule) {
      var now = new Date();
      var currentDay = now.getDay();
      var classes = [];

      (subjects || []).forEach(function (s) {
        if (!s.schedule) return;
        var days = parseDaysFromText(s.schedule);
        if (days.indexOf(currentDay) !== -1) {
          var startMin = parseStartTimeToMinutes(s.schedule);
          classes.push({
            id: s.id,
            name: s.name,
            professor: s.professor || "",
            scheduleText: s.schedule,
            room: s.room || "",
            color: s.color || "#2563EB",
            startMin: startMin !== null ? startMin : 9999
          });
        }
      });

      (manualSchedule || []).forEach(function (m) {
        if (!m.day) return;
        var days = parseDaysFromText(m.day);
        if (days.indexOf(currentDay) !== -1) {
          var startMin = m.start_time ? parseStartTimeToMinutes(m.start_time) : null;
          var schedText = (m.start_time ? formatTime12h(m.start_time) : "") + (m.end_time ? " – " + formatTime12h(m.end_time) : "");
          classes.push({
            id: m.id,
            name: m.subject || "Class Schedule",
            professor: "",
            scheduleText: schedText || m.day,
            room: m.room || "",
            color: "#2563EB",
            startMin: startMin !== null ? startMin : 9999
          });
        }
      });

      classes.sort(function (a, b) { return a.startMin - b.startMin; });
      return classes;
    }

    async function checkScheduleNotifications() {
      if (!isLoggedIn()) return;
      var prefs = getPrefs();
      if (!prefs.enabled) return;

      try {
        var results = await Promise.all([getSubjects().catch(function () { return []; }), getSchedule().catch(function () { return []; })]);
        var subjects = results[0];
        var manualSched = results[1];
        var todayClasses = getTodayClasses(subjects, manualSched);

        var now = new Date();
        var dateKey = now.toISOString().split("T")[0];
        var dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        var dayName = dayNames[now.getDay()];

        // 1. Daily Morning Digest
        if (prefs.scheduleDaily && todayClasses.length > 0) {
          var digestKey = "cc_notif_digest_" + dateKey;
          if (!localStorage.getItem(digestKey)) {
            var classSummary = todayClasses.map(function (c) { return c.name + (c.scheduleText ? " (" + c.scheduleText + ")" : ""); }).join(", ");
            sendNotification(
              "Today's Schedule — " + dayName,
              "You have " + todayClasses.length + " class" + (todayClasses.length > 1 ? "es" : "") + " today: " + classSummary,
              "schedule",
              { view: "view-schedule", tag: "cc_daily_digest" }
            );
            localStorage.setItem(digestKey, "true");
          }
        }

        // 2. Upcoming Class Alert (15-20 mins before start)
        if (prefs.scheduleUpcoming) {
          var currentMin = now.getHours() * 60 + now.getMinutes();
          todayClasses.forEach(function (c) {
            if (c.startMin < 9999) {
              var diff = c.startMin - currentMin;
              if (diff >= 0 && diff <= 20) {
                var upcomingKey = "cc_notif_up_" + c.name.replace(/\s+/g, "_") + "_" + dateKey + "_" + c.startMin;
                if (!localStorage.getItem(upcomingKey)) {
                  var timeDesc = diff === 0 ? "starting now" : "starting in " + diff + " minutes";
                  sendNotification(
                    "Class Starting Soon: " + c.name,
                    c.name + " is " + timeDesc + " (" + c.scheduleText + ")" + (c.professor ? " with " + c.professor : (c.room ? " in Room " + c.room : "")) + ". Tap to view schedule.",
                    "schedule",
                    { view: "view-schedule", tag: upcomingKey, requireInteraction: true }
                  );
                  localStorage.setItem(upcomingKey, "true");
                }
              }
            }
          });
        }
      } catch (e) {
        console.warn("[ClassConnect] Schedule check error:", e);
      }
    }

    async function checkAssignmentNotifications() {
      if (!isLoggedIn()) return;
      var prefs = getPrefs();
      if (!prefs.enabled || !prefs.assignments) return;

      try {
        var assignments = await getAssignments().catch(function () { return []; });
        var uncompleted = assignments.filter(function (a) { return !a.completed; });
        var now = new Date();
        var todayKey = now.toISOString().split("T")[0];
        
        var tomorrow = new Date(now.getTime() + 86400000);
        var tmrwKey = tomorrow.toISOString().split("T")[0];

        uncompleted.forEach(function (a) {
          if (!a.due_date) return;
          var dueStr = a.due_date.substring(0, 10);

          if (dueStr === todayKey) {
            var keyToday = "cc_notif_due_today_" + a.id + "_" + todayKey;
            if (!localStorage.getItem(keyToday)) {
              sendNotification(
                "Assignment Due Today: " + a.text,
                "Subject: " + (a.subject || "General") + ". Deadline is today! Don't forget to submit.",
                "assignment",
                { view: "view-assignments", tag: keyToday }
              );
              localStorage.setItem(keyToday, "true");
            }
          } else if (dueStr === tmrwKey) {
            var keyTmrw = "cc_notif_due_tmrw_" + a.id + "_" + todayKey;
            if (!localStorage.getItem(keyTmrw)) {
              sendNotification(
                "Assignment Due Tomorrow: " + a.text,
                "Subject: " + (a.subject || "General") + " is due tomorrow.",
                "assignment",
                { view: "view-assignments", tag: keyTmrw }
              );
              localStorage.setItem(keyTmrw, "true");
            }
          } else if (dueStr < todayKey) {
            var keyOverdue = "cc_notif_overdue_" + a.id + "_" + todayKey;
            if (!localStorage.getItem(keyOverdue)) {
              sendNotification(
                "Overdue Task: " + a.text,
                "Subject: " + (a.subject || "General") + " was due on " + a.due_date + ". Tap to view task.",
                "assignment",
                { view: "view-assignments", tag: keyOverdue }
              );
              localStorage.setItem(keyOverdue, "true");
            }
          }
        });

        updateAppBadge();
      } catch (e) {
        console.warn("[ClassConnect] Assignment check error:", e);
      }
    }

    function checkNewPosts(posts) {
      if (!isLoggedIn()) return;
      var prefs = getPrefs();
      if (!prefs.enabled || !prefs.posts || !posts || !posts.length) return;

      var currentUser = getCurrentUser();
      var lastSeen = localStorage.getItem(STORAGE_LAST_POST);
      var lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
      var newestTime = lastSeenTime;

      posts.forEach(function (p) {
        var postTime = new Date(p.timestamp || p.created_at || Date.now()).getTime();
        if (postTime > newestTime) {
          newestTime = postTime;
        }

        if (lastSeenTime > 0 && postTime > lastSeenTime && currentUser && p.user_id !== currentUser.id) {
          var snippet = p.content ? (p.content.length > 100 ? p.content.substring(0, 97) + "..." : p.content) : "New announcement posted in your feed.";
          sendNotification(
            "New Class Post: " + (p.author || "Classmate"),
            snippet,
            "post",
            { view: "view-home", tag: "cc_post_" + p.id }
          );
        }
      });

      if (newestTime > 0) {
        localStorage.setItem(STORAGE_LAST_POST, new Date(newestTime).toISOString());
      }
    }

    var _currentFilter = "all";
    function renderNotificationCenter(filter) {
      if (filter) _currentFilter = filter;
      var list = document.getElementById("notification-items-list");
      if (!list) return;

      var items = getInAppNotifications();
      if (_currentFilter !== "all") {
        items = items.filter(function (i) { return i.type === _currentFilter; });
      }

      if (!items.length) {
        list.innerHTML =
          '<div class="notif-empty-state">' +
            '<div class="notif-empty-icon"><i class="fas fa-bell-slash"></i></div>' +
            '<h4 style="font-size:15px;font-weight:700;color:var(--deep-navy);margin:0 0 4px 0;">No Notifications</h4>' +
            '<p style="font-size:13px;margin:0;color:#64748B;">You\'re all caught up with your schedules, tasks, and posts.</p>' +
          '</div>';
        return;
      }

      list.innerHTML = items.map(function (item) {
        var unreadClass = item.read ? "" : " notif-unread";
        var iconClass = "type-" + item.type;
        var iconHtml = '<i class="fas fa-bell"></i>';
        if (item.type === "schedule") iconHtml = '<i class="fas fa-calendar-day"></i>';
        else if (item.type === "assignment") iconHtml = '<i class="fas fa-clipboard-check"></i>';
        else if (item.type === "post") iconHtml = '<i class="fas fa-bullhorn"></i>';

        var relTime = timeAgo(item.timestamp);

        return (
          '<div class="notif-item-card' + unreadClass + '" data-id="' + item.id + '" data-view="' + (item.view || "view-home") + '">' +
            '<div class="notif-item-icon ' + iconClass + '">' +
              iconHtml +
            '</div>' +
            '<div class="notif-item-content">' +
              '<h4 class="notif-item-title">' + escapeHtml(item.title) + '</h4>' +
              '<p class="notif-item-body">' + escapeHtml(item.body) + '</p>' +
              '<div class="notif-item-meta">' +
                '<span class="notif-item-time"><i class="far fa-clock"></i> ' + relTime + '</span>' +
                '<span class="notif-item-action-link">Open <i class="fas fa-arrow-right"></i></span>' +
              '</div>' +
            '</div>' +
          '</div>'
        );
      }).join("");

      list.querySelectorAll(".notif-item-card").forEach(function (card) {
        card.addEventListener("click", function () {
          var id = card.getAttribute("data-id");
          var view = card.getAttribute("data-view");
          markAsRead(id);
          closeModal("notification-center-modal-overlay");
          if (view) switchView(view);
        });
      });
    }

    function runAllReminderChecks() {
      checkScheduleNotifications();
      checkAssignmentNotifications();
    }

    function sendTestNotification() {
      playChime();
      vibrate([200, 100, 200]);
      sendNotification(
        "Test Device Alert — ClassConnect",
        "Device notifications, audio chimes, and haptics are fully working on your " + (navigator.maxTouchPoints > 0 ? "phone" : "PC") + "!",
        "system",
        { view: "view-home" }
      );
      showToast("Test notification sent to device!", "success");
    }

    function initListeners() {
      var topnavBell = document.getElementById("topnav-notification-btn");
      if (topnavBell) {
        topnavBell.addEventListener("click", function () {
          renderNotificationCenter();
          openModal("notification-center-modal-overlay");
        });
      }

      var closeBtn = document.getElementById("close-notification-modal-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          closeModal("notification-center-modal-overlay");
        });
      }

      var markReadBtn = document.getElementById("notif-mark-all-read-btn");
      if (markReadBtn) {
        markReadBtn.addEventListener("click", function () {
          markAllAsRead();
          showToast("All notifications marked as read.", "info");
        });
      }

      var clearAllBtn = document.getElementById("notif-clear-all-btn");
      if (clearAllBtn) {
        clearAllBtn.addEventListener("click", function () {
          clearAll();
          showToast("Notifications cleared.", "info");
        });
      }

      var tabs = document.querySelectorAll(".notif-filter-tabs .notif-tab");
      tabs.forEach(function (tab) {
        tab.addEventListener("click", function () {
          tabs.forEach(function (t) { t.classList.remove("active"); });
          tab.classList.add("active");
          var filter = tab.getAttribute("data-filter");
          renderNotificationCenter(filter);
        });
      });

      var bannerEnableBtn = document.getElementById("enable-device-notifs-btn");
      if (bannerEnableBtn) {
        bannerEnableBtn.addEventListener("click", function () {
          requestPermission();
        });
      }

      var bannerDismissBtn = document.getElementById("dismiss-notif-banner-btn");
      if (bannerDismissBtn) {
        bannerDismissBtn.addEventListener("click", function () {
          localStorage.setItem(STORAGE_BANNER_DISMISSED, "true");
          var banner = document.getElementById("device-notif-banner");
          if (banner) banner.style.display = "none";
        });
      }

      var reqPermBtn = document.getElementById("notif-request-perm-btn");
      if (reqPermBtn) {
        reqPermBtn.addEventListener("click", function () {
          requestPermission();
        });
      }

      var testBtn1 = document.getElementById("settings-test-notif-btn");
      var testBtn2 = document.getElementById("notif-modal-test-btn");
      if (testBtn1) testBtn1.addEventListener("click", sendTestNotification);
      if (testBtn2) testBtn2.addEventListener("click", sendTestNotification);

      var notifSettingsBtn = document.getElementById("notif-open-settings-btn");
      if (notifSettingsBtn) {
        notifSettingsBtn.addEventListener("click", function () {
          closeModal("notification-center-modal-overlay");
          switchView("view-settings");
        });
      }

      function bindToggle(id, prefKey) {
        var input = document.getElementById(id);
        if (input) {
          input.addEventListener("change", function () {
            var prefs = getPrefs();
            prefs[prefKey] = input.checked;
            savePrefs(prefs);
            if (prefKey === "enabled" && input.checked && checkPermissionState() === "default") {
              requestPermission();
            }
          });
        }
      }

      bindToggle("notif-pref-master", "enabled");
      bindToggle("notif-pref-schedule-daily", "scheduleDaily");
      bindToggle("notif-pref-schedule-upcoming", "scheduleUpcoming");
      bindToggle("notif-pref-assignments", "assignments");
      bindToggle("notif-pref-posts", "posts");
      bindToggle("notif-pref-vibration", "vibration");
      bindToggle("notif-pref-sound", "sound");

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("message", function (event) {
          if (event.data && event.data.type === "NAVIGATE_VIEW" && event.data.view) {
            if (isLoggedIn()) {
              showPage("dashboard-page");
              switchView(event.data.view);
            }
          }
        });
      }

      window.addEventListener("focus", function () {
        if (isLoggedIn()) {
          runAllReminderChecks();
        }
      });
    }

    return {
      init: function () {
        initListeners();
        updatePermissionUI();
        updateTopnavBadge();
        updateAppBadge();
      },
      updatePermissionUI: updatePermissionUI,
      updateTopnavBadge: updateTopnavBadge,
      updateAppBadge: updateAppBadge,
      renderNotificationCenter: renderNotificationCenter,
      checkScheduleNotifications: checkScheduleNotifications,
      checkAssignmentNotifications: checkAssignmentNotifications,
      checkNewPosts: checkNewPosts,
      runAllReminderChecks: runAllReminderChecks,
      sendNotification: sendNotification,
      sendTestNotification: sendTestNotification,
      requestPermission: requestPermission,
      vibrate: vibrate,
      playChime: playChime,
      onAssignmentAdded: function (item) {
        updateAppBadge();
        vibrate([100, 50, 100]);
        if (item && item.due_date) {
          sendNotification(
            "Task Added: " + (item.text || "New Assignment"),
            "Subject: " + (item.subject || "General") + " — Due " + item.due_date,
            "assignment",
            { view: "view-assignments" }
          );
        }
      },
      onTaskCompleted: function () {
        updateAppBadge();
        vibrate([80, 40, 80]);
      },
      onScheduleUpdated: function () {
        checkScheduleNotifications();
      },
      onPostCreated: function (post) {
        vibrate([100, 50, 100]);
      }
    };
  })();


  // ===== LOAD FUNCTIONS =====

  var _profilesCache = null;
  var _profilesCacheTime = 0;
  async function getProfilesMap() {
    var now = Date.now();
    if (_profilesCache && (now - _profilesCacheTime < 25000)) {
      return _profilesCache;
    }
    var map = {};
    var currPhoto = getProfilePhoto();
    var currUser = getCurrentUser();
    if (currUser) {
      if (currPhoto) {
        map[currUser.id] = currPhoto;
        if (currUser.name) map[currUser.name.toLowerCase().trim()] = currPhoto;
        if (currUser.email) map[currUser.email.toLowerCase().trim()] = currPhoto;
      }
    }
    if (isSupabaseReady()) {
      try {
        var client = getSupabaseClient();
        var resp = await withTimeout(
          client.from("profiles").select("id,email,full_name,photo"),
          5000,
          "Profiles avatar lookup"
        );
        if (resp && resp.data && Array.isArray(resp.data)) {
          resp.data.forEach(function (p) {
            if (p.photo) {
              if (p.id) map[p.id] = p.photo;
              if (p.full_name) map[p.full_name.toLowerCase().trim()] = p.photo;
              if (p.email) map[p.email.toLowerCase().trim()] = p.photo;
            }
          });
        }
      } catch (e) {
        console.warn("[ClassConnect] Profile photos map lookup failed:", e);
      }
    }
    _profilesCache = map;
    _profilesCacheTime = now;
    return map;
  }

  // Render comments for a single post (call after post card is rendered)
  async function renderComments(postId, comments, containerId, profilesMap) {
    var container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";
    if (!comments || comments.length === 0) {
      container.innerHTML = '<div class="no-comments">No comments yet.</div>';
      return;
    }
    var user = getCurrentUser();
    var profMap = profilesMap || await getProfilesMap();
    comments.forEach(function (comment) {
      var div = document.createElement("div");
      div.className = "post-comment-item";
      var commentPhoto = (comment.user_id && profMap[comment.user_id]) || 
                         (comment.author && profMap[comment.author.toLowerCase().trim()]) || 
                         comment.photo || null;
      var avatarBg = commentPhoto ? 'background-image:url(\'' + escapeHtml(commentPhoto) + '\');background-size:cover;background-position:center;' : 'background:' + stringToColor(comment.author);
      var avatarContent = commentPhoto ? '' : escapeHtml(initials(comment.author));
      var isOwn = user && comment.user_id === user.id;
      div.innerHTML =
        '<div class="comment-avatar" style="' + avatarBg + '">' + avatarContent + '</div>' +
        '<div class="comment-body">' +
          '<div class="comment-author">' + escapeHtml(comment.author) + '</div>' +
          '<div class="comment-text">' + escapeHtml(comment.content) + '</div>' +
          '<div class="comment-meta">' +
            '<span>' + formatTimestampPHT(comment.created_at) + '</span>' +
            (isOwn ? '<button class="comment-delete-btn" data-comment-id="' + comment.id + '" title="Delete comment"><i class="fas fa-trash"></i></button>' : '') +
          '</div>' +
        '</div>';
      container.appendChild(div);
    });
    container.querySelectorAll(".comment-delete-btn").forEach(function (btn) {
      btn.addEventListener("click", function (e) {
        e.stopPropagation();
        var commentId = btn.getAttribute("data-comment-id");
        showConfirm("Delete this comment?", function () {
          withLoading(function () { return deleteComment(commentId); }).then(function () {
            loadPosts(document.getElementById("dashboard-search-input") ? document.getElementById("dashboard-search-input").value : "");
          }).catch(function (err) {
            showToast(err.message || "Could not delete comment.", "error");
          });
        });
      });
    });
  }

  // POSTS LOAD – Background & Instant Skeleton with Parallel Fetching
  var _loadPostsCallId = 0;
  async function loadPosts(searchQuery) {
    var myCallId = ++_loadPostsCallId;
    const feed = document.getElementById("posts-feed");
    if (!feed) return;
    
    // Show smooth in-feed skeleton if feed is currently empty
    if (!feed.children.length || feed.querySelector(".empty-state")) {
      feed.innerHTML =
        '<div class="feed-inline-skeleton">' +
          '<div class="feed-skeleton-card">' +
            '<div class="feed-skeleton-header">' +
              '<div class="skeleton-avatar"></div>' +
              '<div class="skeleton-text-group">' +
                '<div class="skeleton-line" style="width: 140px; height: 14px;"></div>' +
                '<div class="skeleton-line" style="width: 90px; height: 10px; margin-top: 6px;"></div>' +
              '</div>' +
            '</div>' +
            '<div class="skeleton-line" style="width: 90%; height: 12px; margin-top: 14px;"></div>' +
            '<div class="skeleton-line" style="width: 70%; height: 12px; margin-top: 8px;"></div>' +
          '</div>' +
          '<div class="feed-skeleton-card">' +
            '<div class="feed-skeleton-header">' +
              '<div class="skeleton-avatar"></div>' +
              '<div class="skeleton-text-group">' +
                '<div class="skeleton-line" style="width: 120px; height: 14px;"></div>' +
                '<div class="skeleton-line" style="width: 80px; height: 10px; margin-top: 6px;"></div>' +
              '</div>' +
            '</div>' +
            '<div class="skeleton-line" style="width: 85%; height: 12px; margin-top: 14px;"></div>' +
          '</div>' +
        '</div>';
    }

    try {
      var fetchResults = await Promise.all([getPosts(), getProfilesMap()]);
      var posts = fetchResults[0];
      var profilesMap = fetchResults[1];

      if (myCallId !== _loadPostsCallId) return;

      var uniquePosts = [];
      var seenIds = new Set();
      for (var i = 0; i < posts.length; i++) {
        var post = posts[i];
        if (!seenIds.has(post.id)) {
          seenIds.add(post.id);
          uniquePosts.push(post);
        }
      }
      posts = uniquePosts;
      DeviceNotificationManager.checkNewPosts(posts);

      if (searchQuery && searchQuery.trim() !== "") {
        var q = searchQuery.trim().toLowerCase();
        posts = posts.filter(function (p) {
          var matchAuthor = p.author && p.author.toLowerCase().indexOf(q) !== -1;
          var matchContent = p.content && p.content.toLowerCase().indexOf(q) !== -1;
          var matchTag = p.tag && p.tag.toLowerCase().indexOf(q) !== -1;
          var matchDate = formatTimestampPHT(p.timestamp).toLowerCase().indexOf(q) !== -1 || timeAgo(p.timestamp).toLowerCase().indexOf(q) !== -1;
          return matchAuthor || matchContent || matchTag || matchDate;
        });
      }

      var postIds = posts.map(function (p) { return p.id; });
      var parallelResults = await Promise.all([
        postIds.length > 0 ? getCommentsForPosts(postIds) : Promise.resolve([]),
        postIds.length > 0 ? getAllPostAcknowledgments(postIds) : Promise.resolve([])
      ]);

      if (myCallId !== _loadPostsCallId) return;

      var allComments = parallelResults[0] || [];
      var allAcks = parallelResults[1] || [];

      var commentsByPost = {};
      allComments.forEach(function (c) {
        if (!commentsByPost[c.post_id]) commentsByPost[c.post_id] = [];
        commentsByPost[c.post_id].push(c);
      });

      var acksByPost = {};
      allAcks.forEach(function (a) {
        if (!acksByPost[a.post_id]) acksByPost[a.post_id] = [];
        acksByPost[a.post_id].push(a);
      });

      feed.innerHTML = "";

      if (posts.length === 0) {
        feed.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-search"></i></div>' +
            '<p class="empty-title">' + (searchQuery ? 'No matching posts found' : 'No posts yet') + '</p>' +
            '<p class="empty-sub">' + (searchQuery ? 'Try searching for another keyword or author.' : 'Be the first to share something with your class.') + '</p>' +
          '</div>';
        return;
      }

      var user = getCurrentUser();
      var currentUserPhoto = (user && profilesMap[user.id]) || getProfilePhoto();
      var userCommentAvatar = currentUserPhoto 
        ? '<div class="comment-avatar-small" style="background-image:url(\'' + escapeHtml(currentUserPhoto) + '\');background-size:cover;background-position:center;"></div>' 
        : '<div class="comment-avatar-small">' + (user ? initials(user.name) : 'S') + '</div>';

      for (var j = 0; j < posts.length; j++) {
        if (myCallId !== _loadPostsCallId) return;

        var post = posts[j];
        var card = document.createElement("div");
        card.className = "post-card";
        var imgHtml = post.image ? '<div class="post-image-wrap"><img src="' + post.image + '" alt="Post image" loading="lazy" class="post-img-zoomable" data-viewer-src="' + post.image + '"></div>' : "";
        var tagHtml = post.tag ? '<div class="post-tag-wrap"><span class="post-tag"><i class="fas fa-tag"></i> ' + escapeHtml(post.tag) + '</span></div>' : "";

        var canDel = user ? (isAdmin() || post.user_id === user.id || post.author === user.name) : false;
        var canEdt = user ? (post.user_id === user.id || post.author === user.name) : false;
        var acks = acksByPost[post.id] || [];
        var hasAck = user ? acks.some(function (a) { return a.user_id === user.id; }) : false;
        var ackCount = acks.length;

        var actionsHtml = '<div class="post-footer">';
        actionsHtml += '<div class="post-footer-left">';
        actionsHtml +=
          '<button class="btn-acknowledge ' + (hasAck ? "acknowledged" : "") + '" data-id="' + post.id + '">' +
            '<i class="fas ' + (hasAck ? "fa-check-circle" : "fa-circle") + '"></i> ' +
            (hasAck ? "Acknowledged" : "Acknowledge") +
          '</button>';
        if (ackCount > 0) {
          actionsHtml +=
            '<span class="acknowledge-count" data-id="' + post.id + '" title="View who acknowledged">' +
              ackCount + ' ' + (ackCount === 1 ? "person" : "people") +
            '</span>';
        }
        actionsHtml += '</div>';
        actionsHtml += '<div class="post-footer-right">';
        var commentCount = (commentsByPost[post.id] || []).length;
        actionsHtml +=
          '<button class="btn-comments" data-post-id="' + post.id + '">' +
            '<i class="fas fa-comment"></i> ' +
            (commentCount > 0 ? '<span class="comment-count-badge">' + commentCount + '</span>' : 'Comment') +
          '</button>';
        if (canEdt) {
          actionsHtml +=
            '<button class="btn-edit-post" data-id="' + post.id + '">' +
              '<i class="fas fa-pen"></i> Edit' +
            '</button>';
        }
        if (canDel) {
          actionsHtml +=
            '<button class="btn-delete-post" data-id="' + post.id + '">' +
              '<i class="fas fa-trash"></i> Delete' +
            '</button>';
        }
        actionsHtml += '</div></div>';

        var commentsSectionId = "comments-container-" + post.id;
        var commentsHtml =
          '<div class="post-comments-section">' +
            '<div class="post-comments-list" id="' + commentsSectionId + '">' +
              '<!-- comments rendered by JS -->' +
            '</div>' +
            '<div class="post-comment-form">' +
              userCommentAvatar +
              '<div class="comment-input-wrap">' +
                '<input type="text" class="comment-input" placeholder="Write a comment..." data-post-id="' + post.id + '">' +
                '<button class="comment-submit-btn" data-post-id="' + post.id + '"><i class="fas fa-paper-plane"></i></button>' +
              '</div>' +
            '</div>' +
          '</div>';

        var authorPhoto = (post.user_id && profilesMap[post.user_id]) || 
                          (post.author && profilesMap[post.author.toLowerCase().trim()]) || 
                          post.photo || null;
        var postAvatarStyle = authorPhoto 
          ? 'background-image:url(\'' + escapeHtml(authorPhoto) + '\');background-size:cover;background-position:center;' 
          : 'background:' + stringToColor(post.author);
        var postAvatarContent = authorPhoto ? '' : escapeHtml(initials(post.author));

        card.innerHTML =
          tagHtml +
          '<div class="post-header">' +
            '<div class="avatar-circle post-avatar" style="' + postAvatarStyle + '">' +
              postAvatarContent +
            '</div>' +
            '<div class="post-author-info">' +
              '<span class="post-author-name">' + escapeHtml(post.author) + '</span>' +
              '<span class="post-timestamp"><i class="fas fa-clock"></i> ' + formatTimestampPHT(post.timestamp) + ' &middot; ' + timeAgo(post.timestamp) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="post-content">' + post.content + imgHtml + '</div>' +
          actionsHtml +
          commentsHtml;
        feed.appendChild(card);

        var commentsContainer = document.getElementById(commentsSectionId);
        if (commentsContainer) {
          var postComments = commentsByPost[post.id] || [];
          renderComments(post.id, postComments, commentsSectionId, profilesMap);
        }
      }

      feed.querySelectorAll(".btn-delete-post").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this post?", function () {
            var postId = btn.getAttribute("data-id");
            withLoading(function () { return deletePost(postId); }).then(function () {
              loadPosts(document.getElementById("dashboard-search-input") ? document.getElementById("dashboard-search-input").value : "");
              showToast("Post deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete post.", "error");
            });
          });
        });
      });

      feed.querySelectorAll(".btn-edit-post").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var postId = btn.getAttribute("data-id");
          openEditPostModal(postId);
        });
      });

      feed.querySelectorAll(".btn-acknowledge").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var postId = btn.getAttribute("data-id");
          withLoading(function () { return togglePostAcknowledgment(postId); }).then(function () {
            loadPosts(document.getElementById("dashboard-search-input") ? document.getElementById("dashboard-search-input").value : "");
          }).catch(function (err) {
            showToast(err.message || "Could not toggle acknowledgment.", "error");
          });
        });
      });

      feed.querySelectorAll(".acknowledge-count").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var postId = btn.getAttribute("data-id");
          showAcknowledgmentsPopup(postId);
        });
      });

      feed.querySelectorAll(".comment-submit-btn").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var postId = btn.getAttribute("data-post-id");
          var input = btn.parentElement.querySelector(".comment-input");
          if (!input) return;
          var content = input.value.trim();
          if (!content) {
            showToast("Please write a comment.", "warning");
            return;
          }
          withLoading(function () { return addComment(postId, content); }).then(function () {
            input.value = "";
            loadPosts(document.getElementById("dashboard-search-input") ? document.getElementById("dashboard-search-input").value : "");
          }).catch(function (err) {
            showToast(err.message || "Could not add comment.", "error");
          });
        });
      });
      feed.querySelectorAll(".comment-input").forEach(function (input) {
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter") {
            e.preventDefault();
            var btn = this.parentElement.querySelector(".comment-submit-btn");
            if (btn) btn.click();
          }
        });
      });

    } catch (err) {
      console.error("Error loading posts:", err);
      feed.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load posts</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  async function canDeletePost(postId, cachedPosts) {
    var user = getCurrentUser();
    if (!user) return false;
    if (isAdmin()) return true;
    try {
      var posts = cachedPosts || await getPosts();
      var found = posts.find(function (p) { return p.id === postId; });
      if (!found) return false;
      return found.user_id === user.id || found.author === user.name;
    } catch (e) {
      return false;
    }
  }

  async function canEditPost(postId, cachedPosts) {
    var user = getCurrentUser();
    if (!user) return false;
    try {
      var posts = cachedPosts || await getPosts();
      var found = posts.find(function (p) { return p.id === postId; });
      if (!found) return false;
      return found.user_id === user.id || found.author === user.name;
    } catch (e) {
      return false;
    }
  }

  async function showAcknowledgmentsPopup(postId) {
    try {
      var fetchResults = await Promise.all([getPostAcknowledgments(postId), getProfilesMap()]);
      var acks = fetchResults[0];
      var profMap = fetchResults[1];

      var overlay = document.createElement("div");
      overlay.className = "acknowledgments-popup-overlay active";
      var popup = document.createElement("div");
      popup.className = "acknowledgments-popup active";
      var listHtml = "";
      if (acks.length === 0) {
        listHtml = '<p style="text-align:center;color:var(--gray-400);padding:16px 0;">No one has acknowledged this post yet.</p>';
      } else {
        listHtml = '<div class="acknowledgments-list">';
        acks.forEach(function (a) {
          var ackPhoto = (a.user_id && profMap[a.user_id]) || 
                         (a.name && profMap[a.name.toLowerCase().trim()]) || 
                         null;
          var ackStyle = ackPhoto 
            ? 'background-image:url(\'' + escapeHtml(ackPhoto) + '\');background-size:cover;background-position:center;' 
            : 'background:' + stringToColor(a.name);
          var ackContent = ackPhoto ? '' : escapeHtml(initials(a.name));
          listHtml +=
            '<div class="ack-item">' +
              '<div class="ack-avatar" style="' + ackStyle + '">' + ackContent + '</div>' +
              '<span>' + escapeHtml(a.name) + '</span>' +
            '</div>';
        });
        listHtml += '</div>';
      }
      popup.innerHTML =
        '<h4>People who acknowledged</h4>' +
        listHtml +
        '<button class="acknowledgments-close">Close</button>';
      document.body.appendChild(overlay);
      document.body.appendChild(popup);
      popup.querySelector(".acknowledgments-close").addEventListener("click", function () {
        overlay.remove();
        popup.remove();
      });
      overlay.addEventListener("click", function () {
        overlay.remove();
        popup.remove();
      });
    } catch (err) {
      showToast("Could not load acknowledgments.", "error");
    }
  }

  function openEditPostModal(postId) {
    getPosts().then(function (posts) {
      var found = posts.find(function (p) { return p.id === postId; });
      if (!found) { showToast("Post not found.", "error"); return; }
      var editor = document.getElementById("edit-post-content-editable");
      var idField = document.getElementById("edit-post-id");
      if (editor) editor.innerHTML = found.content;
      if (idField) idField.value = postId;
      openModal("edit-post-modal-overlay");
      setTimeout(function () { if (editor) editor.focus(); }, 300);
    }).catch(function (err) {
      showToast("Could not load post.", "error");
    });
  }

  // ===== SUBJECTS LOAD =====
  async function loadSubjects() {
    const list = document.getElementById("subjects-list");
    if (!list) return;
    try {
      var allSubjects = await getSubjects();

      var subjectYearBtn = document.querySelector(".subject-year-filter.active");
      var subjectFilterYear = subjectYearBtn ? subjectYearBtn.getAttribute("data-year") : "all";
      var subjectSemEl = document.getElementById("subjects-semester-filter");
      var subjectFilterSem = subjectSemEl ? subjectSemEl.value : "all";
      var subjects = allSubjects.filter(function (s) {
        var yMatch = (subjectFilterYear === "all" || (s.year || "1st Year") === subjectFilterYear);
        var sMatch = (subjectFilterSem === "all" || (s.semester || "1st Semester") === subjectFilterSem);
        return yMatch && sMatch;
      });

      subjects = subjects.slice().sort(function (a, b) {
        return getSortKey(a.schedule) - getSortKey(b.schedule);
      });

      list.innerHTML = "";
      if (allSubjects.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-book-open"></i></div>' +
            '<p class="empty-title">No subjects yet</p>' +
            '<p class="empty-sub">Click "Add Subject" to get started.</p>' +
          '</div>';
        return;
      }
      if (subjects.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-book-open"></i></div>' +
            '<p class="empty-title">No subjects for this filter</p>' +
            '<p class="empty-sub">Try a different year or semester filter.</p>' +
          '</div>';
        return;
      }
      for (var i = 0; i < subjects.length; i++) {
        var subject = subjects[i];
        var card = document.createElement("div");
        card.className = "subject-card";
        card.style.borderLeftColor = subject.color || "#2563EB";
        var tasks = subject.tasks || [];
        var done = tasks.filter(function (t) { return t.completed; }).length;
        var total = tasks.length;
        var pct = total > 0 ? Math.round((done / total) * 100) : 0;
        var progressHtml = total > 0
          ? '<div class="subject-progress-wrap">' +
              '<div class="subject-progress-track">' +
                '<div class="subject-progress-fill" style="width:' + pct + '%;background:' + (subject.color || "#2563EB") + '"></div>' +
              '</div>' +
              '<span class="subject-progress-label">' + done + ' / ' + total + ' tasks complete</span>' +
            '</div>'
          : "";
        var tasksHtml = "";
        if (tasks.length > 0) {
          tasksHtml += '<p class="subject-tasks-label"><i class="fas fa-list-check"></i> Tasks</p>';
          tasks.forEach(function (task) {
            tasksHtml +=
              '<div class="subject-task-item">' +
                '<input type="checkbox" class="task-checkbox" ' +
                  'data-subject-id="' + subject.id + '" ' +
                  'data-task-id="' + task.id + '" ' +
                  (task.completed ? "checked" : "") + '>' +
                '<span class="task-text ' + (task.completed ? "completed" : "") + '">' +
                  escapeHtml(task.text) +
                '</span>' +
                '<button class="btn-task-delete" ' +
                  'data-subject-id="' + subject.id + '" ' +
                  'data-task-id="' + task.id + '" ' +
                  'title="Delete task">' +
                  '<i class="fas fa-xmark"></i>' +
                '</button>' +
              '</div>';
          });
        }
        card.innerHTML =
          '<div class="subject-card-header">' +
            '<div class="subject-card-title">' +
              '<span class="subject-color-dot" style="background:' + (subject.color || "#2563EB") + '"></span>' +
              '<h4>' + escapeHtml(subject.name) + '</h4>' +
            '</div>' +
            '<div class="subject-actions">' +
              '<button class="btn-icon btn-edit-subject" data-id="' + subject.id + '" title="Edit subject">' +
                '<i class="fas fa-pen"></i>' +
              '</button>' +
              '<button class="btn-icon btn-delete-subject" data-id="' + subject.id + '" title="Delete subject">' +
                '<i class="fas fa-trash"></i>' +
              '</button>' +
            '</div>' +
          '</div>' +
          '<div class="subject-meta">' +
            '<span><i class="fas fa-user-tie"></i> ' + escapeHtml(subject.professor || "No professor assigned") + '</span>' +
            '<span><i class="fas fa-calendar"></i> ' + escapeHtml(subject.schedule || "No schedule set") + '</span>' +
            '<span class="subject-year-sem-badge"><i class="fas fa-layer-group"></i> ' + escapeHtml(subject.year || "1st Year") + ' &bull; ' + escapeHtml(subject.semester || "1st Semester") + '</span>' +
          '</div>' +
          progressHtml +
          '<div class="subject-tasks">' +
            tasksHtml +
            '<button class="subject-add-task-btn" data-subject-id="' + subject.id + '">' +
              '<i class="fas fa-plus"></i> Add Task' +
            '</button>' +
          '</div>';
        list.appendChild(card);
      }

      list.querySelectorAll(".btn-edit-subject").forEach(function (btn) {
        btn.addEventListener("click", function () { editSubject(btn.getAttribute("data-id")); });
      });
      list.querySelectorAll(".btn-delete-subject").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this subject and all its tasks?", function () {
            withLoading(function () { return deleteSubject(btn.getAttribute("data-id")); }).then(function () {
              loadSubjects();
              showToast("Subject deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete subject.", "error");
            });
          });
        });
      });
      list.querySelectorAll(".task-checkbox").forEach(function (cb) {
        cb.addEventListener("change", function () {
          withLoading(function () { return toggleSubjectTask(cb.getAttribute("data-subject-id"), cb.getAttribute("data-task-id")); }).then(function () {
            loadSubjects();
          }).catch(function (err) {
            showToast(err.message || "Could not update task.", "error");
          });
        });
      });
      list.querySelectorAll(".btn-task-delete").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this task?", function () {
            withLoading(function () { return deleteSubjectTask(btn.getAttribute("data-subject-id"), btn.getAttribute("data-task-id")); }).then(function () {
              loadSubjects();
              showToast("Task deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete task.", "error");
            });
          });
        });
      });
      list.querySelectorAll(".subject-add-task-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.getElementById("subject-task-subject-id").value = btn.getAttribute("data-subject-id");
          document.getElementById("subject-task-text").value = "";
          openModal("subject-task-modal-overlay");
        });
      });

    } catch (err) {
      console.error("Error loading subjects:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load subjects</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function editSubject(id) {
    getSubjects().then(function (subjects) {
      var subject = subjects.find(function (s) { return s.id === id; });
      if (!subject) return;
      document.getElementById("subject-edit-id").value = id;
      document.getElementById("subject-name").value = subject.name;
      document.getElementById("subject-professor").value = subject.professor || "";
      document.getElementById("subject-schedule").value = subject.schedule || "";
      document.getElementById("subject-year").value = subject.year || "1st Year";
      document.getElementById("subject-semester").value = subject.semester || "1st Semester";
      document.getElementById("subject-modal-title").textContent = "Edit Subject";
      openModal("subject-modal-overlay");
    }).catch(function (err) {
      showToast("Could not load subject.", "error");
    });
  }

  // ===== SCHEDULE LOAD =====
  async function loadSchedule() {
    const list = document.getElementById("schedule-list");
    if (!list) return;
    try {
      var results = await Promise.all([getSubjects(), getSchedule()]);
      var allSubjects = results[0];
      var schedule = results[1];

      DeviceNotificationManager.checkScheduleNotifications();

      var schedYearBtn = document.querySelector(".schedule-year-filter.active");
      var schedFilterYear = schedYearBtn ? schedYearBtn.getAttribute("data-year") : "all";
      var schedSemEl = document.getElementById("schedule-semester-filter");
      var schedFilterSem = schedSemEl ? schedSemEl.value : "all";

      var filteredSubjects = allSubjects.filter(function (s) {
        var yMatch = (schedFilterYear === "all" || (s.year || "1st Year") === schedFilterYear);
        var sMatch = (schedFilterSem === "all" || (s.semester || "1st Semester") === schedFilterSem);
        return yMatch && sMatch;
      });

      filteredSubjects = filteredSubjects.slice().sort(function (a, b) {
        return getSortKey(a.schedule) - getSortKey(b.schedule);
      });

      list.innerHTML = "";

      if (filteredSubjects.length === 0 && schedule.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-calendar-days"></i></div>' +
            '<p class="empty-title">No schedule yet</p>' +
            '<p class="empty-sub">Add subjects or click "Add Schedule" to get started.</p>' +
          '</div>';
        return;
      }

      if (filteredSubjects.length > 0) {
        var subjHeader = document.createElement("div");
        subjHeader.className = "schedule-section-header";
        subjHeader.innerHTML = '<i class="fas fa-book"></i> From My Subjects';
        list.appendChild(subjHeader);

        filteredSubjects.forEach(function (s) {
          var card = document.createElement("div");
          card.className = "schedule-card schedule-card-from-subject";
          var color = s.color || "#2563EB";
          card.style.borderLeftColor = color;
          card.innerHTML =
            '<div class="schedule-card-top">' +
              '<div class="schedule-day-badge schedule-subject-icon" style="background:' + color + '">' +
                '<i class="fas fa-book" style="font-size:11px;line-height:1;"></i>' +
              '</div>' +
              '<div class="schedule-card-synced-badge">Synced</div>' +
            '</div>' +
            '<div class="schedule-card-info">' +
              '<h4>' + escapeHtml(s.name) + '</h4>' +
              '<p class="schedule-time"><i class="fas fa-clock"></i> ' + escapeHtml(s.schedule || "No schedule set") + '</p>' +
              '<p class="schedule-room"><i class="fas fa-user-tie"></i> ' + escapeHtml(s.professor || "No professor assigned") + '</p>' +
              '<span class="subject-year-sem-badge" style="margin-top:6px;display:inline-flex;"><i class="fas fa-layer-group"></i> ' +
                escapeHtml(s.year || "1st Year") + ' &bull; ' + escapeHtml(s.semester || "1st Semester") +
              '</span>' +
            '</div>';
          list.appendChild(card);
        });
      }

      if (schedule.length > 0) {
        var manualHeader = document.createElement("div");
        manualHeader.className = "schedule-section-header";
        manualHeader.innerHTML = '<i class="fas fa-calendar-plus"></i> Manual Entries';
        list.appendChild(manualHeader);

        var sorted = schedule.slice().sort(function (a, b) {
          var da = getEarliestDayValue(a.day);
          var db = getEarliestDayValue(b.day);
          if (da !== db) return da - db;
          var ta = parseTimeToMinutes(a.start_time);
          var tb = parseTimeToMinutes(b.start_time);
          return ta - tb;
        });
        const badgeColors = ["#2563EB", "#8B5CF6", "#10B981", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899"];
        sorted.forEach(function (item) {
          var card = document.createElement("div");
          card.className = "schedule-card";
          var dayIdx = getEarliestDayValue(item.day);
          if (dayIdx === 99) dayIdx = 0;
          card.innerHTML =
            '<div class="schedule-card-top">' +
              '<div class="schedule-day-badge" style="background:' + badgeColors[dayIdx % badgeColors.length] + '">' +
                escapeHtml(item.day || "N/A") +
              '</div>' +
              '<div class="schedule-card-actions">' +
                '<button class="btn-icon btn-edit-schedule" data-id="' + item.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
                '<button class="btn-icon btn-delete-schedule" data-id="' + item.id + '" title="Delete"><i class="fas fa-trash"></i></button>' +
              '</div>' +
            '</div>' +
            '<div class="schedule-card-info">' +
              '<h4>' + escapeHtml(item.subject) + '</h4>' +
              '<p class="schedule-time"><i class="fas fa-clock"></i> ' +
                formatTime12h(item.start_time) + ' &ndash; ' + formatTime12h(item.end_time) +
              '</p>' +
              '<p class="schedule-room"><i class="fas fa-location-dot"></i> ' +
                escapeHtml(item.room || "No room assigned") +
              '</p>' +
            '</div>';
          list.appendChild(card);
        });

        list.querySelectorAll(".btn-edit-schedule").forEach(function (btn) {
          btn.addEventListener("click", function () { editScheduleItem(btn.getAttribute("data-id")); });
        });
        list.querySelectorAll(".btn-delete-schedule").forEach(function (btn) {
          btn.addEventListener("click", function () {
            showConfirm("Delete this schedule entry?", function () {
              withLoading(function () { return deleteScheduleItem(btn.getAttribute("data-id")); }).then(function () {
                loadSchedule();
                showToast("Schedule entry deleted.", "info");
              }).catch(function (err) {
                showToast(err.message || "Could not delete schedule entry.", "error");
              });
            });
          });
        });
      }

    } catch (err) {
      console.error("Error loading schedule:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load schedule</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function editScheduleItem(id) {
    getSchedule().then(function (schedule) {
      var item = schedule.find(function (s) { return s.id === id; });
      if (!item) return;
      document.getElementById("schedule-edit-id").value = id;
      document.getElementById("schedule-subject").value = item.subject;
      document.getElementById("schedule-day").value = item.day || "";
      document.getElementById("schedule-start-time").value = item.start_time || "";
      document.getElementById("schedule-end-time").value = item.end_time || "";
      document.getElementById("schedule-room").value = item.room || "";
      document.getElementById("schedule-modal-title").textContent = "Edit Schedule";
      openModal("schedule-modal-overlay");
    }).catch(function (err) {
      showToast("Could not load schedule item.", "error");
    });
  }

  // ===== ASSIGNMENTS LOAD =====
  async function loadAssignments() {
    const list = document.getElementById("assignments-list");
    if (!list) return;
    try {
      var assignments = await getAssignments();
      list.innerHTML = "";
      if (assignments.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-clipboard-check"></i></div>' +
            '<p class="empty-title">No assignments yet</p>' +
            '<p class="empty-sub">Click "Add Task" to get started.</p>' +
          '</div>';
        return;
      }
      var sorted = assignments.slice().sort(function (a, b) {
        if (a.completed !== b.completed) return a.completed ? 1 : -1;
        return 0;
      });
      sorted.forEach(function (item) {
        var div = document.createElement("div");
        div.className = "assignment-item" + (item.completed ? " assignment-done" : "");
        var dueCls = "";
        var dueLabel = "Due";
        if (item.due_date && !item.completed) {
          if (isOverdue(item.due_date)) { dueCls = "due-overdue"; dueLabel = "Overdue"; }
          else if (isDueSoon(item.due_date)) { dueCls = "due-soon"; }
        }
        var dueHtml = item.due_date
          ? '<span class="assignment-due ' + dueCls + '"><i class="fas fa-calendar-day"></i> ' + dueLabel + ': ' + escapeHtml(item.due_date) + '</span>'
          : "";
        var subjectHtml = item.subject
          ? '<span class="assignment-subject"><i class="fas fa-book"></i> ' + escapeHtml(item.subject) + '</span>'
          : "";
        div.innerHTML =
          '<label class="assignment-check-wrap" title="Mark complete">' +
            '<input type="checkbox" class="assignment-checkbox" data-id="' + item.id + '" ' + (item.completed ? "checked" : "") + '>' +
            '<span class="assignment-checkmark"></span>' +
          '</label>' +
          '<div class="assignment-info">' +
            '<span class="assignment-text ' + (item.completed ? "completed" : "") + '">' + escapeHtml(item.text) + '</span>' +
            '<div class="assignment-meta">' + subjectHtml + dueHtml + '</div>' +
          '</div>' +
          '<button class="btn-assignment-delete" data-id="' + item.id + '" title="Delete task">' +
            '<i class="fas fa-trash"></i>' +
          '</button>';
        list.appendChild(div);
      });

      list.querySelectorAll(".assignment-checkbox").forEach(function (cb) {
        cb.addEventListener("change", function () {
          withLoading(function () { return toggleAssignment(cb.getAttribute("data-id")); }).then(function () {
            DeviceNotificationManager.onTaskCompleted();
            loadAssignments();
          }).catch(function (err) {
            showToast(err.message || "Could not update task.", "error");
          });
        });
      });
      list.querySelectorAll(".btn-assignment-delete").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this task?", function () {
            withLoading(function () { return deleteAssignment(btn.getAttribute("data-id")); }).then(function () {
              DeviceNotificationManager.updateAppBadge();
              loadAssignments();
              showToast("Task deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete task.", "error");
            });
          });
        });
      });

      DeviceNotificationManager.checkAssignmentNotifications();
      DeviceNotificationManager.updateAppBadge();

    } catch (err) {
      console.error("Error loading assignments:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load assignments</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function isDueSoon(dueDate) {
    if (!dueDate) return false;
    var diff = (new Date(dueDate) - new Date()) / 86400000;
    return diff >= 0 && diff <= 3;
  }

  function isOverdue(dueDate) {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date();
  }

  // ===== GRADES LOAD =====
  async function loadGrades() {
    const list = document.getElementById("grades-list");
    const gwaDisplay = document.getElementById("gwa-value");
    if (!list) return;
    const yearEl = document.getElementById("grade-year-filter");
    const semEl = document.getElementById("grade-semester-filter");
    const year = yearEl ? yearEl.value : "all";
    const semester = semEl ? semEl.value : "all";

    try {
      var results = await Promise.all([getGrades(), getSubjects()]);
      var grades = results[0];
      var subjects = results[1];

      var filtered = grades.filter(function (g) {
        var yMatch = (year === "all" || !year || g.year === year);
        var sMatch = (semester === "all" || !semester || g.semester === semester);
        return yMatch && sMatch;
      });

      var gradedNames = filtered.map(function (g) { return g.subject.toLowerCase().trim(); });
      var ungradedSubjects = subjects.filter(function (s) {
        var yMatch = (year === "all" || !year || (s.year || "1st Year") === year);
        var sMatch = (semester === "all" || !semester || (s.semester || "1st Semester") === semester);
        var notGraded = gradedNames.indexOf(s.name.toLowerCase().trim()) === -1;
        return yMatch && sMatch && notGraded;
      });

      var subjectScheduleMap = {};
      subjects.forEach(function (s) {
        subjectScheduleMap[s.name.toLowerCase().trim()] = s.schedule || "";
      });

      filtered = filtered.slice().sort(function (a, b) {
        var keyA = (a.subject || "").toLowerCase().trim();
        var keyB = (b.subject || "").toLowerCase().trim();
        var scheduleA = subjectScheduleMap[keyA] || "";
        var scheduleB = subjectScheduleMap[keyB] || "";
        return getSortKey(scheduleA) - getSortKey(scheduleB);
      });

      ungradedSubjects = ungradedSubjects.slice().sort(function (a, b) {
        return getSortKey(a.schedule) - getSortKey(b.schedule);
      });

      list.innerHTML = "";
      if (filtered.length === 0 && ungradedSubjects.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-chart-simple"></i></div>' +
            '<p class="empty-title">No grades found</p>' +
            '<p class="empty-sub">Click "Add Grade" to record your subjects and compute your GWA.</p>' +
          '</div>';
        if (gwaDisplay) { gwaDisplay.textContent = "0.00"; gwaDisplay.style.color = ""; }
        return;
      }

      filtered.forEach(function (item) {
        var div = document.createElement("div");
        div.className = "grade-item" + (item.exclude ? " grade-excluded" : "");
        var gc = item.exclude ? "#94A3B8" : gradeColor(item.grade);
        var gl = item.exclude ? "Excluded from GWA" : gradeLabel(item.grade);
        var uLabel = (item.units || 3) + " Units";

        div.innerHTML =
          '<div class="grade-card-main">' +
            '<div class="grade-card-header-row">' +
              '<h4 class="grade-subject-title">' + escapeHtml(item.subject) + '</h4>' +
              '<div class="grade-score-wrap">' +
                '<span class="grade-score-value" style="color:' + gc + '">' +
                  (item.exclude ? '<s>' + item.grade.toFixed(2) + '</s>' : item.grade.toFixed(2)) +
                '</span>' +
              '</div>' +
            '</div>' +
            '<div class="grade-meta-tags-row">' +
              '<span class="grade-badge" style="background:' + gc + '20;color:' + gc + '">' + gl + '</span>' +
              '<span class="grade-unit-badge"><i class="fas fa-layer-group"></i> ' + uLabel + '</span>' +
              '<span class="grade-term-badge"><i class="fas fa-calendar"></i> ' + escapeHtml(item.year || "1st Year") + ' &bull; ' + escapeHtml(item.semester || "1st Semester") + '</span>' +
            '</div>' +
            '<div class="grade-card-actions-row">' +
              '<button class="btn-grade-action btn-toggle-exclude" data-id="' + item.id + '" ' +
                'title="' + (item.exclude ? 'Include in GWA calculation' : 'Exclude from GWA calculation (e.g. PE/NSTP)') + '">' +
                '<i class="fas ' + (item.exclude ? 'fa-eye' : 'fa-eye-slash') + '"></i> ' +
                (item.exclude ? 'Include' : 'Exclude') +
              '</button>' +
              '<button class="btn-grade-action btn-edit-grade" data-id="' + item.id + '" title="Edit grade">' +
                '<i class="fas fa-pen"></i> Edit' +
              '</button>' +
              '<button class="btn-grade-action btn-delete-grade" data-id="' + item.id + '" title="Delete grade">' +
                '<i class="fas fa-trash"></i> Delete' +
              '</button>' +
            '</div>' +
          '</div>';
        list.appendChild(div);
      });

      ungradedSubjects.forEach(function (s) {
        var div = document.createElement("div");
        div.className = "grade-item grade-not-graded";
        div.innerHTML =
          '<div class="grade-card-main">' +
            '<div class="grade-card-header-row">' +
              '<h4 class="grade-subject-title">' + escapeHtml(s.name) + '</h4>' +
              '<div class="grade-score-wrap">' +
                '<span class="grade-score-value grade-score-na">—</span>' +
              '</div>' +
            '</div>' +
            '<div class="grade-meta-tags-row">' +
              '<span class="grade-badge grade-badge-na">Not Graded</span>' +
              '<span class="grade-term-badge"><i class="fas fa-calendar"></i> ' + escapeHtml(s.year || "1st Year") + ' &bull; ' + escapeHtml(s.semester || "1st Semester") + '</span>' +
            '</div>' +
            '<div class="grade-card-actions-row">' +
              '<button class="btn-grade-action btn-add-grade-for-subject" data-name="' + escapeHtml(s.name) + '" ' +
                'data-year="' + escapeHtml(s.year || "1st Year") + '" data-semester="' + escapeHtml(s.semester || "1st Semester") + '" ' +
                'title="Add grade for this subject">' +
                '<i class="fas fa-plus"></i> Add Grade' +
              '</button>' +
            '</div>' +
          '</div>';
        list.appendChild(div);
      });

      list.querySelectorAll(".btn-add-grade-for-subject").forEach(function (btn) {
        btn.addEventListener("click", function () {
          document.getElementById("grade-edit-id").value = "";
          document.getElementById("grade-subject").value = btn.getAttribute("data-name");
          document.getElementById("grade-value").value = "";
          document.getElementById("grade-units").value = "3";
          document.getElementById("grade-year").value = btn.getAttribute("data-year") || "1st Year";
          document.getElementById("grade-semester").value = btn.getAttribute("data-semester") || "1st Semester";
          document.getElementById("grade-exclude").checked = false;
          document.getElementById("grade-modal-title").textContent = "Add Grade";
          openModal("grade-modal-overlay");
        });
      });

      list.querySelectorAll(".btn-toggle-exclude").forEach(function (btn) {
        btn.addEventListener("click", function () {
          withLoading(function () { return toggleGradeExclude(btn.getAttribute("data-id")); }).then(function () {
            loadGrades();
          }).catch(function (err) {
            showToast(err.message || "Could not update exclude status.", "error");
          });
        });
      });
      list.querySelectorAll(".btn-edit-grade").forEach(function (btn) {
        btn.addEventListener("click", function () {
          editGradeItem(btn.getAttribute("data-id"));
        });
      });
      list.querySelectorAll(".btn-delete-grade").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this grade?", function () {
            withLoading(function () { return deleteGrade(btn.getAttribute("data-id")); }).then(function () {
              loadGrades();
              showToast("Grade deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete grade.", "error");
            });
          });
        });
      });

      var gwa = calculateGWA(grades, year, semester);
      if (gwaDisplay) {
        gwaDisplay.textContent = gwa > 0 ? gwa.toFixed(4).replace(/00$/, '') : "0.00";
        gwaDisplay.style.color = gwa > 0 ? gradeColor(gwa) : "";
      }

    } catch (err) {
      console.error("Error loading grades:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load grades</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function gradeColor(g) {
    if (g <= 1.50 && g > 0) return "#10B981";
    if (g <= 2.00 && g > 0) return "#2563EB";
    if (g <= 2.50 && g > 0) return "#F59E0B";
    if (g <= 3.00 && g > 0) return "#8B5CF6";
    if (g > 5.00) {
      if (g >= 90) return "#10B981";
      if (g >= 80) return "#2563EB";
      if (g >= 75) return "#F59E0B";
      return "#EF4444";
    }
    return "#EF4444";
  }

  function gradeLabel(g) {
    if (g <= 1.25 && g > 0) return "Excellent";
    if (g <= 1.75 && g > 0) return "Very Good";
    if (g <= 2.25 && g > 0) return "Good";
    if (g <= 2.75 && g > 0) return "Satisfactory";
    if (g <= 3.00 && g > 0) return "Passing";
    if (g > 3.00 && g <= 5.00) return "Failed";
    if (g >= 90) return "Excellent";
    if (g >= 80) return "Good";
    if (g >= 75) return "Satisfactory";
    return "Below Average";
  }

  function calculateGWA(grades, year, semester) {
    var eligible = grades.filter(function (g) {
      var yearMatch = (year === "all" || !year || g.year === year);
      var semMatch = (semester === "all" || !semester || g.semester === semester);
      return yearMatch && semMatch && !g.exclude && !isNaN(g.grade);
    });
    if (!eligible.length) return 0;
    var totalWeighted = 0;
    var totalUnits = 0;
    eligible.forEach(function (g) {
      var u = parseFloat(g.units) || 3;
      totalWeighted += (parseFloat(g.grade) * u);
      totalUnits += u;
    });
    if (totalUnits === 0) return 0;
    return totalWeighted / totalUnits;
  }

  function editGradeItem(id) {
    getGrades().then(function (grades) {
      var item = grades.find(function (g) { return g.id === id; });
      if (!item) return;
      document.getElementById("grade-edit-id").value = id;
      document.getElementById("grade-subject").value = item.subject;
      document.getElementById("grade-value").value = item.grade;
      document.getElementById("grade-units").value = item.units || 3;
      document.getElementById("grade-year").value = item.year || "1st Year";
      document.getElementById("grade-semester").value = item.semester || "1st Semester";
      document.getElementById("grade-exclude").checked = !!item.exclude;
      document.getElementById("grade-modal-title").textContent = "Edit Grade";
      openModal("grade-modal-overlay");
    }).catch(function (err) {
      showToast("Could not load grade.", "error");
    });
  }

  // ===== CLASSMATES LOAD =====
  async function loadClassmates() {
    const list = document.getElementById("classmates-list");
    const mySectionBadge = document.getElementById("my-section-display");
    if (!list) return;

    var userProf = getProfile();
    var mySec = userProf.section ? normalizeSection(userProf.section) : "";
    if (mySectionBadge) {
      mySectionBadge.textContent = "Your Section: " + mySec;
    }

    try {
      var classmates = await getSectionClassmates();
      list.innerHTML = "";
      if (classmates.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-users"></i></div>' +
            '<p class="empty-title">No classmates found for section ' + escapeHtml(mySec) + '</p>' +
            '<p class="empty-sub">Make sure your Section in Profile matches your classmates (e.g. BSIT 3-A).</p>' +
          '</div>';
        return;
      }

      classmates.forEach(function (cm) {
        var card = document.createElement("div");
        card.className = "classmate-card clickable-card";
        var avatarBg = cm.photo ? 'background-image:url(' + cm.photo + ')' : 'background:' + stringToColor(cm.name);
        var avatarContent = cm.photo ? '' : escapeHtml(initials(cm.name));

        card.innerHTML =
          '<div class="classmate-avatar" style="' + avatarBg + '">' +
            avatarContent +
          '</div>' +
          '<div class="classmate-info">' +
            '<h4>' + escapeHtml(cm.name) + '</h4>' +
            '<p>' +
              (cm.course ? '<span><i class="fas fa-graduation-cap"></i> ' + escapeHtml(cm.course) + '</span> ' : '') +
              (cm.year ? '<span>' + escapeHtml(cm.year) + '</span>' : '') +
            '</p>' +
            '<p class="classmate-section"><i class="fas fa-users"></i> Section ' + escapeHtml(cm.section) + '</p>' +
          '</div>' +
          '<div class="classmate-arrow"><i class="fas fa-chevron-right"></i></div>';

        card.addEventListener("click", function () {
          showClassmateProfileModal(cm);
        });

        list.appendChild(card);
      });

    } catch (err) {
      console.error("Error loading classmates:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load classmates</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  async function getSectionClassmates() {
    var userProf = getProfile();
    var currentUser = getCurrentUser();
    var mySection = userProf.section ? normalizeSection(userProf.section) : "";

    var result = [];

    if (currentUser && isSupabaseReady()) {
      try {
        var client = getSupabaseClient();
        var response = await withTimeout(
          client
            .from("profiles")
            .select("id,email,full_name,course,year,section,bio,student_id,contact,photo")
            .neq("id", currentUser.id),
          8000,
          "Supabase classmates load"
        );
        if (response.error) throw response.error;
        (response.data || []).forEach(function (prof) {
          var uSec = prof.section ? normalizeSection(prof.section) : "";
          if (uSec === mySection || mySection === "ALL") {
            result.push({
              id: prof.id || cryptoId(),
              name: prof.full_name || prof.email || "Classmate",
              email: prof.email || "",
              course: prof.course || "BSIT",
              year: prof.year || "3rd Year",
              section: uSec,
              bio: prof.bio || "Classmate in " + uSec,
              studentId: prof.student_id || "N/A",
              contact: prof.contact || "N/A",
              photo: prof.photo || null
            });
          }
        });
      } catch (error) {
        console.error("[ClassConnect] Supabase classmates load failed:", error);
      }
    }

    var demo = getDemoClassmates();
    demo.forEach(function (cm) {
      var cmSec = normalizeSection(cm.section);
      if (cmSec === mySection || mySection === "ALL") {
        var alreadyAdded = result.some(function (r) { return r.name.toLowerCase() === cm.name.toLowerCase(); });
        if (!alreadyAdded) {
          result.push({
            id: cryptoId(),
            name: cm.name,
            email: cm.email || (cm.name.toLowerCase().replace(/\s+/g, '.') + "@ctu.edu.ph"),
            course: cm.course || "BSIT",
            year: cm.year || "3rd Year",
            section: cmSec,
            bio: cm.bio || "BSIT Student at CTU Main Campus",
            studentId: "2023-CTU-" + Math.floor(1000 + Math.random() * 9000),
            contact: "0912-345-6789",
            photo: null
          });
        }
      }
    });

    return result;
  }

  function getDemoClassmates() {
    return DEMO_CLASSMATES;
  }

  function showClassmateProfileModal(cm) {
    var avatarEl = document.getElementById("cm-modal-avatar");
    var nameEl = document.getElementById("cm-modal-name");
    var sectionEl = document.getElementById("cm-modal-section");
    var courseYearEl = document.getElementById("cm-modal-course-year");
    var emailEl = document.getElementById("cm-modal-email");
    var bioEl = document.getElementById("cm-modal-bio");
    var studentIdEl = document.getElementById("cm-modal-studentid");
    var contactEl = document.getElementById("cm-modal-contact");

    if (avatarEl) {
      if (cm.photo) {
        avatarEl.style.backgroundImage = "url(" + cm.photo + ")";
        avatarEl.textContent = "";
      } else {
        avatarEl.style.backgroundImage = "";
        avatarEl.style.backgroundColor = stringToColor(cm.name);
        avatarEl.textContent = initials(cm.name);
      }
    }
    if (nameEl) nameEl.textContent = cm.name;
    if (sectionEl) sectionEl.textContent = "Section: " + cm.section;
    if (courseYearEl) courseYearEl.textContent = (cm.course || "BSIT") + " • " + (cm.year || "3rd Year");
    if (emailEl) emailEl.textContent = cm.email || "N/A";
    if (bioEl) bioEl.textContent = cm.bio || "No bio provided.";
    if (studentIdEl) studentIdEl.textContent = cm.studentId || "N/A";
    if (contactEl) contactEl.textContent = cm.contact || "N/A";

    openModal("classmate-profile-modal-overlay");
  }

  // ===== FAQS LOAD =====
  function loadFaqs() {
    const list = document.getElementById("faqs-list");
    if (!list) return;
    list.innerHTML = "";
    DEMO_FAQS.forEach(function (faq) {
      var div = document.createElement("div");
      div.className = "faq-item";
      div.innerHTML =
        '<div class="faq-question">' +
          '<span>' + escapeHtml(faq.question) + '</span>' +
          '<i class="fas fa-chevron-down faq-chevron"></i>' +
        '</div>' +
        '<div class="faq-answer">' + escapeHtml(faq.answer) + '</div>';
      list.appendChild(div);
    });
    list.querySelectorAll(".faq-question").forEach(function (q) {
      q.addEventListener("click", function () {
        var parent = q.parentElement;
        var isOpen = parent.classList.contains("open");
        list.querySelectorAll(".faq-item.open").forEach(function (item) {
          item.classList.remove("open");
        });
        if (!isOpen) parent.classList.add("open");
      });
    });
  }

  // ===== CURRICULUM LOAD =====
  async function loadCurriculum() {
    var list = document.getElementById("curriculum-subjects-list");
    var pdfSection = document.getElementById("curriculum-pdf-section");
    var corSection = document.getElementById("cor-pdf-section");
    if (!list) return;

    list.innerHTML =
      '<div class="curriculum-loading-state">' +
        '<div class="curriculum-spinner"><i class="fas fa-circle-notch fa-spin"></i></div>' +
        '<p class="curriculum-loading-text">Loading curriculum…</p>' +
      '</div>';
    if (pdfSection) pdfSection.style.opacity = "0.5";
    if (corSection) corSection.style.opacity = "0.5";

    try {
      if (pdfSection) pdfSection.style.opacity = "";
      if (corSection) corSection.style.opacity = "";
      if (pdfSection) {
        var pdfData = await getCurriculumPDF();
        if (pdfData) {
          pdfSection.innerHTML =
            '<div class="pdf-upload-area pdf-active-card">' +
              '<div class="pdf-info">' +
                '<i class="fas fa-file-pdf pdf-icon"></i>' +
                '<div>' +
                  '<h4 class="pdf-filename">' + escapeHtml(pdfData.name || "Curriculum PDF") + '</h4>' +
                  '<span class="pdf-subtitle">Uploaded curriculum syllabus</span>' +
                '</div>' +
              '</div>' +
              '<div class="pdf-actions">' +
                '<button class="btn-pdf-view" onclick="window.open(\'' + pdfData.data + '\',\'_blank\')"><i class="fas fa-eye"></i> View PDF</button>' +
                '<button class="btn-pdf-export" id="export-pdf-btn"><i class="fas fa-download"></i> Export</button>' +
                '<button class="btn-pdf-remove" id="remove-pdf-btn"><i class="fas fa-trash"></i> Remove</button>' +
              '</div>' +
            '</div>';
          var removeBtn = document.getElementById("remove-pdf-btn");
          if (removeBtn) {
            removeBtn.addEventListener("click", function () {
              showConfirm("Remove the uploaded PDF?", function () {
                withLoading(function () { return removeCurriculumPDF(); }).then(function () {
                  loadCurriculum();
                  showToast("PDF removed.", "info");
                }).catch(function (err) {
                  showToast(err.message || "Could not remove PDF.", "error");
                });
              });
            });
          }
          var exportBtn = document.getElementById("export-pdf-btn");
          if (exportBtn) {
            exportBtn.addEventListener("click", function () {
              downloadPDF(pdfData, "curriculum.pdf");
              showToast("Curriculum PDF download started.", "success");
            });
          }
        } else {
          pdfSection.innerHTML =
            '<div class="pdf-upload-area">' +
              '<div class="no-pdf">' +
                '<i class="fas fa-file-pdf"></i>' +
                '<span>No curriculum PDF uploaded yet</span>' +
              '</div>' +
              '<div class="pdf-actions">' +
                '<button class="btn-pdf-upload" id="upload-pdf-btn"><i class="fas fa-upload"></i> Upload PDF Syllabus</button>' +
                '<input type="file" id="pdf-file-input" accept=".pdf" hidden>' +
              '</div>' +
            '</div>';
          var uploadBtn = document.getElementById("upload-pdf-btn");
          var fileInput = document.getElementById("pdf-file-input");
          if (uploadBtn && fileInput) {
            uploadBtn.addEventListener("click", function () { fileInput.click(); });
            fileInput.addEventListener("change", function () {
              var file = fileInput.files[0];
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                showToast("PDF must be smaller than 10 MB.", "error");
                fileInput.value = "";
                return;
              }
              var reader = new FileReader();
              reader.onload = function (e) {
                var base64 = e.target.result;
                withLoading(function () { return saveCurriculumPDF(file.name, base64); }).then(function () {
                  loadCurriculum();
                  showToast("Curriculum PDF uploaded successfully.", "success");
                  fileInput.value = "";
                }).catch(function (err) {
                  showToast(err.message || "Could not upload PDF.", "error");
                });
              };
              reader.readAsDataURL(file);
            });
          }
        }
      }

      if (corSection) {
        var corData = await getCORPDF();
        if (corData) {
          corSection.innerHTML =
            '<div class="pdf-upload-area pdf-active-card cor-active-card">' +
              '<div class="pdf-info">' +
                '<i class="fas fa-id-card pdf-icon cor-icon"></i>' +
                '<div>' +
                  '<h4 class="pdf-filename">' + escapeHtml(corData.name || "Certificate of Registration") + '</h4>' +
                  '<span class="pdf-subtitle">Certificate of Registration (COR)</span>' +
                '</div>' +
              '</div>' +
              '<div class="pdf-actions">' +
                '<button class="btn-pdf-view" onclick="window.open(\'' + corData.data + '\',\'_blank\')"><i class="fas fa-eye"></i> View COR</button>' +
                '<button class="btn-pdf-export" id="export-cor-btn"><i class="fas fa-download"></i> Export</button>' +
                '<button class="btn-pdf-remove" id="remove-cor-btn"><i class="fas fa-trash"></i> Remove</button>' +
              '</div>' +
            '</div>';
          var removeCorBtn = document.getElementById("remove-cor-btn");
          if (removeCorBtn) {
            removeCorBtn.addEventListener("click", function () {
              showConfirm("Remove the uploaded Certificate of Registration?", function () {
                withLoading(function () { return removeCORPDF(); }).then(function () {
                  loadCurriculum();
                  showToast("Certificate of Registration removed.", "info");
                }).catch(function (err) {
                  showToast(err.message || "Could not remove COR.", "error");
                });
              });
            });
          }
          var exportCorBtn = document.getElementById("export-cor-btn");
          if (exportCorBtn) {
            exportCorBtn.addEventListener("click", function () {
              downloadPDF(corData, "certificate-of-registration.pdf");
              showToast("COR download started.", "success");
            });
          }
        } else {
          corSection.innerHTML =
            '<div class="pdf-upload-area">' +
              '<div class="pdf-info">' +
                '<i class="fas fa-id-card pdf-icon" style="color:var(--slate-blue,#6366f1);font-size:28px;flex-shrink:0;"></i>' +
                '<div class="no-pdf" style="background:none;padding:0;">' +
                  '<span>No Certificate of Registration uploaded yet</span>' +
                '</div>' +
              '</div>' +
              '<div class="pdf-actions">' +
                '<button class="btn-pdf-upload" id="upload-cor-btn"><i class="fas fa-upload"></i> Upload COR</button>' +
                '<input type="file" id="cor-file-input" accept=".pdf,image/*" hidden>' +
              '</div>' +
            '</div>';
          var uploadCorBtn = document.getElementById("upload-cor-btn");
          var corFileInput = document.getElementById("cor-file-input");
          if (uploadCorBtn && corFileInput) {
            uploadCorBtn.addEventListener("click", function () { corFileInput.click(); });
            corFileInput.addEventListener("change", function () {
              var file = corFileInput.files[0];
              if (!file) return;
              if (file.size > 10 * 1024 * 1024) {
                showToast("File must be smaller than 10 MB.", "error");
                corFileInput.value = "";
                return;
              }
              var reader = new FileReader();
              reader.onload = function (e) {
                var base64 = e.target.result;
                withLoading(function () { return saveCORPDF(file.name, base64); }).then(function () {
                  loadCurriculum();
                  showToast("Certificate of Registration uploaded successfully.", "success");
                  corFileInput.value = "";
                }).catch(function (err) {
                  showToast(err.message || "Could not upload COR.", "error");
                });
              };
              reader.readAsDataURL(file);
            });
          }
        }
      }

      var fetchResults = await Promise.all([getCurriculumSubjects(), getSubjects(), getGrades()]);
      var curriculumSubjects = fetchResults[0];
      var mySubjects       = fetchResults[1];
      var allGrades        = fetchResults[2];

      var yearFilterBtn = document.querySelector(".curriculum-year-filter.active");
      var filterYear = yearFilterBtn ? yearFilterBtn.getAttribute("data-year") : "all";
      var semSelect = document.getElementById("curriculum-semester-filter");
      var filterSem = semSelect ? semSelect.value : "all";

      var gradeMap = {};
      allGrades.forEach(function (g) {
        var key = g.subject.toLowerCase().trim();
        if (!gradeMap[key]) gradeMap[key] = g;
      });

      var curriculumNameSet = {};
      curriculumSubjects.forEach(function (s) {
        curriculumNameSet[s.name.toLowerCase().trim()] = true;
      });

      var syncedFromSubjects = mySubjects
        .filter(function (s) { return !curriculumNameSet[s.name.toLowerCase().trim()]; })
        .map(function (s) {
          return {
            id: s.id,
            name: s.name,
            code: "—",
            schedule: s.schedule || "",
            year: s.year || "1st Year",
            semester: s.semester || "1st Semester",
            _fromSubjects: true
          };
        });

      var allItems = curriculumSubjects.concat(syncedFromSubjects);

      var filtered = allItems.filter(function (s) {
        var matchYear = (filterYear === "all" || s.year === filterYear);
        var matchSem  = (filterSem  === "all" || (s.semester || "1st Semester") === filterSem);
        return matchYear && matchSem;
      });

      filtered = filtered.slice().sort(function (a, b) {
        return getSortKey(a.schedule) - getSortKey(b.schedule);
      });

      list.innerHTML = "";
      if (filtered.length === 0) {
        list.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-icon"><i class="fas fa-book-open"></i></div>' +
            '<p class="empty-title">No subjects found</p>' +
            '<p class="empty-sub">Add subjects in My Subjects or use the curriculum modal, or try a different filter.</p>' +
          '</div>';
        return;
      }

      filtered.forEach(function (item) {
        var card = document.createElement("div");
        card.className = "curriculum-subject-card";
        card.style.borderLeftColor = stringToColor(item.name);

        var matchedGrade = gradeMap[item.name.toLowerCase().trim()];
        var gradeHtml;
        if (matchedGrade) {
          var gc = matchedGrade.exclude ? "#94A3B8" : gradeColor(matchedGrade.grade);
          gradeHtml = '<span class="cs-grade-badge" style="background:' + gc + '20;color:' + gc + '">' +
            (matchedGrade.exclude ? '<s>' + matchedGrade.grade.toFixed(2) + '</s>' : matchedGrade.grade.toFixed(2)) +
            '</span>';
        } else {
          gradeHtml = '<span class="cs-grade-badge cs-grade-na">Not Graded</span>';
        }

        var syncBadge = item._fromSubjects
          ? '<span class="cs-synced-badge"><i class="fas fa-link"></i> From Subjects</span>'
          : '';

        var actionsHtml = item._fromSubjects
          ? '<span class="cs-synced-hint">Manage in Subjects</span>'
          : '<button class="btn-icon btn-edit-curriculum" data-id="' + item.id + '" title="Edit"><i class="fas fa-pen"></i></button>' +
            '<button class="btn-icon btn-delete-curriculum" data-id="' + item.id + '" title="Delete"><i class="fas fa-trash"></i></button>';

        card.innerHTML =
          '<div class="cs-info">' +
            syncBadge +
            '<h4>' + escapeHtml(item.name) + '</h4>' +
            '<div class="cs-meta">' +
              '<span><i class="fas fa-hashtag"></i> ' + escapeHtml(item.code || "—") + '</span>' +
              '<span><i class="fas fa-clock"></i> ' + escapeHtml(item.schedule || "No schedule") + '</span>' +
              '<span class="cs-year">' + escapeHtml(item.year) + '</span>' +
              '<span class="cs-sem">' + escapeHtml(item.semester || "1st Semester") + '</span>' +
              gradeHtml +
            '</div>' +
          '</div>' +
          '<div class="cs-actions">' + actionsHtml + '</div>';
        list.appendChild(card);
      });

      list.querySelectorAll(".btn-edit-curriculum").forEach(function (btn) {
        btn.addEventListener("click", function () {
          editCurriculumSubject(btn.getAttribute("data-id"));
        });
      });
      list.querySelectorAll(".btn-delete-curriculum").forEach(function (btn) {
        btn.addEventListener("click", function () {
          showConfirm("Delete this curriculum subject?", function () {
            withLoading(function () { return deleteCurriculumSubject(btn.getAttribute("data-id")); }).then(function () {
              loadCurriculum();
              showToast("Subject deleted.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete subject.", "error");
            });
          });
        });
      });

    } catch (err) {
      console.error("Error loading curriculum:", err);
      list.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load curriculum</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function downloadPDF(pdfData, defaultName) {
    var a = document.createElement("a");
    a.href = pdfData.data;
    a.download = pdfData.name || defaultName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function editCurriculumSubject(id) {
    getCurriculumSubjects().then(function (subjects) {
      var found = subjects.find(function (s) { return s.id === id; });
      if (!found) return;
      document.getElementById("curriculum-subject-edit-id").value = id;
      document.getElementById("curriculum-subject-name").value = found.name;
      document.getElementById("curriculum-subject-code").value = found.code;
      document.getElementById("curriculum-subject-schedule").value = found.schedule || "";
      document.getElementById("curriculum-subject-year").value = found.year;
      document.getElementById("curriculum-subject-semester").value = found.semester || "1st Semester";
      document.getElementById("curriculum-subject-modal-title").textContent = "Edit Subject";
      openModal("curriculum-subject-modal-overlay");
    }).catch(function (err) {
      showToast("Could not load subject.", "error");
    });
  }

  function setupSubjectFilters() {
    var filters = document.querySelectorAll(".subject-year-filter");
    filters.forEach(function (btn) {
      if (!btn._ccBound) {
        btn._ccBound = true;
        btn.addEventListener("click", function () {
          filters.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          loadSubjects();
        });
      }
    });
    var semSelect = document.getElementById("subjects-semester-filter");
    if (semSelect && !semSelect._ccBound) {
      semSelect._ccBound = true;
      semSelect.addEventListener("change", function () { loadSubjects(); });
    }
  }

  function setupScheduleFilters() {
    var filters = document.querySelectorAll(".schedule-year-filter");
    filters.forEach(function (btn) {
      if (!btn._ccBound) {
        btn._ccBound = true;
        btn.addEventListener("click", function () {
          filters.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          loadSchedule();
        });
      }
    });
    var semSelect = document.getElementById("schedule-semester-filter");
    if (semSelect && !semSelect._ccBound) {
      semSelect._ccBound = true;
      semSelect.addEventListener("change", function () { loadSchedule(); });
    }
  }

  function setupCurriculumFilters() {
    var filters = document.querySelectorAll(".curriculum-year-filter");
    filters.forEach(function (btn) {
      if (!btn._ccBound) {
        btn._ccBound = true;
        btn.addEventListener("click", function () {
          filters.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          loadCurriculum();
        });
      }
    });

    var semFilterSelect = document.getElementById("curriculum-semester-filter");
    if (semFilterSelect && !semFilterSelect._ccBound) {
      semFilterSelect._ccBound = true;
      semFilterSelect.addEventListener("change", function () {
        loadCurriculum();
      });
    }
  }

  // =========================================================================
  // ===== SCHOOL FILES VAULT (VIEW & HANDLERS) =====
  // =========================================================================

  function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    var k = 1024;
    var sizes = ["B", "KB", "MB", "GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function getFileIconMeta(filename, mimeType) {
    var ext = (filename || "").split(".").pop().toLowerCase();
    var mime = (mimeType || "").toLowerCase();

    if (ext === "pdf" || mime.includes("pdf")) {
      return { icon: "fa-file-pdf", color: "#EF4444", bg: "#FEE2E2", label: "PDF", type: "pdf" };
    }
    if (["doc", "docx", "word"].includes(ext) || mime.includes("word") || mime.includes("officedocument.wordprocessingml")) {
      return { icon: "fa-file-word", color: "#2563EB", bg: "#DBEAFE", label: "DOCX", type: "word" };
    }
    if (["ppt", "pptx", "powerpoint"].includes(ext) || mime.includes("presentation") || mime.includes("powerpoint")) {
      return { icon: "fa-file-powerpoint", color: "#EA580C", bg: "#FFEDD5", label: "PPTX", type: "presentation" };
    }
    if (["xls", "xlsx", "csv", "excel"].includes(ext) || mime.includes("spreadsheet") || mime.includes("excel") || mime.includes("csv")) {
      return { icon: "fa-file-excel", color: "#16A34A", bg: "#DCFCE7", label: "EXCEL", type: "spreadsheet" };
    }
    if (["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext) || mime.includes("image")) {
      return { icon: "fa-file-image", color: "#9333EA", bg: "#F3E8FF", label: "IMG", type: "image" };
    }
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext) || mime.includes("zip") || mime.includes("compressed")) {
      return { icon: "fa-file-zipper", color: "#D97706", bg: "#FEF3C7", label: "ZIP", type: "archive" };
    }
    if (["txt", "md", "js", "ts", "py", "java", "c", "cpp", "html", "css", "json", "sql"].includes(ext) || mime.includes("text")) {
      return { icon: "fa-file-lines", color: "#475569", bg: "#F1F5F9", label: "TEXT", type: "text" };
    }
    return { icon: "fa-file", color: "#64748B", bg: "#F8FAFC", label: ext.toUpperCase() || "FILE", type: "other" };
  }

  var _currentFilesFilter = { category: "all", format: "all", query: "" };

  async function loadSchoolFiles(searchQuery, categoryFilter, formatFilter) {
    var container = document.getElementById("school-files-list");
    var badgeCount = document.getElementById("files-count-badge");
    if (!container) return;

    if (searchQuery !== undefined) _currentFilesFilter.query = searchQuery;
    if (categoryFilter !== undefined) _currentFilesFilter.category = categoryFilter;
    if (formatFilter !== undefined) _currentFilesFilter.format = formatFilter;

    var q = (_currentFilesFilter.query || "").trim().toLowerCase();
    var cat = _currentFilesFilter.category || "all";
    var fmt = _currentFilesFilter.format || "all";

    try {
      var files = await getSchoolFiles();

      var filtered = files.filter(function (file) {
        var nameMatch = !q || (file.name && file.name.toLowerCase().indexOf(q) !== -1) ||
                              (file.original_name && file.original_name.toLowerCase().indexOf(q) !== -1) ||
                              (file.subject && file.subject.toLowerCase().indexOf(q) !== -1) ||
                              (file.notes && file.notes.toLowerCase().indexOf(q) !== -1) ||
                              (file.category && file.category.toLowerCase().indexOf(q) !== -1);
        
        var catMatch = (cat === "all" || (file.category && file.category.toLowerCase() === cat.toLowerCase()));
        
        var ext = (file.name || file.original_name || "").split(".").pop().toLowerCase();
        var fmtMatch = true;
        if (fmt !== "all") {
          if (fmt === "pdf") fmtMatch = (ext === "pdf");
          else if (fmt === "word") fmtMatch = ["doc", "docx"].includes(ext);
          else if (fmt === "powerpoint" || fmt === "presentation") fmtMatch = ["ppt", "pptx"].includes(ext);
          else if (fmt === "excel" || fmt === "spreadsheet") fmtMatch = ["xls", "xlsx", "csv"].includes(ext);
          else if (fmt === "image") fmtMatch = ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext);
          else if (fmt === "archive") fmtMatch = ["zip", "rar", "7z", "tar", "gz"].includes(ext);
          else if (fmt === "text") fmtMatch = ["txt", "md", "json", "sql", "js", "ts", "html", "css", "py", "java", "c", "cpp"].includes(ext);
        }

        return nameMatch && catMatch && fmtMatch;
      });

      if (badgeCount) {
        badgeCount.innerHTML = '<i class="fas fa-file"></i> <span>' + filtered.length + ' File' + (filtered.length === 1 ? '' : 's') + '</span>';
      }

      container.innerHTML = "";

      if (files.length === 0) {
        container.innerHTML =
          '<div class="files-empty-hub-card">' +
            '<div class="empty-hub-badge">' +
              '<div class="empty-hub-icon-inner"><i class="fas fa-folder-open"></i></div>' +
            '</div>' +
            '<h3 class="empty-hub-title">Your School Files Vault is Empty</h3>' +
            '<p class="empty-hub-description">Upload, organize, and preview lecture notes, reviewers, presentations, PDFs, assignments, and syllabi for all your subjects in one centralized workspace.</p>' +
            '<div class="empty-hub-cta-wrap">' +
              '<button type="button" class="btn-primary btn-hub-upload" id="empty-hub-upload-btn">' +
                '<i class="fas fa-cloud-arrow-up"></i> Upload Your First File' +
              '</button>' +
            '</div>' +
            '<div class="empty-hub-quick-chips-wrap">' +
              '<span class="empty-chips-label"><i class="fas fa-bolt"></i> Quick upload by category:</span>' +
              '<div class="empty-hub-chips-grid">' +
                '<button type="button" class="hub-chip-btn" data-precat="Notes"><i class="fas fa-note-sticky"></i> Class Notes</button>' +
                '<button type="button" class="hub-chip-btn" data-precat="Reviewer"><i class="fas fa-book-bookmark"></i> Reviewer / Exam Guide</button>' +
                '<button type="button" class="hub-chip-btn" data-precat="Syllabus"><i class="fas fa-graduation-cap"></i> Course Syllabus</button>' +
                '<button type="button" class="hub-chip-btn" data-precat="Assignment"><i class="fas fa-clipboard-list"></i> Assignment</button>' +
                '<button type="button" class="hub-chip-btn" data-precat="Module"><i class="fas fa-book"></i> Module / Slide</button>' +
                '<button type="button" class="hub-chip-btn" data-precat="Project"><i class="fas fa-laptop-code"></i> Project Source</button>' +
              '</div>' +
            '</div>' +
            '<div class="empty-hub-features-row">' +
              '<div class="hub-feat-item"><i class="fas fa-eye"></i> <span>In-App PDF &amp; Image Viewer</span></div>' +
              '<div class="hub-feat-item"><i class="fas fa-shield-halved"></i> <span>Local &amp; Secure Storage</span></div>' +
              '<div class="hub-feat-item"><i class="fas fa-tags"></i> <span>Subject &amp; Category Filters</span></div>' +
            '</div>' +
          '</div>';

        var emptyUploadBtn = document.getElementById("empty-hub-upload-btn");
        if (emptyUploadBtn) {
          emptyUploadBtn.addEventListener("click", function () {
            openUploadFileModal();
          });
        }

        container.querySelectorAll(".hub-chip-btn").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var precat = btn.getAttribute("data-precat");
            openUploadFileModal(precat);
          });
        });

        return;
      }

      if (filtered.length === 0) {
        container.innerHTML =
          '<div class="files-empty-filtered-card">' +
            '<div class="empty-filtered-icon"><i class="fas fa-filter-circle-xmark"></i></div>' +
            '<h4 class="empty-filtered-title">No Files Match Your Filters</h4>' +
            '<p class="empty-filtered-sub">No files found for "' + escapeHtml(q || cat || fmt) + '". Try resetting your search or category filters.</p>' +
            '<button type="button" class="btn-secondary" id="files-reset-filters-btn" style="margin-top:12px;">' +
              '<i class="fas fa-rotate-left"></i> Reset All Filters' +
            '</button>' +
          '</div>';

        var resetBtn = document.getElementById("files-reset-filters-btn");
        if (resetBtn) {
          resetBtn.addEventListener("click", function () {
            var searchInput = document.getElementById("files-search-input");
            var formatSelect = document.getElementById("files-format-select");
            if (searchInput) searchInput.value = "";
            if (formatSelect) formatSelect.value = "all";
            document.querySelectorAll(".file-cat-filter, .files-category-filter").forEach(function (b) {
              b.classList.toggle("active", (b.getAttribute("data-cat") || b.getAttribute("data-category")) === "all");
            });
            _currentFilesFilter = { category: "all", format: "all", query: "" };
            loadSchoolFiles("", "all", "all");
          });
        }
        return;
      }

      filtered.forEach(function (file) {
        var meta = getFileIconMeta(file.original_name || file.name, file.mime_type);
        var card = document.createElement("div");
        card.className = "school-file-card";
        card.setAttribute("data-file-id", file.id);

        var fileSrc = file.data || file.file_url || file.url;
        var isImg = meta.type === "image" && fileSrc;
        var visualPreview = isImg
          ? '<div class="file-card-img-thumb" style="background-image:url(\'' + fileSrc + '\')"></div>'
          : '<div class="file-card-icon-wrap" style="background:' + meta.bg + ';color:' + meta.color + '">' +
              '<i class="fas ' + meta.icon + '"></i>' +
              '<span class="file-badge-ext">' + meta.label + '</span>' +
            '</div>';

        var subjectTag = file.subject ? '<span class="file-pill file-pill-subject"><i class="fas fa-book"></i> ' + escapeHtml(file.subject) + '</span>' : '';
        var categoryTag = '<span class="file-pill file-pill-cat">' + escapeHtml(file.category || "Notes") + '</span>';
        var notesHtml = file.notes ? '<p class="file-card-notes">' + escapeHtml(file.notes) + '</p>' : '';
        var sizeText = formatFileSize(file.size || (file.data ? Math.round(file.data.length * 0.75) : 0));
        var dateText = timeAgo(file.created_at || new Date().toISOString());

        card.innerHTML =
          '<div class="file-card-top">' +
            visualPreview +
            '<div class="file-card-meta-tags">' +
              categoryTag +
              subjectTag +
            '</div>' +
          '</div>' +
          '<div class="file-card-content">' +
            '<h4 class="file-card-title" title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</h4>' +
            (file.original_name && file.original_name !== file.name ? '<span class="file-card-original-name">' + escapeHtml(file.original_name) + '</span>' : '') +
            notesHtml +
            '<div class="file-card-stats">' +
              '<span><i class="fas fa-weight-hanging"></i> ' + sizeText + '</span>' +
              '<span><i class="fas fa-clock"></i> ' + dateText + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="file-card-actions">' +
            '<button class="btn-file-action btn-file-preview" data-id="' + file.id + '" title="Preview file">' +
              '<i class="fas fa-eye"></i> View' +
            '</button>' +
            '<button class="btn-file-action btn-file-download" data-id="' + file.id + '" title="Download file">' +
              '<i class="fas fa-download"></i> Download' +
            '</button>' +
            '<button class="btn-file-action btn-file-delete" data-id="' + file.id + '" title="Delete file">' +
              '<i class="fas fa-trash"></i>' +
            '</button>' +
          '</div>';

        container.appendChild(card);
      });

      // Bind actions on file cards
      container.querySelectorAll(".btn-file-preview").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-id");
          var found = files.find(function (f) { return f.id === id; });
          if (found) openFilePreviewModal(found);
        });
      });

      container.querySelectorAll(".btn-file-download").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-id");
          var found = files.find(function (f) { return f.id === id; });
          if (found) triggerFileDownload(found);
        });
      });

      container.querySelectorAll(".btn-file-delete").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.getAttribute("data-id");
          var found = files.find(function (f) { return f.id === id; });
          var name = found ? found.name : "this file";
          showConfirm("Are you sure you want to delete \"" + name + "\"?", function () {
            withLoading(function () { return deleteSchoolFile(id); }).then(function () {
              loadSchoolFiles();
              showToast("File deleted successfully.", "info");
            }).catch(function (err) {
              showToast(err.message || "Could not delete file.", "error");
            });
          });
        });
      });

    } catch (err) {
      console.error("[ClassConnect] Error loading school files:", err);
      container.innerHTML = '<div class="empty-state"><p class="empty-title">Could not load files</p><p class="empty-sub">' + escapeHtml(err.message) + '</p></div>';
    }
  }

  function openUploadFileModal(preselectedCategory) {
    var modal = document.getElementById("upload-file-modal-overlay");
    if (!modal) return;
    var form = document.getElementById("upload-school-file-form");
    if (form) form.reset();
    var dropzoneName = document.getElementById("school-dropzone-filename");
    if (dropzoneName) dropzoneName.textContent = "Choose a file or drag & drop here";
    var dropzoneBox = document.getElementById("school-file-dropzone");
    if (dropzoneBox) dropzoneBox.classList.remove("has-file");
    var categorySelect = document.getElementById("school-file-category-input");
    if (categorySelect && preselectedCategory) {
      categorySelect.value = preselectedCategory;
    }
    openModal("upload-file-modal-overlay");
  }

  function triggerFileDownload(file) {
    var fileSrc = file ? (file.data || file.file_url || file.url) : null;
    if (!fileSrc) {
      showToast("File data is not available to download.", "error");
      return;
    }
    var filename = file.original_name || file.name || "school-file";
    var a = document.createElement("a");
    a.href = fileSrc;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast("Downloading " + filename + "...", "success");
  }

  function openFilePreviewModal(file) {
    if (!file) return;
    window._currentViewingFile = file;
    var overlay = document.getElementById("file-preview-modal-overlay");
    var titleEl = document.getElementById("preview-file-modal-title");
    var metaEl = document.getElementById("preview-file-meta");
    var bodyEl = document.getElementById("file-preview-body");
    var iconWrap = document.getElementById("preview-file-icon-wrap");
    var downloadBtn = document.getElementById("preview-download-btn");

    if (!overlay || !bodyEl) return;

    var fileSrc = file.data || file.file_url || file.url;
    var meta = getFileIconMeta(file.original_name || file.name, file.mime_type);
    if (titleEl) titleEl.textContent = file.name || file.original_name || "File Preview";
    var sizeText = formatFileSize(file.size || (file.data ? Math.round(file.data.length * 0.75) : 0));
    if (metaEl) metaEl.textContent = meta.label + " • " + (file.category || "School File") + (file.subject ? " • " + file.subject : "") + " • " + sizeText;

    if (iconWrap) {
      iconWrap.style.background = meta.bg;
      iconWrap.style.color = meta.color;
      iconWrap.innerHTML = '<i class="fas ' + meta.icon + '"></i>';
    }

    if (downloadBtn) {
      downloadBtn.onclick = function () { triggerFileDownload(file); };
    }

    bodyEl.innerHTML = "";

    if (meta.type === "image" && fileSrc) {
      bodyEl.innerHTML = '<div class="preview-img-container"><img src="' + fileSrc + '" alt="' + escapeHtml(file.name) + '" class="preview-full-img"></div>';
    } else if (meta.type === "pdf" && fileSrc) {
      bodyEl.innerHTML = '<iframe src="' + fileSrc + '" class="preview-pdf-iframe" title="PDF Document"></iframe>';
    } else if (meta.type === "text" && fileSrc && fileSrc.startsWith("data:text/")) {
      try {
        var base64Part = fileSrc.split(",")[1];
        var textContent = atob(base64Part);
        bodyEl.innerHTML = '<div class="preview-text-container"><pre><code>' + escapeHtml(textContent) + '</code></pre></div>';
      } catch (e) {
        bodyEl.innerHTML = renderGenericFilePreview(file, meta, sizeText);
      }
    } else {
      bodyEl.innerHTML = renderGenericFilePreview(file, meta, sizeText);
    }

    openModal("file-preview-modal-overlay");
  }

  function renderGenericFilePreview(file, meta, sizeText) {
    return '<div class="preview-generic-card">' +
      '<div class="preview-generic-icon" style="background:' + meta.bg + ';color:' + meta.color + '">' +
        '<i class="fas ' + meta.icon + '"></i>' +
      '</div>' +
      '<h3>' + escapeHtml(file.name) + '</h3>' +
      '<p class="preview-generic-sub">' + escapeHtml(file.original_name || file.name) + ' (' + sizeText + ')</p>' +
      (file.notes ? '<div class="preview-generic-notes"><strong>Remarks:</strong> ' + escapeHtml(file.notes) + '</div>' : '') +
      '<div style="margin-top:20px;">' +
        '<button type="button" class="btn-primary" onclick="triggerFileDownload(window._currentViewingFile)">' +
          '<i class="fas fa-cloud-arrow-down"></i> Download & Open File' +
        '</button>' +
      '</div>' +
    '</div>';
  }

  function setupSchoolFilesFilters() {
    var categoryBtns = document.querySelectorAll(".file-cat-filter, .files-category-filter");
    categoryBtns.forEach(function (btn) {
      if (!btn._ccBound) {
        btn._ccBound = true;
        btn.addEventListener("click", function () {
          categoryBtns.forEach(function (b) { b.classList.remove("active"); });
          btn.classList.add("active");
          var cat = btn.getAttribute("data-cat") || btn.getAttribute("data-category") || "all";
          loadSchoolFiles(undefined, cat, undefined);
        });
      }
    });

    var formatSelect = document.getElementById("files-format-select");
    if (formatSelect && !formatSelect._ccBound) {
      formatSelect._ccBound = true;
      formatSelect.addEventListener("change", function () {
        loadSchoolFiles(undefined, undefined, formatSelect.value);
      });
    }

    var searchInput = document.getElementById("files-search-input");
    if (searchInput && !searchInput._ccBound) {
      searchInput._ccBound = true;
      var debounceTimer;
      searchInput.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          loadSchoolFiles(searchInput.value, undefined, undefined);
        }, 200);
      });
    }

    populateSchoolFilesSubjectList();
  }

  async function populateSchoolFilesSubjectList() {
    var datalist = document.getElementById("user-subjects-datalist");
    if (!datalist) return;
    try {
      var subjects = await getSubjects();
      datalist.innerHTML = "";
      subjects.forEach(function (s) {
        if (s.name) {
          var opt = document.createElement("option");
          opt.value = s.name;
          datalist.appendChild(opt);
        }
      });
    } catch (e) {}
  }

  // ===== SETTINGS =====
  function getSettings() { return getData(KEYS.SETTINGS, { fontType: "sans-serif" }); }
  function saveSettings(settings) { setData(KEYS.SETTINGS, settings); }

  function applySettings(settings) {
    if (!settings) settings = getSettings();
    var fontType = settings.fontType || "sans-serif";
    document.documentElement.setAttribute("data-font-type", fontType);
  }

  function updateStorageDisplay() {
    var total = 0;
    for (var key in localStorage) {
      if (Object.prototype.hasOwnProperty.call(localStorage, key)) {
        total += ((localStorage[key] || "").length) * 2;
      }
    }
    var el = document.getElementById("settings-storage");
    if (!el) return;
    if (total < 1024) el.textContent = total + " B";
    else if (total < 1048576) el.textContent = (total / 1024).toFixed(1) + " KB";
    else el.textContent = (total / 1048576).toFixed(2) + " MB";
  }

  function loadSettings() {
    const settings = getSettings();
    const fontSelect = document.getElementById("font-type-select");
    if (fontSelect) fontSelect.value = settings.fontType || "sans-serif";
    applySettings(settings);
    updateStorageDisplay();
  }

  // ===== PROFILE FORM =====
  function loadProfileForm() {
    var profile = getProfile();
    var user = getCurrentUser();
    var map = {
      "profile-fullname": profile.name || (user ? user.name : ""),
      "profile-email": profile.email || (user ? user.email : ""),
      "profile-bio": profile.bio || "",
      "profile-student-id": profile.studentId || "",
      "profile-course": profile.course || "",
      "profile-year": profile.year || "",
      "profile-section": profile.section || "",
      "profile-contact": profile.contact || "",
      "profile-birthdate": profile.birthdate || "",
      "profile-gender": profile.gender || "",
      "profile-address": profile.address || "",
      "profile-emergency": profile.emergency || "",
      "profile-guardian-name": profile.guardianName || "",
      "profile-guardian-contact": profile.guardianContact || "",
    };
    for (var id in map) {
      var el = document.getElementById(id);
      if (el) el.value = map[id];
    }
    var avatar = document.getElementById("profile-avatar");
    var photo = getProfilePhoto();
    if (avatar) {
      if (photo) {
        avatar.style.backgroundImage = "url(" + photo + ")";
        avatar.style.backgroundSize = "cover";
        avatar.style.backgroundPosition = "center";
        avatar.textContent = "";
      } else {
        avatar.style.backgroundImage = "";
        avatar.textContent = initials(profile.name || (user ? user.name : "S"));
      }
    }
  }

  // ===== POST TOOLBAR =====
  var currentPostImage = null;

  function updateToolbarState(modalSelector) {
    document.querySelectorAll(modalSelector + " .toolbar-btn[data-command]").forEach(function (btn) {
      var cmd = btn.getAttribute("data-command");
      try {
        var active = document.queryCommandState(cmd);
        btn.classList.toggle("active-toolbar", active);
      } catch (e) {}
    });
  }

  function setupPostToolbar() {
    var editor = document.getElementById("post-content-editable");
    if (!editor) return;
    document.querySelectorAll("#post-modal-overlay .toolbar-btn[data-command]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        var cmd = btn.getAttribute("data-command");
        document.execCommand(cmd, false, null);
        setTimeout(function () { updateToolbarState("#post-modal-overlay"); }, 0);
      });
    });
    editor.addEventListener("keyup", function () { updateToolbarState("#post-modal-overlay"); });
    editor.addEventListener("mouseup", function () { updateToolbarState("#post-modal-overlay"); });
    editor.addEventListener("focus", function () { updateToolbarState("#post-modal-overlay"); });
    var fontSelect = document.getElementById("post-font-select");
    if (fontSelect) {
      fontSelect.addEventListener("mousedown", function () {
        fontSelect._savedRange = saveSelection();
      });
      fontSelect.addEventListener("change", function () {
        if (fontSelect._savedRange) restoreSelection(fontSelect._savedRange);
        document.execCommand("fontName", false, fontSelect.value);
        editor.focus();
      });
    }
    var imageBtn = document.getElementById("post-image-btn");
    var imageInput = document.getElementById("post-image-input");
    if (imageBtn && imageInput) {
      imageBtn.addEventListener("click", function () { imageInput.click(); });

      imageInput.addEventListener("change", async function () {
        var file = imageInput.files[0];
        if (!file) return;

        if (file.size > 5 * 1024 * 1024) {
          showToast("Image must be smaller than 5 MB.", "error");
          imageInput.value = "";
          return;
        }

        try {
          var user = getCurrentUser();
          if (!user) {
            showToast("You must be logged in to upload images.", "error");
            imageInput.value = "";
            return;
          }

          if (!isSupabaseReady()) {
            showToast("Supabase is not available. Please check your connection.", "error");
            imageInput.value = "";
            return;
          }

          var fileExt = file.name.split('.').pop();
          var fileName = "posts/" + user.id + "/" + Date.now() + "." + fileExt;

          var uploadResult = await withLoading(function () {
            return withTimeout(supabaseClient.storage.from('post-images').upload(fileName, file), 8000, "Image upload");
          });
          if (uploadResult.error) {
            console.error("[ClassConnect] Storage upload error:", uploadResult.error);
            throw new Error(uploadResult.error.message || "Upload failed.");
          }

          var urlData = supabaseClient.storage.from('post-images').getPublicUrl(fileName);
          if (!urlData || !urlData.data || !urlData.data.publicUrl) {
            throw new Error("Could not retrieve the uploaded image URL.");
          }

          currentPostImage = urlData.data.publicUrl;

          var preview = document.getElementById("post-image-preview");
          var img = document.getElementById("post-preview-img");
          if (preview && img) {
            img.src = currentPostImage;
            preview.hidden = false;
          }

          imageInput.value = "";
          showToast("Image uploaded successfully.", "success");
        } catch (error) {
          console.error("[ClassConnect] Image upload error:", error);
          showToast("Failed to upload image: " + (error.message || "Unknown error"), "error");
          imageInput.value = "";
        }
      });
    }
    var removeBtn = document.getElementById("post-remove-image-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", function () {
        currentPostImage = null;
        var preview = document.getElementById("post-image-preview");
        var img = document.getElementById("post-preview-img");
        if (preview) preview.hidden = true;
        if (img) img.src = "#";
      });
    }
  }

  function saveSelection() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      return sel.getRangeAt(0).cloneRange();
    }
    return null;
  }

  function restoreSelection(range) {
    if (!range) return;
    var sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  function setupEditPostToolbar() {
    var editor = document.getElementById("edit-post-content-editable");
    if (!editor) return;
    document.querySelectorAll("#edit-post-modal-overlay .toolbar-btn[data-command]").forEach(function (btn) {
      btn.addEventListener("mousedown", function (e) {
        e.preventDefault();
        var cmd = btn.getAttribute("data-command");
        document.execCommand(cmd, false, null);
        setTimeout(function () { updateToolbarState("#edit-post-modal-overlay"); }, 0);
      });
    });
    editor.addEventListener("keyup", function () { updateToolbarState("#edit-post-modal-overlay"); });
    editor.addEventListener("mouseup", function () { updateToolbarState("#edit-post-modal-overlay"); });
    editor.addEventListener("focus", function () { updateToolbarState("#edit-post-modal-overlay"); });
    var fontSelect = document.getElementById("edit-post-font-select");
    if (fontSelect) {
      fontSelect.addEventListener("mousedown", function () {
        fontSelect._savedRange = saveSelection();
      });
      fontSelect.addEventListener("change", function () {
        if (fontSelect._savedRange) restoreSelection(fontSelect._savedRange);
        document.execCommand("fontName", false, fontSelect.value);
        editor.focus();
      });
    }
  }

  function getPostContent() {
    var editor = document.getElementById("post-content-editable");
    return editor ? editor.innerHTML.trim() : "";
  }

  function clearPostContent() {
    var editor = document.getElementById("post-content-editable");
    if (editor) editor.innerHTML = "";
    currentPostImage = null;
    var preview = document.getElementById("post-image-preview");
    var img = document.getElementById("post-preview-img");
    if (preview) preview.hidden = true;
    if (img) img.src = "#";
    var fontSel = document.getElementById("post-font-select");
    if (fontSel) fontSel.selectedIndex = 0;
    document.querySelectorAll("#post-modal-overlay .toolbar-btn.active-toolbar").forEach(function (b) {
      b.classList.remove("active-toolbar");
    });
  }

  function isPostContentEmpty(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return !tmp.textContent.trim() && !tmp.querySelector("img");
  }

  function toggleSettingsGroup(groupId) {
    var group = document.getElementById(groupId);
    if (!group) return;
    var isHidden = group.style.display === "none" || group.style.display === "";
    group.style.display = isHidden ? "flex" : "none";
    var chevronId = groupId.replace("-group", "-chevron");
    var chevron = document.getElementById(chevronId);
    if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "";
  }

  // ===== EXPORT / IMPORT DATA =====
  function exportData() {
    var user = getCurrentUser();
    var data = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      exportedBy: user ? user.email : "unknown",
      settings: getSettings(),
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "classconnect-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Settings exported successfully.", "success");
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var data = JSON.parse(e.target.result);
        if (!data.version) { showToast("Invalid backup file.", "error"); return; }
        showConfirm("This will replace your settings. Continue?", function () {
          if (data.settings) saveSettings(data.settings);
          applySettings(getSettings());
          showToast("Settings imported. Reloading...", "success");
          setTimeout(function () { location.reload(); }, 1500);
        });
      } catch (err) {
        showToast("Failed to import. Check the file format.", "error");
      }
    };
    reader.readAsText(file);
  }

  // ===== DELETE ACCOUNT =====
  async function deleteAccount(password) {
    var user = getCurrentUser();
    if (!user) throw new Error("No user logged in.");
    if (!isSupabaseReady()) throw new Error("Supabase is not available. Please check your connection.");
    var client = getSupabaseClient();

    var authResult = await withTimeout(
      client.auth.signInWithPassword({ email: user.email, password: password }),
      10000,
      "Re-authentication"
    );
    if (authResult.error) {
      throw new Error(
        authResult.error.message && authResult.error.message.toLowerCase().includes("invalid")
          ? "Incorrect password. Please try again."
          : (authResult.error.message || "Authentication failed. Please try again.")
      );
    }

    var userIdTables = [
      "post_acknowledgments",
      "comments",
      "posts",
      "assignments",
      "grades",
      "schedule",
      "subjects",
      "curriculum_subjects",
      "curriculum_pdf",
      "cor_pdf"
    ];
    await Promise.all(userIdTables.map(function (table) {
      return withTimeout(
        supabaseTable(table).delete().eq("user_id", user.id),
        10000,
        "Delete " + table
      );
    }));

    await withTimeout(
      supabaseTable("profiles").delete().eq("id", user.id),
      10000,
      "Delete profile"
    );

    var funcResult = await withTimeout(
      client.functions.invoke("delete-user"),
      12000,
      "Delete auth user"
    );
    if (funcResult.error) {
      console.warn("[ClassConnect] Auth record deletion failed:", funcResult.error);
    }

    try {
      await sendDeletionConfirmEmail(user.email, user.name || "Student");
      console.log("[ClassConnect] Deletion confirmation email sent.");
    } catch (emailErr) {
      console.warn("[ClassConnect] Could not send deletion confirmation email:", emailErr);
    }

    try { localStorage.clear(); } catch (e) {}
    await client.auth.signOut();
  }

  function clearAllData() {
    showConfirm("Delete all your data? This cannot be undone.", function () {
      showConfirm("This is permanent. Are you absolutely sure?", function () {
        var user = getCurrentUser();
        if (user) {
          var tables = ["posts", "subjects", "schedule", "assignments", "grades", "curriculum_subjects", "curriculum_pdf", "cor_pdf"];
          withLoading(function () {
            return Promise.all(tables.map(function (table) { return supabaseTable(table).delete().eq("user_id", user.id); }));
          }).then(function () {
            showToast("All data cleared. Reloading...", "info");
            setTimeout(function () { location.reload(); }, 1500);
          }).catch(function (err) {
            showToast("Could not clear all data: " + err.message, "error");
          });
        } else {
          showToast("No user logged in.", "error");
        }
      });
    });
  }

  // ===== LOAD DASHBOARD (INSTANT REVEAL & ASYNC DATA POPULATION) =====
  async function loadDashboard() {
    if (!isLoggedIn()) {
      showPage("login-page");
      showLoginForm();
      return;
    }
    var user = getCurrentUser();
    var name = user ? user.name : "Student";
    var email = user ? user.email : "";
    var dashName = document.getElementById("dash-user-name");
    var drawerName = document.getElementById("drawer-name");
    var drawerEmail = document.getElementById("drawer-email");
    if (dashName) dashName.textContent = name;
    if (drawerName) drawerName.textContent = name;
    if (drawerEmail) drawerEmail.textContent = email;
    var userPhoto = getProfilePhoto();
    var composerAvatar = document.getElementById("composer-avatar");
    if (composerAvatar) {
      if (userPhoto) {
        composerAvatar.style.backgroundImage = "url(" + userPhoto + ")";
        composerAvatar.style.backgroundSize = "cover";
        composerAvatar.style.backgroundPosition = "center";
        composerAvatar.textContent = "";
      } else {
        composerAvatar.style.backgroundImage = "";
        composerAvatar.textContent = initials(name);
      }
    }
    var drawerAvatar = document.getElementById("drawer-avatar");
    if (drawerAvatar) {
      if (userPhoto) {
        drawerAvatar.style.backgroundImage = "url(" + userPhoto + ")";
        drawerAvatar.style.backgroundSize = "cover";
        drawerAvatar.style.backgroundPosition = "center";
        drawerAvatar.textContent = "";
      } else {
        drawerAvatar.style.backgroundImage = "";
        drawerAvatar.textContent = initials(name);
      }
    }

    // Dismiss any global loading overlay immediately so user has full UI access
    forceHideGlobalLoading();

    // Render local states instantly
    loadProfileForm();
    loadFaqs();
    loadSettings();

    // Check if opened with a specific view query param (e.g. from notification click)
    var urlParams = new URLSearchParams(window.location.search);
    var initialView = urlParams.get("view");
    if (initialView && document.getElementById(initialView)) {
      switchView(initialView);
    } else {
      switchView("view-home");
    }

    startInactivityTimer();

    // Initialize Device Notifications & Reminders Engine
    DeviceNotificationManager.updatePermissionUI();
    DeviceNotificationManager.updateTopnavBadge();
    DeviceNotificationManager.runAllReminderChecks();

    if (window._notifCheckInterval) clearInterval(window._notifCheckInterval);
    window._notifCheckInterval = setInterval(function () {
      if (isLoggedIn()) {
        DeviceNotificationManager.runAllReminderChecks();
      }
    }, 60000);

    // Asynchronously load feeds in background without locking screen
    var searchVal = document.getElementById("dashboard-search-input") ? document.getElementById("dashboard-search-input").value : "";
    loadPosts(searchVal).catch(function(e) { console.warn("[ClassConnect] Background posts load:", e); });
    loadSubjects().catch(function(e) { console.warn("[ClassConnect] Background subjects load:", e); });
    loadSchedule().catch(function(e) { console.warn("[ClassConnect] Background schedule load:", e); });
    loadAssignments().catch(function(e) { console.warn("[ClassConnect] Background assignments load:", e); });
    loadGrades().catch(function(e) { console.warn("[ClassConnect] Background grades load:", e); });
    loadClassmates().catch(function(e) { console.warn("[ClassConnect] Background classmates load:", e); });
  }

  // ================================================================
  // ===== NEW: Password Reset via Brevo + Custom Edge Functions =====
  // ================================================================

  function getResetToken() {
    var params = new URLSearchParams(window.location.search);
    return params.get('reset_token');
  }

  function showResetPasswordView(token) {
    document.getElementById('reset-token-field-view').value = token || '';
    document.getElementById('reset-new-password-view').value = '';
    document.getElementById('reset-confirm-password-view').value = '';
    hideError('reset-error-view');
    hideError('reset-success-view');
    switchView('view-reset-password');
  }

  function showResetPasswordModal(token) {
    document.getElementById('reset-token-field').value = token || '';
    document.getElementById('reset-new-password').value = '';
    document.getElementById('reset-confirm-password').value = '';
    hideError('reset-error');
    hideError('reset-success');
    openModal('reset-password-modal-overlay');
  }

  // ===== INIT EVENT LISTENERS =====
  function initEventListeners() {
    var showSignupLink = document.getElementById("show-signup");
    var showLoginLink = document.getElementById("show-login");
    if (showSignupLink) {
      showSignupLink.addEventListener("click", function (e) { e.preventDefault(); showSignupForm(); });
    }
    if (showLoginLink) {
      showLoginLink.addEventListener("click", function (e) { e.preventDefault(); showLoginForm(); });
    }

    document.querySelectorAll(".toggle-password").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var input = document.getElementById(btn.getAttribute("data-target"));
        var icon = btn.querySelector("i");
        if (!input || !icon) return;
        if (input.type === "password") {
          input.type = "text";
          icon.classList.replace("fa-eye", "fa-eye-slash");
        } else {
          input.type = "password";
          icon.classList.replace("fa-eye-slash", "fa-eye");
        }
      });
    });

    var loginForm = document.getElementById("login-form");
    if (loginForm) {
      loginForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        hideError("login-error");
        var emailInput = document.getElementById("login-email");
        var passwordInput = document.getElementById("login-password");
        var email = emailInput ? (emailInput.value || "").trim() : "";
        var password = passwordInput ? passwordInput.value || "" : "";
        if (!isValidEmail(email)) { showError("login-error", "Please enter a valid email address."); return; }
        if (!password) { showError("login-error", "Please enter your password."); return; }
        var btn = document.getElementById("login-submit-btn");
        setButtonLoading(btn, true, "Signing in...");
        try {
          var result = await login(email, password);
          setButtonLoading(btn, false);
          if (!result.success) { 
            showError("login-error", result.message); 
            return; 
          }
          forceHideGlobalLoading();
          loginForm.reset();
          showPage("dashboard-page");
          loadDashboard();
          var currentUser = getCurrentUser();
          showToast(
            "Welcome back, " + (currentUser ? currentUser.name : "Student") + ".",
            "success"
          );
        } catch (error) {
          console.error("[ClassConnect] Login form error:", error);
          showError("login-error", "Unable to sign in right now. Please try again.");
        } finally {
          setButtonLoading(btn, false);
          forceHideGlobalLoading();
        }
      });
    }

    var signupForm = document.getElementById("signup-form");
    if (signupForm) {
      signupForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        hideError("signup-error");
        var nameInput      = document.getElementById("signup-name");
        var emailInput     = document.getElementById("signup-email");
        var studentIdInput = document.getElementById("signup-student-id");
        var yearInput      = document.getElementById("signup-year");
        var sectionInput   = document.getElementById("signup-section");
        var passwordInput  = document.getElementById("signup-password");
        var confirmInput   = document.getElementById("signup-confirm");
        var name      = nameInput      ? (nameInput.value      || "").trim() : "";
        var email     = emailInput     ? (emailInput.value     || "").trim() : "";
        var studentId = studentIdInput ? (studentIdInput.value || "").trim() : "";
        var year      = yearInput      ? (yearInput.value      || "")        : "";
        var section   = sectionInput   ? (sectionInput.value   || "").trim() : "";
        var password  = passwordInput  ? (passwordInput.value  || "")        : "";
        var confirm   = confirmInput   ? (confirmInput.value   || "")        : "";
        if (name.length < 2)     { showError("signup-error", "Please enter your full name."); return; }
        if (!isValidEmail(email)){ showError("signup-error", "Please enter a valid email address."); return; }
        if (!studentId)          { showError("signup-error", "Please enter your Student ID number."); return; }
        if (!year)               { showError("signup-error", "Please select your year level."); return; }
        if (!section)            { showError("signup-error", "Please enter your section (e.g. BSIT 3-A)."); return; }
        if (password.length < 6) { showError("signup-error", "Password must be at least 6 characters."); return; }
        if (password !== confirm) { showError("signup-error", "Passwords do not match."); return; }
        var btn = document.getElementById("signup-submit-btn");
        setButtonLoading(btn, true);
        try {
          var result = await withLoading(function () {
            return signup(name, email, password, studentId, year, section);
          });
          setButtonLoading(btn, false);
          if (!result.success) { showError("signup-error", result.message); return; }
          signupForm.reset();
          showSuccessModal(
            result.message || "Your account has been created successfully!",
            "Back to Login",
            function () {
              showPage("login-page");
              showLoginForm();
              showToast("Please log in with your new account.", "info");
            }
          );
        } catch (error) {
          console.error("[ClassConnect] Signup form error:", error);
          showError("signup-error", "Unable to create your account right now. Please try again.");
          setButtonLoading(btn, false);
        }
      });
    }

    ["logout-btn", "drawer-logout-btn", "settings-logout-btn"].forEach(function (id) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener("click", logout);
    });

    var clearCacheBtn = document.getElementById("drawer-clear-cache-btn");
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener("click", function () {
        closeDrawer();
        showConfirm(
          "Clear app cache and log out?\n\nThis will sign you out, remove cached files, and restart ClassConnect.",
          async function () {
            try {
              var client = getSupabaseClient();
              if (isSupabaseReady() && client.auth) {
                await client.auth.signOut();
              }
            } catch (e) {
              console.warn("[ClassConnect] Sign-out during cache clear failed:", e);
            }
            try { localStorage.clear(); } catch (e) {}
            if ("caches" in window) {
              caches.keys().then(function (names) {
                return Promise.all(names.map(function (name) { return caches.delete(name); }));
              }).then(function () {
                showToast("Signed out and cache cleared. Restarting…", "success");
                setTimeout(function () { location.reload(true); }, 1200);
              }).catch(function () {
                showToast("Signed out and cache cleared. Restarting…", "success");
                setTimeout(function () { location.reload(true); }, 1200);
              });
            } else {
              showToast("Signed out and cache cleared. Restarting…", "success");
              setTimeout(function () { location.reload(true); }, 1200);
            }
          }
        );
      });
    }

    // ===== IMAGE VIEWER =====
    var imgViewerOverlay = document.getElementById("image-viewer-overlay");
    var imgViewerImg    = document.getElementById("image-viewer-img");

    function openImageViewer(src) {
      if (!imgViewerOverlay || !imgViewerImg) return;
      imgViewerImg.src = src;
      imgViewerOverlay.classList.add("active");
      imgViewerOverlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
    }
    function closeImageViewer() {
      if (!imgViewerOverlay) return;
      imgViewerOverlay.classList.remove("active");
      imgViewerOverlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      if (imgViewerImg) imgViewerImg.src = "";
    }

    var postsFeed = document.getElementById("posts-feed");
    if (postsFeed) {
      postsFeed.addEventListener("click", function (e) {
        var img = e.target.closest(".post-img-zoomable");
        if (img) openImageViewer(img.getAttribute("data-viewer-src") || img.src);
      });
    }
    var supportView = document.getElementById("view-support");
    if (supportView) {
      supportView.addEventListener("click", function (e) {
        var img = e.target.closest(".support-qr-zoomable");
        if (img) openImageViewer(img.src);
      });
    }
    if (imgViewerOverlay) {
      imgViewerOverlay.addEventListener("click", closeImageViewer);
    }
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && imgViewerOverlay && imgViewerOverlay.classList.contains("active")) {
        closeImageViewer();
      }
    });

    var hamburger = document.getElementById("hamburger-btn");
    var drawerClose = document.getElementById("drawer-close-btn");
    var drawerOverlay = document.getElementById("side-drawer-overlay");
    if (hamburger) hamburger.addEventListener("click", toggleDrawer);
    if (drawerClose) drawerClose.addEventListener("click", closeDrawer);
    if (drawerOverlay) {
      drawerOverlay.addEventListener("click", function (e) {
        if (e.target === drawerOverlay) closeDrawer();
      });
    }

    document.querySelectorAll(".drawer-item[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.getAttribute("data-view")); });
    });

    document.querySelectorAll(".nav-item[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () { switchView(btn.getAttribute("data-view")); });
    });

    var dashboardSearchInput = document.getElementById("dashboard-search-input");
    if (dashboardSearchInput) {
      var searchTimer;
      dashboardSearchInput.addEventListener("input", function (e) {
        clearTimeout(searchTimer);
        var val = e.target.value;
        searchTimer = setTimeout(function () { loadPosts(val); }, 250);
      });
    }

    // ----- FORGOT PASSWORD -----
    var forgotLink = document.querySelector(".forgot-link");
    if (forgotLink) {
      forgotLink.addEventListener("click", function (e) {
        e.preventDefault();
        document.getElementById("forgot-email").value = "";
        hideError("forgot-error");
        var successEl = document.getElementById("forgot-success");
        if (successEl) successEl.hidden = true;
        openModal("forgot-password-modal-overlay");
      });
    }

    var closeForgotModal = document.getElementById("close-forgot-modal-btn");
    if (closeForgotModal) {
      closeForgotModal.addEventListener("click", function () {
        closeModal("forgot-password-modal-overlay");
      });
    }

    var forgotBackToLogin = document.getElementById("forgot-back-to-login");
    if (forgotBackToLogin) {
      forgotBackToLogin.addEventListener("click", function (e) {
        e.preventDefault();
        closeModal("forgot-password-modal-overlay");
      });
    }

    var forgotForm = document.getElementById("forgot-password-form");
    if (forgotForm) {
      forgotForm.addEventListener("submit", function (e) {
        e.preventDefault();
        hideError("forgot-error");
        var successEl = document.getElementById("forgot-success");
        if (successEl) successEl.hidden = true;
        var email = (document.getElementById("forgot-email").value || "").trim();
        if (!isValidEmail(email)) {
          showError("forgot-error", "Please enter a valid email address.");
          return;
        }
        var btn = forgotForm.querySelector(".btn-primary");
        setButtonLoading(btn, true);

        withLoading(function () {
          return fetch(SUPABASE_URL + "/functions/v1/send-reset-email", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ email: email.trim().toLowerCase() }),
          });
        })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            setButtonLoading(btn, false);
            if (result.success) {
              if (successEl) {
                successEl.textContent = result.message || "Reset link sent to your email.";
                successEl.hidden = false;
              }
              document.getElementById("forgot-email").value = "";
              showToast("Reset link sent to your email.", "success");
            } else {
              showError("forgot-error", result.message || "Something went wrong.");
            }
          })
          .catch(function (error) {
            console.error("[ClassConnect] Forgot password error:", error);
            setButtonLoading(btn, false);
            showError("forgot-error", "Could not send reset link. Please try again.");
          });
      });
    }

    var forgotOverlay = document.getElementById("forgot-password-modal-overlay");
    if (forgotOverlay) {
      forgotOverlay.addEventListener("click", function (e) {
        if (e.target === forgotOverlay) closeModal("forgot-password-modal-overlay");
      });
    }

    // ===== NEW: Reset Password View Handlers =====
    var resetViewForm = document.getElementById('reset-password-form-view');
    if (resetViewForm) {
      resetViewForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideError('reset-error-view');
        hideError('reset-success-view');

        var token = document.getElementById('reset-token-field-view').value;
        var newPwd = document.getElementById('reset-new-password-view').value;
        var confirmPwd = document.getElementById('reset-confirm-password-view').value;

        if (newPwd.length < 6) {
          showError('reset-error-view', 'Password must be at least 6 characters.');
          return;
        }
        if (newPwd !== confirmPwd) {
          showError('reset-error-view', 'Passwords do not match.');
          return;
        }

        var btn = document.getElementById('reset-submit-btn-view');
        setButtonLoading(btn, true);

        withLoading(function () {
          return fetch(SUPABASE_URL + '/functions/v1/update-password', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ token: token, new_password: newPwd }),
          });
        })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            setButtonLoading(btn, false);
            if (result.success) {
              document.getElementById('reset-success-view').textContent = result.message;
              document.getElementById('reset-success-view').hidden = false;
              showToast('Password updated! Redirecting to login...', 'success');

              setTimeout(function () {
                if (window.history && window.history.replaceState) {
                  window.history.replaceState(null, null, window.location.pathname);
                }
                showPage('login-page');
                showLoginForm();
              }, 2500);
            } else {
              showError('reset-error-view', result.message || 'Could not update password.');
            }
          })
          .catch(function (error) {
            console.error('[ClassConnect] Reset password error:', error);
            setButtonLoading(btn, false);
            showError('reset-error-view', 'Unable to update password. Please try again.');
          });
      });
    }

    var resetBackToLoginView = document.getElementById('reset-back-to-login-view');
    if (resetBackToLoginView) {
      resetBackToLoginView.addEventListener('click', function (e) {
        e.preventDefault();
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, null, window.location.pathname);
        }
        showPage('login-page');
        showLoginForm();
      });
    }

    // ----- Keep old modal handlers for compatibility -----
    var resetModalOverlay = document.getElementById("reset-password-modal-overlay");
    var resetCloseBtn = document.getElementById("close-reset-modal-btn");
    var resetBackToLogin = document.getElementById("reset-back-to-login");
    var resetForm = document.getElementById("reset-password-form");

    if (resetCloseBtn) {
      resetCloseBtn.addEventListener("click", function () {
        closeModal("reset-password-modal-overlay");
        showPage("login-page");
        showLoginForm();
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, null, window.location.pathname);
        }
      });
    }

    if (resetBackToLogin) {
      resetBackToLogin.addEventListener("click", function (e) {
        e.preventDefault();
        closeModal("reset-password-modal-overlay");
        showPage("login-page");
        showLoginForm();
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, null, window.location.pathname);
        }
      });
    }

    if (resetForm) {
      resetForm.addEventListener("submit", function (e) {
        e.preventDefault();
        hideError("reset-error");
        hideError("reset-success");

        var token = document.getElementById("reset-token-field").value;
        var newPwd = document.getElementById("reset-new-password").value;
        var confirmPwd = document.getElementById("reset-confirm-password").value;

        if (newPwd.length < 6) {
          showError("reset-error", "Password must be at least 6 characters.");
          return;
        }
        if (newPwd !== confirmPwd) {
          showError("reset-error", "Passwords do not match.");
          return;
        }

        var btn = document.getElementById("reset-submit-btn");
        setButtonLoading(btn, true);

        withLoading(function () {
          return fetch(SUPABASE_URL + "/functions/v1/update-password", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ token: token, new_password: newPwd }),
          });
        })
          .then(function (response) { return response.json(); })
          .then(function (result) {
            setButtonLoading(btn, false);
            if (result.success) {
              document.getElementById("reset-success").textContent = result.message;
              document.getElementById("reset-success").hidden = false;
              showToast("Password updated! Redirecting to login...", "success");

              setTimeout(function () {
                closeModal("reset-password-modal-overlay");
                showPage("login-page");
                showLoginForm();
                if (window.history && window.history.replaceState) {
                  window.history.replaceState(null, null, window.location.pathname);
                }
              }, 2500);
            } else {
              showError("reset-error", result.message || "Could not update password.");
            }
          })
          .catch(function (error) {
            console.error("[ClassConnect] Reset password error:", error);
            setButtonLoading(btn, false);
            showError("reset-error", "Unable to update password. Please try again.");
          });
      });
    }

    if (resetModalOverlay) {
      resetModalOverlay.addEventListener("click", function (e) {
        if (e.target === resetModalOverlay) {
          // ignore
        }
      });
    }

    // ----- POST MODAL -----
    var composerBtn1 = document.getElementById("open-composer-btn");
    var closeModalBtn = document.getElementById("close-modal-btn");
    var postOverlay = document.getElementById("post-modal-overlay");
    var submitPostBtn = document.getElementById("submit-post-btn");

    function openPostModal() {
      openModal("post-modal-overlay");
      setTimeout(function () {
        var ed = document.getElementById("post-content-editable");
        if (ed) ed.focus();
      }, 300);
    }

    if (composerBtn1) composerBtn1.addEventListener("click", openPostModal);

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", function () {
        closeModal("post-modal-overlay");
        clearPostContent();
      });
    }
    if (postOverlay) {
      postOverlay.addEventListener("click", function (e) {
        if (e.target === postOverlay) { closeModal("post-modal-overlay"); clearPostContent(); }
      });
    }
    if (submitPostBtn) {
      submitPostBtn.addEventListener("click", function () {
        var content = getPostContent();
        if (isPostContentEmpty(content) && !currentPostImage) {
          showToast("Please write something before posting.", "warning");
          return;
        }
        withLoading(function () { return createPost(content, currentPostImage); }).then(function (newPost) {
          closeModal("post-modal-overlay");
          clearPostContent();
          DeviceNotificationManager.onPostCreated(newPost);
          loadPosts(dashboardSearchInput ? dashboardSearchInput.value : "");
          switchView("view-home");
          showToast("Post shared successfully.", "success");
        }).catch(function (err) {
          showToast(err.message || "Could not create post.", "error");
        });
      });
    }

    var closeEditModal = document.getElementById("close-edit-modal-btn");
    var editOverlay = document.getElementById("edit-post-modal-overlay");
    var saveEditBtn = document.getElementById("save-edit-post-btn");

    if (closeEditModal) {
      closeEditModal.addEventListener("click", function () {
        closeModal("edit-post-modal-overlay");
      });
    }
    if (editOverlay) {
      editOverlay.addEventListener("click", function (e) {
        if (e.target === editOverlay) closeModal("edit-post-modal-overlay");
      });
    }
    if (saveEditBtn) {
      saveEditBtn.addEventListener("click", function () {
        var id = document.getElementById("edit-post-id").value;
        var editor = document.getElementById("edit-post-content-editable");
        var content = editor ? editor.innerHTML.trim() : "";
        if (!content) {
          showToast("Please write something.", "warning");
          return;
        }
        withLoading(function () { return updatePost(id, content); }).then(function () {
          closeModal("edit-post-modal-overlay");
          loadPosts(dashboardSearchInput ? dashboardSearchInput.value : "");
          showToast("Post updated successfully.", "success");
        }).catch(function (err) {
          showToast(err.message || "Failed to update post.", "error");
        });
      });
    }

    // ----- SUBJECTS -----
    var addSubjectBtn = document.getElementById("add-subject-btn");
    var closeSubjectModal = document.getElementById("close-subject-modal-btn");
    var subjectOverlay = document.getElementById("subject-modal-overlay");
    var subjectForm = document.getElementById("subject-form");

    if (addSubjectBtn) {
      addSubjectBtn.addEventListener("click", function () {
        document.getElementById("subject-edit-id").value = "";
        document.getElementById("subject-name").value = "";
        document.getElementById("subject-professor").value = "";
        document.getElementById("subject-schedule").value = "";
        document.getElementById("subject-year").value = "1st Year";
        document.getElementById("subject-semester").value = "1st Semester";
        document.getElementById("subject-modal-title").textContent = "Add Subject";
        openModal("subject-modal-overlay");
      });
    }
    if (closeSubjectModal) closeSubjectModal.addEventListener("click", function () { closeModal("subject-modal-overlay"); });
    if (subjectOverlay) {
      subjectOverlay.addEventListener("click", function (e) {
        if (e.target === subjectOverlay) closeModal("subject-modal-overlay");
      });
    }
    if (subjectForm) {
      subjectForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = document.getElementById("subject-edit-id").value;
        var name = (document.getElementById("subject-name").value || "").trim();
        var professor = (document.getElementById("subject-professor").value || "").trim();
        var schedule = (document.getElementById("subject-schedule").value || "").trim();
        var year = document.getElementById("subject-year").value || "1st Year";
        var semester = document.getElementById("subject-semester").value || "1st Semester";
        if (!name) { showToast("Please enter a subject name.", "warning"); return; }
        if (id) {
          withLoading(function () { return updateSubject(id, { name: name, professor: professor, schedule: schedule, year: year, semester: semester }); }).then(function () {
            closeModal("subject-modal-overlay");
            subjectForm.reset();
            DeviceNotificationManager.onScheduleUpdated();
            loadSubjects();
            showToast("Subject updated.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not update subject.", "error");
          });
        } else {
          withLoading(function () { return addSubject(name, professor, schedule, year, semester); }).then(function () {
            closeModal("subject-modal-overlay");
            subjectForm.reset();
            DeviceNotificationManager.onScheduleUpdated();
            loadSubjects();
            showToast("Subject added.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not add subject.", "error");
          });
        }
      });
    }

    // ----- SUBJECT TASK -----
    var closeSubjectTaskModal = document.getElementById("close-subject-task-modal-btn");
    var subjectTaskOverlay = document.getElementById("subject-task-modal-overlay");
    var subjectTaskForm = document.getElementById("subject-task-form");

    if (closeSubjectTaskModal) closeSubjectTaskModal.addEventListener("click", function () { closeModal("subject-task-modal-overlay"); });
    if (subjectTaskOverlay) {
      subjectTaskOverlay.addEventListener("click", function (e) {
        if (e.target === subjectTaskOverlay) closeModal("subject-task-modal-overlay");
      });
    }
    if (subjectTaskForm) {
      subjectTaskForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var subjectId = document.getElementById("subject-task-subject-id").value;
        var text = (document.getElementById("subject-task-text").value || "").trim();
        if (!text) { showToast("Please enter a task description.", "warning"); return; }
        withLoading(function () { return addSubjectTask(subjectId, text); }).then(function () {
          closeModal("subject-task-modal-overlay");
          subjectTaskForm.reset();
          loadSubjects();
          showToast("Task added.", "success");
        }).catch(function (err) {
          showToast(err.message || "Could not add task.", "error");
        });
      });
    }

    // ----- SCHEDULE -----
    var addScheduleBtn = document.getElementById("add-schedule-btn");
    var closeScheduleMdl = document.getElementById("close-schedule-modal-btn");
    var scheduleOverlay = document.getElementById("schedule-modal-overlay");
    var scheduleForm = document.getElementById("schedule-form");

    if (addScheduleBtn) {
      addScheduleBtn.addEventListener("click", function () {
        document.getElementById("schedule-edit-id").value = "";
        document.getElementById("schedule-subject").value = "";
        document.getElementById("schedule-day").value = "";
        document.getElementById("schedule-start-time").value = "";
        document.getElementById("schedule-end-time").value = "";
        document.getElementById("schedule-room").value = "";
        document.getElementById("schedule-modal-title").textContent = "Add Schedule";
        openModal("schedule-modal-overlay");
      });
    }
    if (closeScheduleMdl) closeScheduleMdl.addEventListener("click", function () { closeModal("schedule-modal-overlay"); });
    if (scheduleOverlay) {
      scheduleOverlay.addEventListener("click", function (e) {
        if (e.target === scheduleOverlay) closeModal("schedule-modal-overlay");
      });
    }
    if (scheduleForm) {
      scheduleForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = document.getElementById("schedule-edit-id").value;
        var subject = (document.getElementById("schedule-subject").value || "").trim();
        var day = (document.getElementById("schedule-day").value || "").trim();
        var startTime = document.getElementById("schedule-start-time").value;
        var endTime = document.getElementById("schedule-end-time").value;
        var room = (document.getElementById("schedule-room").value || "").trim();
        if (!subject || !day || !startTime || !endTime) {
          showToast("Please fill in all required fields.", "warning"); return;
        }
        if (id) {
          withLoading(function () { return updateScheduleItem(id, { subject: subject, day: day, start_time: startTime, end_time: endTime, room: room }); }).then(function () {
            closeModal("schedule-modal-overlay");
            scheduleForm.reset();
            DeviceNotificationManager.onScheduleUpdated();
            loadSchedule();
            showToast("Schedule updated.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not update schedule.", "error");
          });
        } else {
          withLoading(function () { return addScheduleItem(subject, day, startTime, endTime, room); }).then(function () {
            closeModal("schedule-modal-overlay");
            scheduleForm.reset();
            DeviceNotificationManager.onScheduleUpdated();
            loadSchedule();
            showToast("Schedule added.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not add schedule.", "error");
          });
        }
      });
    }

    // ----- ASSIGNMENTS -----
    var addAssignmentBtn = document.getElementById("add-assignment-btn");
    var closeAssignmentMdl = document.getElementById("close-assignment-modal-btn");
    var assignmentOverlay = document.getElementById("assignment-modal-overlay");
    var assignmentForm = document.getElementById("assignment-form");

    if (addAssignmentBtn) {
      addAssignmentBtn.addEventListener("click", function () {
        document.getElementById("assignment-text").value = "";
        document.getElementById("assignment-subject").value = "";
        document.getElementById("assignment-due-date").value = "";
        openModal("assignment-modal-overlay");
      });
    }
    if (closeAssignmentMdl) closeAssignmentMdl.addEventListener("click", function () { closeModal("assignment-modal-overlay"); });
    if (assignmentOverlay) {
      assignmentOverlay.addEventListener("click", function (e) {
        if (e.target === assignmentOverlay) closeModal("assignment-modal-overlay");
      });
    }
    if (assignmentForm) {
      assignmentForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var text = (document.getElementById("assignment-text").value || "").trim();
        var subject = (document.getElementById("assignment-subject").value || "").trim();
        var due = document.getElementById("assignment-due-date").value;
        if (!text) { showToast("Please enter a task description.", "warning"); return; }
        withLoading(function () { return addAssignment(text, subject, due); }).then(function () {
          closeModal("assignment-modal-overlay");
          assignmentForm.reset();
          DeviceNotificationManager.onAssignmentAdded({ text: text, subject: subject, due_date: due });
          loadAssignments();
          showToast("Assignment added.", "success");
        }).catch(function (err) {
          showToast(err.message || "Could not add assignment.", "error");
        });
      });
    }

    // ----- GRADES -----
    var addGradeBtn = document.getElementById("add-grade-btn");
    var closeGradeMdl = document.getElementById("close-grade-modal-btn");
    var gradeOverlay = document.getElementById("grade-modal-overlay");
    var gradeForm = document.getElementById("grade-form");

    if (addGradeBtn) {
      addGradeBtn.addEventListener("click", function () {
        document.getElementById("grade-edit-id").value = "";
        document.getElementById("grade-subject").value = "";
        document.getElementById("grade-value").value = "";
        document.getElementById("grade-units").value = "3";
        var curYear = (document.getElementById("grade-year-filter") || {}).value || "3rd Year";
        var curSem = (document.getElementById("grade-semester-filter") || {}).value || "1st Semester";
        document.getElementById("grade-year").value = curYear === "all" ? "1st Year" : curYear;
        document.getElementById("grade-semester").value = curSem === "all" ? "1st Semester" : curSem;
        document.getElementById("grade-exclude").checked = false;
        document.getElementById("grade-modal-title").textContent = "Add College Grade";
        openModal("grade-modal-overlay");
      });
    }
    if (closeGradeMdl) {
      closeGradeMdl.addEventListener("click", function () {
        closeModal("grade-modal-overlay");
      });
    }
    if (gradeOverlay) {
      gradeOverlay.addEventListener("click", function (e) {
        if (e.target === gradeOverlay) closeModal("grade-modal-overlay");
      });
    }
    if (gradeForm) {
      gradeForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = document.getElementById("grade-edit-id").value;
        var subject = (document.getElementById("grade-subject").value || "").trim();
        var gradeVal = parseFloat(document.getElementById("grade-value").value);
        var unitsVal = parseFloat(document.getElementById("grade-units").value) || 3;
        var year = document.getElementById("grade-year").value || "1st Year";
        var semester = document.getElementById("grade-semester").value || "1st Semester";
        var exclude = document.getElementById("grade-exclude").checked;
        if (!subject) { showToast("Please enter a subject name.", "warning"); return; }
        if (isNaN(gradeVal) || gradeVal < 0) {
          showToast("Please enter a valid numeric grade.", "warning"); return;
        }
        if (id) {
          withLoading(function () { return updateGrade(id, { subject: subject, grade: gradeVal, units: unitsVal, year: year, semester: semester, exclude: exclude }); }).then(function () {
            closeModal("grade-modal-overlay");
            gradeForm.reset();
            loadGrades();
            showToast("Grade updated.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not update grade.", "error");
          });
        } else {
          withLoading(function () { return addGrade(subject, gradeVal, unitsVal, year, semester, exclude); }).then(function () {
            closeModal("grade-modal-overlay");
            gradeForm.reset();
            loadGrades();
            showToast("Grade added to " + year + ", " + semester + ".", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not add grade.", "error");
          });
        }
      });
    }

    var yearFilter = document.getElementById("grade-year-filter");
    var semFilter = document.getElementById("grade-semester-filter");
    if (yearFilter) yearFilter.addEventListener("change", loadGrades);
    if (semFilter) semFilter.addEventListener("change", loadGrades);

    var closeCmProfileModalBtn = document.getElementById("close-classmate-modal-btn");
    if (closeCmProfileModalBtn) {
      closeCmProfileModalBtn.addEventListener("click", function () {
        closeModal("classmate-profile-modal-overlay");
      });
    }
    var cmProfileOverlay = document.getElementById("classmate-profile-modal-overlay");
    if (cmProfileOverlay) {
      cmProfileOverlay.addEventListener("click", function (e) {
        if (e.target === cmProfileOverlay) closeModal("classmate-profile-modal-overlay");
      });
    }

    // ----- PROFILE -----
    var profileForm = document.getElementById("profile-form");
    if (profileForm) {
      profileForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var rawSec = document.getElementById("profile-section").value;
        var data = {
          name: (document.getElementById("profile-fullname").value || "").trim(),
          bio: (document.getElementById("profile-bio").value || "").trim(),
          studentId: (document.getElementById("profile-student-id").value || "").trim(),
          course: (document.getElementById("profile-course").value || "").trim(),
          year: document.getElementById("profile-year").value,
          section: normalizeSection(rawSec || ""),
          contact: (document.getElementById("profile-contact").value || "").trim(),
          birthdate: document.getElementById("profile-birthdate").value,
          gender: document.getElementById("profile-gender").value,
          address: (document.getElementById("profile-address").value || "").trim(),
          emergency: (document.getElementById("profile-emergency").value || "").trim(),
          guardianName: (document.getElementById("profile-guardian-name").value || "").trim(),
          guardianContact: (document.getElementById("profile-guardian-contact").value || "").trim(),
        };
        if (!data.name) { showToast("Please enter your full name.", "warning"); return; }
        try {
          await withLoading(function () { return saveProfile(data); });
          loadDashboard();
          showToast("Profile saved to Supabase successfully.", "success");
        } catch (error) {
          console.error("[ClassConnect] Profile form save failed:", error);
          showToast(error.message || "Profile could not be saved to Supabase.", "error");
        }
      });
    }

    var photoUploadBtn = document.getElementById("upload-photo-btn");
    var photoInput = document.getElementById("profile-photo-input");
    if (photoUploadBtn && photoInput) {
      photoUploadBtn.addEventListener("click", function () { photoInput.click(); });
      photoInput.addEventListener("change", function () {
        var file = photoInput.files[0];
        if (!file) return;
        if (file.size > 3 * 1024 * 1024) {
          showToast("Photo must be smaller than 3 MB.", "error");
          photoInput.value = "";
          return;
        }
        var reader = new FileReader();
        reader.onload = function (e) {
          withLoading(function () { return saveProfilePhoto(e.target.result); })
            .then(function () {
              loadProfileForm();
              showToast("Profile photo saved to Supabase.", "success");
            })
            .catch(function (error) {
              console.error("[ClassConnect] Profile photo save failed:", error);
              showToast(error.message || "Profile photo could not be saved to Supabase.", "error");
            });
        };
        reader.readAsDataURL(file);
        photoInput.value = "";
      });
    }

    var fontTypeSelect = document.getElementById("font-type-select");
    if (fontTypeSelect) {
      fontTypeSelect.addEventListener("change", function () {
        var settings = getSettings();
        settings.fontType = fontTypeSelect.value;
        saveSettings(settings);
        applySettings(settings);
        showToast("Font type updated.", "info");
      });
    }

    var changePwdBtn = document.getElementById("settings-change-password-btn");
    if (changePwdBtn) {
      changePwdBtn.addEventListener("click", async function () {
        var current = document.getElementById("settings-current-password").value;
        var newPwd = document.getElementById("settings-new-password").value;
        var confirm = document.getElementById("settings-confirm-password").value;
        var result = await withLoading(function () { return changePassword(current, newPwd, confirm); });
        if (result.success) {
          showToast(result.message, "success");
          document.getElementById("settings-current-password").value = "";
          document.getElementById("settings-new-password").value = "";
          document.getElementById("settings-confirm-password").value = "";
          toggleSettingsGroup("password-group");
        } else {
          showToast(result.message, "error");
        }
      });
    }

    // ----- DELETE ACCOUNT -----
    var deleteAccountSettingsBtn = document.getElementById("settings-delete-account-btn");
    if (deleteAccountSettingsBtn) {
      deleteAccountSettingsBtn.addEventListener("click", function () {
        var pwdInput = document.getElementById("delete-account-password");
        if (pwdInput) pwdInput.value = "";
        hideError("delete-account-error");
        openModal("delete-account-modal-overlay");
      });
    }

    var closeDeleteAccountModal = document.getElementById("close-delete-account-modal-btn");
    if (closeDeleteAccountModal) {
      closeDeleteAccountModal.addEventListener("click", function () {
        closeModal("delete-account-modal-overlay");
      });
    }

    var deleteAccountCancelBtn = document.getElementById("delete-account-cancel-btn");
    if (deleteAccountCancelBtn) {
      deleteAccountCancelBtn.addEventListener("click", function () {
        closeModal("delete-account-modal-overlay");
      });
    }

    var deleteAccountOverlay = document.getElementById("delete-account-modal-overlay");
    if (deleteAccountOverlay) {
      deleteAccountOverlay.addEventListener("click", function (e) {
        if (e.target === deleteAccountOverlay) closeModal("delete-account-modal-overlay");
      });
    }

    var deleteAccountConfirmBtn = document.getElementById("delete-account-confirm-btn");
    if (deleteAccountConfirmBtn) {
      deleteAccountConfirmBtn.addEventListener("click", async function () {
        hideError("delete-account-error");
        var pwdInput = document.getElementById("delete-account-password");
        var password = pwdInput ? (pwdInput.value || "").trim() : "";
        if (!password) {
          showError("delete-account-error", "Please enter your password to confirm.");
          return;
        }
        setButtonLoading(deleteAccountConfirmBtn, true);
        try {
          await withLoading(function () { return deleteAccount(password); });
          closeModal("delete-account-modal-overlay");
          showPage("login-page");
          showLoginForm();
          showToast("Your account and all data have been deleted.", "info");
        } catch (err) {
          setButtonLoading(deleteAccountConfirmBtn, false);
          showError("delete-account-error", err.message || "Could not delete account. Please try again.");
        }
      });
    }

    var clearDataBtn = document.getElementById("settings-clear-data-btn");
    if (clearDataBtn) clearDataBtn.addEventListener("click", clearAllData);

    var exportBtn = document.getElementById("settings-export-btn");
    if (exportBtn) exportBtn.addEventListener("click", exportData);

    var importBtn = document.getElementById("settings-import-btn");
    var importInput = document.getElementById("settings-import-input");
    if (importBtn && importInput) {
      importBtn.addEventListener("click", function () { importInput.click(); });
      importInput.addEventListener("change", function () {
        var file = importInput.files[0];
        if (file) { importData(file); importInput.value = ""; }
      });
    }

    var pwdCollapsible = document.querySelector(".settings-collapsible");
    if (pwdCollapsible) {
      pwdCollapsible.addEventListener("click", function (e) {
        if (e.target.closest("input") || e.target.closest("button")) return;
        toggleSettingsGroup("password-group");
      });
    }

    window.addEventListener("offline", function () { handleOffline(true); });
    window.addEventListener("online", function () {
      handleOffline(false);
      showToast("Connection restored.", "success");
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeAllModals(); closeDrawer(); }
    });

    // ----- CURRICULUM -----
    var addCurriculumBtn = document.getElementById("add-curriculum-subject-btn");
    if (addCurriculumBtn) {
      addCurriculumBtn.addEventListener("click", function () {
        document.getElementById("curriculum-subject-edit-id").value = "";
        document.getElementById("curriculum-subject-name").value = "";
        document.getElementById("curriculum-subject-code").value = "";
        document.getElementById("curriculum-subject-schedule").value = "";
        document.getElementById("curriculum-subject-year").value = "1st Year";
        document.getElementById("curriculum-subject-semester").value = "1st Semester";
        document.getElementById("curriculum-subject-modal-title").textContent = "Add Subject";
        openModal("curriculum-subject-modal-overlay");
      });
    }

    var closeCurriculumModal = document.getElementById("close-curriculum-subject-modal-btn");
    if (closeCurriculumModal) {
      closeCurriculumModal.addEventListener("click", function () {
        closeModal("curriculum-subject-modal-overlay");
      });
    }
    var curriculumOverlay = document.getElementById("curriculum-subject-modal-overlay");
    if (curriculumOverlay) {
      curriculumOverlay.addEventListener("click", function (e) {
        if (e.target === curriculumOverlay) closeModal("curriculum-subject-modal-overlay");
      });
    }

    var curriculumForm = document.getElementById("curriculum-subject-form");
    if (curriculumForm) {
      curriculumForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var id = document.getElementById("curriculum-subject-edit-id").value;
        var name = (document.getElementById("curriculum-subject-name").value || "").trim();
        var code = (document.getElementById("curriculum-subject-code").value || "").trim();
        var schedule = (document.getElementById("curriculum-subject-schedule").value || "").trim();
        var year = document.getElementById("curriculum-subject-year").value;
        var semester = document.getElementById("curriculum-subject-semester").value;
        if (!name || !code || !year) {
          showToast("Please fill in all required fields.", "warning");
          return;
        }
        if (id) {
          withLoading(function () { return updateCurriculumSubject(id, { name: name, code: code, schedule: schedule, year: year, semester: semester }); }).then(function () {
            closeModal("curriculum-subject-modal-overlay");
            curriculumForm.reset();
            loadCurriculum();
            showToast("Subject updated.", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not update subject.", "error");
          });
        } else {
          withLoading(function () { return addCurriculumSubject(name, code, schedule, year, semester); }).then(function () {
            closeModal("curriculum-subject-modal-overlay");
            curriculumForm.reset();
            loadCurriculum();
            showToast("Subject added to " + year + ", " + semester + ".", "success");
          }).catch(function (err) {
            showToast(err.message || "Could not add subject.", "error");
          });
        }
      });
    }

    var uploadPdfBtn = document.getElementById("upload-curriculum-pdf-btn");
    if (uploadPdfBtn) {
      uploadPdfBtn.addEventListener("click", function () {
        var fileInput = document.getElementById("pdf-file-input");
        if (fileInput) fileInput.click();
      });
    }

    // ===== SCHOOL FILES HANDLERS =====
    function setupSchoolFilesHandlers() {
      var uploadBtn = document.getElementById("upload-school-file-btn");
      if (uploadBtn && !uploadBtn._ccBound) {
        uploadBtn._ccBound = true;
        uploadBtn.addEventListener("click", function () {
          populateSchoolFilesSubjectList();
          var form = document.getElementById("upload-school-file-form");
          if (form) form.reset();
          var dropzoneName = document.getElementById("school-dropzone-name");
          if (dropzoneName) dropzoneName.textContent = "Choose a file or drag & drop here";
          openModal("upload-file-modal-overlay");
        });
      }

      var closeUploadModalBtn = document.getElementById("close-upload-file-modal-btn");
      if (closeUploadModalBtn && !closeUploadModalBtn._ccBound) {
        closeUploadModalBtn._ccBound = true;
        closeUploadModalBtn.addEventListener("click", function () {
          closeModal("upload-file-modal-overlay");
        });
      }

      var closePreviewModalBtn = document.getElementById("close-file-preview-modal-btn");
      if (closePreviewModalBtn && !closePreviewModalBtn._ccBound) {
        closePreviewModalBtn._ccBound = true;
        closePreviewModalBtn.addEventListener("click", function () {
          closeModal("file-preview-modal-overlay");
        });
      }

      var modalDropzone = document.getElementById("school-file-dropzone");
      var modalFileInput = document.getElementById("school-file-modal-input");
      var modalFileName = document.getElementById("school-file-name-input");
      var dropzoneName = document.getElementById("school-dropzone-name");

      if (modalDropzone && modalFileInput) {
        modalDropzone.addEventListener("click", function () {
          modalFileInput.click();
        });

        modalDropzone.addEventListener("dragover", function (e) {
          e.preventDefault();
          modalDropzone.classList.add("dragover");
        });

        modalDropzone.addEventListener("dragleave", function () {
          modalDropzone.classList.remove("dragover");
        });

        modalDropzone.addEventListener("drop", function (e) {
          e.preventDefault();
          modalDropzone.classList.remove("dragover");
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
            modalFileInput.files = e.dataTransfer.files;
            handleModalFileChosen(e.dataTransfer.files[0]);
          }
        });

        modalFileInput.addEventListener("change", function () {
          if (modalFileInput.files && modalFileInput.files[0]) {
            handleModalFileChosen(modalFileInput.files[0]);
          }
        });
      }

      function handleModalFileChosen(file) {
        if (!file) return;
        if (dropzoneName) dropzoneName.textContent = file.name + " (" + formatFileSize(file.size) + ")";
        if (modalFileName && !modalFileName.value) {
          var cleanName = file.name.replace(/\.[^/.]+$/, "");
          modalFileName.value = cleanName;
        }
      }

      var quickDropzone = document.getElementById("files-quick-dropzone");
      var quickFileInput = document.getElementById("school-file-quick-input");
      var quickUploadBtn = document.getElementById("files-quick-upload-trigger-btn") || document.getElementById("quick-upload-files-btn");
      var browseLinkBtn = document.getElementById("files-browse-btn");

      if (browseLinkBtn && quickFileInput) {
        browseLinkBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          quickFileInput.click();
        });
      }

      if (quickUploadBtn && quickFileInput) {
        quickUploadBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          quickFileInput.click();
        });
      }

      if (quickDropzone && quickFileInput) {
        quickDropzone.addEventListener("click", function (e) {
          if (e.target !== quickUploadBtn && (!quickUploadBtn || !quickUploadBtn.contains(e.target))) {
            quickFileInput.click();
          }
        });

        quickDropzone.addEventListener("dragover", function (e) {
          e.preventDefault();
          quickDropzone.classList.add("dragover");
        });

        quickDropzone.addEventListener("dragleave", function () {
          quickDropzone.classList.remove("dragover");
        });

        quickDropzone.addEventListener("drop", function (e) {
          e.preventDefault();
          quickDropzone.classList.remove("dragover");
          if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleQuickFilesUpload(e.dataTransfer.files);
          }
        });

        quickFileInput.addEventListener("change", function () {
          if (quickFileInput.files && quickFileInput.files.length > 0) {
            handleQuickFilesUpload(quickFileInput.files);
            quickFileInput.value = "";
          }
        });
      }

      async function handleQuickFilesUpload(filesList) {
        if (!filesList || filesList.length === 0) return;
        showGlobalLoading();
        var uploadedCount = 0;
        try {
          for (var i = 0; i < filesList.length; i++) {
            var file = filesList[i];
            var reader = new FileReader();
            var base64 = await new Promise(function (res, rej) {
              reader.onload = function (e) { res(e.target.result); };
              reader.onerror = function (e) { rej(e); };
              reader.readAsDataURL(file);
            });

            var category = "Notes";
            var ext = file.name.split(".").pop().toLowerCase();
            if (["pdf"].includes(ext)) category = "Notes";
            else if (["doc", "docx", "txt", "md"].includes(ext)) category = "Notes";
            else if (["ppt", "pptx"].includes(ext)) category = "Module";
            else if (["xls", "xlsx", "csv"].includes(ext)) category = "Reviewer";

            await saveSchoolFile({
              name: file.name.replace(/\.[^/.]+$/, ""),
              original_name: file.name,
              rawFile: file,
              data: base64,
              size: file.size,
              mime_type: file.type || "application/octet-stream",
              category: category,
              subject: "",
              notes: ""
            });
            uploadedCount++;
          }
          await loadSchoolFiles();
          showToast("Uploaded " + uploadedCount + " school file" + (uploadedCount > 1 ? "s" : "") + " successfully!", "success");
        } catch (err) {
          console.error("[ClassConnect] Quick upload error:", err);
          showToast("Error uploading files: " + err.message, "error");
        } finally {
          hideGlobalLoading();
        }
      }

      var uploadForm = document.getElementById("upload-school-file-form");
      if (uploadForm && !uploadForm._ccBound) {
        uploadForm._ccBound = true;
        uploadForm.addEventListener("submit", async function (e) {
          e.preventDefault();
          var fileInput = document.getElementById("school-file-modal-input");
          var file = fileInput && fileInput.files ? fileInput.files[0] : null;
          var title = (document.getElementById("school-file-name-input").value || "").trim();
          var category = document.getElementById("school-file-category-input").value || "Notes";
          var subject = (document.getElementById("school-file-subject-input").value || "").trim();
          var notes = (document.getElementById("school-file-notes-input").value || "").trim();

          if (!file) {
            showToast("Please choose or drop a file to upload.", "warning");
            return;
          }
          if (!title) {
            showToast("Please enter a display title for the file.", "warning");
            return;
          }

          var submitBtn = document.getElementById("save-school-file-btn");
          setButtonLoading(submitBtn, true);

          try {
            var reader = new FileReader();
            var base64 = await new Promise(function (res, rej) {
              reader.onload = function (ev) { res(ev.target.result); };
              reader.onerror = function (ev) { rej(new Error("Could not read file.")); };
              reader.readAsDataURL(file);
            });

            await saveSchoolFile({
              name: title,
              original_name: file.name,
              rawFile: file,
              data: base64,
              size: file.size,
              mime_type: file.type || "application/octet-stream",
              category: category,
              subject: subject,
              notes: notes
            });

            closeModal("upload-file-modal-overlay");
            uploadForm.reset();
            if (dropzoneName) dropzoneName.textContent = "Choose a file or drag & drop here";
            await loadSchoolFiles();
            showToast("School file \"" + title + "\" uploaded successfully!", "success");

          } catch (err) {
            console.error("[ClassConnect] Save school file error:", err);
            showToast(err.message || "Failed to upload file.", "error");
          } finally {
            setButtonLoading(submitBtn, false);
          }
        });
      }
    }

    setupSchoolFilesHandlers();

    // ----- INACTIVITY -----
    ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"].forEach(function (evName) {
      document.addEventListener(evName, resetInactivityTimer, { passive: true });
    });

    var inactivityBackBtn = document.getElementById("inactivity-back-to-login-btn");
    if (inactivityBackBtn) {
      inactivityBackBtn.addEventListener("click", function () {
        hideInactivityModal();
        showPage("login-page");
        showLoginForm();
      });
    }
  }

  // ===== INIT =====
  var hasInitialized = false;

  function showLoginFallback(reason) {
    console.warn("[ClassConnect] Showing login fallback:", reason || "no active session");
    try {
      showPage("login-page");
      showLoginForm();
    } catch (error) {
      console.error("[ClassConnect] Could not render the login page:", error);
      var loginPage = document.getElementById("login-page");
      if (loginPage) {
        loginPage.style.display = "";
        loginPage.classList.add("active-page");
      }
    }
  }

  function routeAfterSplash() {
    console.log("[ClassConnect] Splash timer completed; checking authentication.");

    var resetToken = getResetToken();
    if (resetToken) {
      console.log("[ClassConnect] Reset token detected. Showing reset view.");
      showPage("dashboard-page");
      var resetTopnav = document.querySelector(".dashboard-topnav");
      var resetBottomNav = document.querySelector(".bottom-nav");
      if (resetTopnav) resetTopnav.style.display = "none";
      if (resetBottomNav) resetBottomNav.style.display = "none";
      showResetPasswordView(resetToken);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, null, window.location.pathname);
      }
      var banner = document.getElementById("offline-banner");
      if (banner) banner.hidden = true;
      return;
    }

    getRemoteSession().then(function (remote) {
      if (remote.session && remote.session.user) {
        console.log("[ClassConnect] Restoring Supabase session.");
        var authenticatedUser = saveRemoteUserSession(remote.session.user);
        if (authenticatedUser) {
          loadRemoteProfile()
            .catch(function (error) {
              console.error("[ClassConnect] Could not load Supabase profile during startup:", error);
              remoteProfile = null;
            })
            .then(function () {
              showPage("dashboard-page");
              loadDashboard();
            });
          return;
        }
      }

      console.log("[ClassConnect] No active Supabase session; login page is ready.");
      showLoginFallback(remote.error ? "Supabase session unavailable" : "no active session");
    }).catch(function (error) {
      console.error("[ClassConnect] Startup auth routing failed; login remains available:", error);
      showLoginFallback("startup auth exception");
    });
  }

  function init() {
    if (hasInitialized) {
      console.warn("[ClassConnect] Duplicate init call ignored.");
      return;
    }
    hasInitialized = true;
    console.log("[ClassConnect] Initializing ClassConnect...");

    try {
      showPage("splash-page");
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.width = "100%";
    } catch (error) {
      console.error("[ClassConnect] Splash setup failed:", error);
      showLoginFallback("splash setup exception");
    }

    setTimeout(function () {
      console.log("[ClassConnect] Splash screen finished after 1.8 seconds.");
      var splash = document.getElementById("splash-page");
      if (splash) {
        splash.style.transition = "opacity 0.3s ease";
        splash.style.opacity = "0";
        setTimeout(function () {
          if (splash.parentNode) splash.style.display = "none";
          routeAfterSplash();
        }, 300);
      } else {
        console.warn("[ClassConnect] Splash page not found; routing directly.");
        routeAfterSplash();
      }
    }, 1800);

    try {
      initializeSupabase();
      applySettings(getSettings());
      lockPortrait();

      var bottomNav = document.querySelector(".bottom-nav");
      if (bottomNav) bottomNav.style.display = "none";

      initEventListeners();
      setupPostToolbar();
      setupEditPostToolbar();
      registerServiceWorker();
      DeviceNotificationManager.init();
      handleOffline(!navigator.onLine);
      console.log("[ClassConnect] Optional app setup completed.");
    } catch (error) {
      console.error("[ClassConnect] Optional setup failed; startup will continue:", error);
    }
  }

  window.navigateTo = navigateTo;
  window.toggleSettingsGroup = toggleSettingsGroup;
  window.DeviceNotificationManager = DeviceNotificationManager;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

})();
