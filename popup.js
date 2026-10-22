const namesEl = document.getElementById("names");
const delayEl = document.getElementById("delay");
const loopEl = document.getElementById("loop");
const randomizeEl = document.getElementById("randomize");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const logWrapEl = document.getElementById("logWrap");
const logToggleEl = document.getElementById("logToggle");

// Small corner arrow: opens/closes the status+log panel, which is hidden
// by default so only the .panel itself shows when the popup first opens.
logToggleEl.addEventListener("click", () => {
  const open = logWrapEl.classList.toggle("open");
  logToggleEl.classList.toggle("open", open);
});

const STORAGE_KEY = "mc_name_tries_v1";

// Restore last-used list/delay
chrome.storage.local.get([STORAGE_KEY], (res) => {
  const saved = res[STORAGE_KEY];
  if (saved) {
    namesEl.value = saved.names || "";
    delayEl.value = saved.delay || 4000;
    loopEl.checked = !!saved.loop;
    randomizeEl.checked = saved.randomize !== undefined ? saved.randomize : true; // default on
  }
});

function saveState() {
  chrome.storage.local.set({
    [STORAGE_KEY]: {
      names: namesEl.value,
      delay: Number(delayEl.value),
      loop: loopEl.checked,
      randomize: randomizeEl.checked,
    },
  });
}
namesEl.addEventListener("input", saveState);
delayEl.addEventListener("input", saveState);
loopEl.addEventListener("change", saveState);
randomizeEl.addEventListener("change", saveState);

function log(line) {
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Wraps chrome.tabs.sendMessage in a Promise and surfaces the real error
// instead of failing silently (this is what was happening before).
function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// If the content script isn't there yet (page was open before the
// extension was loaded/reloaded), inject it on demand and retry once.
async function sendWithAutoInject(tab, message) {
  try {
    return await sendMessageToTab(tab.id, message);
  } catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch (injectErr) {
      throw new Error(
        "Couldn't inject the script into this tab: " + injectErr.message
      );
    }
    // give it a moment to register its listener, then retry
    await new Promise((r) => setTimeout(r, 100));
    return await sendMessageToTab(tab.id, message);
  }
}

async function checkConnection() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes("minecraft.net")) {
    statusEl.textContent =
      "Open your minecraft.net profile page (msaprofile), then come back here.";
    return;
  }
  try {
    const res = await sendWithAutoInject(tab, { type: "PING" });
    statusEl.textContent = res && res.hasInput
      ? "Connected. Name field found — ready to go."
      : "Connected, but the name field isn't visible. Open the Change Java Profile Name dialog first.";
  } catch (e) {
    statusEl.textContent = "Not connected yet: " + e.message;
  }
}
checkConnection();

startBtn.addEventListener("click", async () => {
  const names = namesEl.value
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);

  if (names.length === 0) {
    statusEl.textContent = "Add at least one name first.";
    return;
  }

  const tab = await getActiveTab();
  if (!tab || !tab.url || !tab.url.includes("minecraft.net")) {
    statusEl.textContent =
      "Open your minecraft.net profile page (msaprofile) first, then click Try All.";
    return;
  }

  const delay = Math.max(100, Number(delayEl.value) || 400);
  const loop = loopEl.checked;
  const randomize = randomizeEl.checked;
  logEl.textContent = "";
  statusEl.textContent = loop
    ? `Trying ${names.length} name(s) on loop...`
    : `Trying ${names.length} name(s)...`;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  try {
    await sendWithAutoInject(tab, { type: "START_TRY", names, delay, loop, randomize });
  } catch (e) {
    statusEl.textContent = "Failed to start: " + e.message;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (tab) {
    try {
      await sendWithAutoInject(tab, { type: "STOP_TRY" });
    } catch (e) {
      /* ignore — tab may already be gone */
    }
  }
  statusEl.textContent = "Stopping...";
});

// Listen for progress/done messages from the content script
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TRY_PROGRESS") {
    log(`[${msg.name}] ${msg.result}`);
  } else if (msg.type === "TRY_ROUND") {
    log(`--- starting loop round ${msg.round} ---`);
    statusEl.textContent = `Looping — round ${msg.round}...`;
  } else if (msg.type === "TRY_DONE") {
    statusEl.textContent = msg.stopped
      ? "Stopped."
      : "Finished trying all names.";
    startBtn.disabled = false;
    stopBtn.disabled = true;
  } else if (msg.type === "TRY_ERROR") {
    statusEl.textContent = msg.message;
    startBtn.disabled = false;
    stopBtn.disabled = true;
  }
});