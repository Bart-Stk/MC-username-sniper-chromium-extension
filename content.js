// content.js — runs on minecraft.net pages, does the actual form-filling/clicking

let stopRequested = false;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns a random delay between 50% and 150% of the base delay
function getRandomizedDelay(baseDelay) {
  const factor = 0.5 + Math.random(); // random between 0.5 and 1.5
  return Math.round(baseDelay * factor);
}

// React (and similar frameworks) track the input's value via a native setter,
// so a plain `input.value = x` gets ignored. This forces it through properly.
function setNativeValue(element, value) {
  const proto = Object.getPrototypeOf(element);
  const protoSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  const ownSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;

  if (protoSetter && protoSetter !== ownSetter) {
    protoSetter.call(element, value);
  } else if (ownSetter) {
    ownSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function findNameInput() {
  return (
    document.getElementById("modal-change-java-profile-name") ||
    document.querySelector('input[placeholder="Type Java name here"]') ||
    document.querySelector(".MCR_TextInput_Input")
  );
}

function findSubmitButton(form) {
  if (form) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) return btn;
  }
  const buttons = Array.from(document.querySelectorAll("button"));
  return buttons.find((b) =>
    b.textContent.trim().toLowerCase().includes("change name")
  );
}

function getResultText(input) {
  // Best-effort read of whatever feedback appeared near the input/modal.
  const container =
    input.closest(".modal-change-profile-name__card-inner") ||
    input.closest("form") ||
    input.parentElement;

  const errorEl = container?.querySelector(
    '[class*="Input_Error"], [role="alert"], [class*="error" i]'
  );
  if (errorEl && errorEl.textContent.trim()) {
    return `ERROR: ${errorEl.textContent.trim()}`;
  }

  const isErrorClass = input.classList.contains("MCR_TextInput_Input_Error");
  if (isErrorClass) return "ERROR (input marked invalid, no message text found)";

  return "No error shown (check manually — may mean it went through)";
}

async function tryOneName(name, delay, randomize) {
  const input = findNameInput();
  if (!input) return "FAILED: couldn't find the name input on this page";

  const form = input.closest("form");

  input.focus();
  setNativeValue(input, name);

  // give React a beat to re-validate and enable the button
  await sleep(250);

  const button = findSubmitButton(form);
  if (!button) return "FAILED: couldn't find the Change Name button";

  if (button.disabled) {
    await sleep(250);
  }
  if (button.disabled) {
    return "SKIPPED: submit button still disabled (invalid name format?)";
  }

  button.click();
  // Use randomized delay if enabled, otherwise use the exact delay
  const waitTime = randomize ? getRandomizedDelay(delay) : delay;
  await sleep(waitTime);

  return getResultText(input);
}

async function runTryList(names, delay, loop, randomize) {
  stopRequested = false;
  let round = 1;
  do {
    for (const name of names) {
      if (stopRequested) {
        chrome.runtime.sendMessage({ type: "TRY_DONE", stopped: true });
        return;
      }
      let result;
      try {
        result = await tryOneName(name, delay, randomize);
      } catch (e) {
        result = `FAILED: ${e.message}`;
      }
      chrome.runtime.sendMessage({ type: "TRY_PROGRESS", name, result });
    }
    if (loop && !stopRequested) {
      round += 1;
      chrome.runtime.sendMessage({ type: "TRY_ROUND", round });
    }
  } while (loop && !stopRequested);

  chrome.runtime.sendMessage({ type: "TRY_DONE", stopped: stopRequested });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "PING") {
    sendResponse({ alive: true, hasInput: !!findNameInput() });
    return true;
  } else if (msg.type === "START_TRY") {
    if (!findNameInput()) {
      chrome.runtime.sendMessage({
        type: "TRY_ERROR",
        message:
          "Couldn't find the name field on this page. Make sure the Change Java Profile Name dialog is open.",
      });
      sendResponse({ ok: false });
      return true;
    }
    const randomize = msg.randomize !== undefined ? msg.randomize : true; // default true
    runTryList(msg.names, msg.delay, !!msg.loop, randomize);
    sendResponse({ ok: true });
    return true;
  } else if (msg.type === "STOP_TRY") {
    stopRequested = true;
    sendResponse({ ok: true });
    return true;
  }
});