const MESSAGE_TYPES = {
  APPLY_CONFIG: "KINEWATCH_APPLY_CONFIG",
  REQUEST_STATUS: "KINEWATCH_REQUEST_STATUS"
};

const STORAGE_KEY = "kinewatchConfig";
const storageArea =
  chrome.storage?.sync ?? chrome.storage?.local ?? null;

const DEFAULT_CONFIG = {
  minSpeed: 1,
  maxSpeed: 2,
  smoothing: 0.25,
  refreshIntervalMs: 1000
};

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const sanitizeSpeed = (value, fallback) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return clamp(value, MIN_SPEED, MAX_SPEED);
};

const sanitizeSmoothing = (value, fallback) => {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, 0, 0.95);
};

const sanitizeRefreshInterval = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return clamp(parsed, 250, 4000);
};

const normalizeConfig = (input = {}) => {
  const source = { ...DEFAULT_CONFIG, ...input };
  let minSpeed = sanitizeSpeed(source.minSpeed, DEFAULT_CONFIG.minSpeed);
  let maxSpeed = sanitizeSpeed(source.maxSpeed, DEFAULT_CONFIG.maxSpeed);

  if (minSpeed > maxSpeed) {
    [minSpeed, maxSpeed] = [maxSpeed, minSpeed];
  }

  const round = (value) => Math.round(value * 1000) / 1000;

  return {
    minSpeed: round(minSpeed),
    maxSpeed: round(maxSpeed),
    smoothing: sanitizeSmoothing(source.smoothing, DEFAULT_CONFIG.smoothing),
    refreshIntervalMs: sanitizeRefreshInterval(
      source.refreshIntervalMs,
      DEFAULT_CONFIG.refreshIntervalMs
    )
  };
};

const storageGet = () =>
  new Promise((resolve) => {
    if (!storageArea) {
      resolve(DEFAULT_CONFIG);
      return;
    }
    storageArea.get(STORAGE_KEY, (items) => {
      if (chrome.runtime.lastError) {
        resolve(DEFAULT_CONFIG);
        return;
      }
      resolve(normalizeConfig(items?.[STORAGE_KEY]));
    });
  });

const storageSet = (value) =>
  new Promise((resolve, reject) => {
    if (!storageArea) {
      resolve();
      return;
    }
    storageArea.set({ [STORAGE_KEY]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });

const getActiveTab = async () => {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab ?? null;
};

const isYouTubeWatchPage = (url) =>
  typeof url === "string" && /:\/\/(www\.)?youtube\.com\/watch/.test(url);

const minInput = document.getElementById("min-speed");
const maxInput = document.getElementById("max-speed");
const statusElement = document.getElementById("status");
const presetButtons = Array.from(
  document.querySelectorAll("[data-preset-min][data-preset-max]")
);
const smoothingInput = document.getElementById("smoothing");
const smoothingValueElement = document.getElementById("smoothing-value");
const refreshInput = document.getElementById("refresh-interval");
const saveButton = document.getElementById("save-button");
const formElement = document.getElementById("config-form");

let activeTabId = null;

const updateSmoothingLabel = (value) => {
  if (!smoothingValueElement) {
    return;
  }
  const percentage = Math.round(clamp(value, 0, 0.95) * 100);
  smoothingValueElement.textContent = `${percentage}%`;
};

const setStatus = (message, tone = "info") => {
  const hasMessage = Boolean(message);
  statusElement.textContent = hasMessage ? message : "";
  statusElement.hidden = !hasMessage;
  statusElement.classList.toggle("is-visible", hasMessage);
  statusElement.classList.toggle("error", hasMessage && tone === "error");
  statusElement.classList.toggle("positive", hasMessage && tone === "success");
  if (!hasMessage) {
    statusElement.classList.remove("error", "positive");
  }
};

updateSmoothingLabel(DEFAULT_CONFIG.smoothing);

const setFormDisabled = (disabled) => {
  minInput.disabled = disabled;
  maxInput.disabled = disabled;
  saveButton.disabled = disabled;
  smoothingInput.disabled = disabled;
  refreshInput.disabled = disabled;
  presetButtons.forEach((button) => {
    button.disabled = disabled;
  });
};

const refreshActiveTabState = async () => {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;

  if (!tab || !isYouTubeWatchPage(tab.url)) {
    setFormDisabled(true);
    setStatus("Open a YouTube video to enable KineWatch.", "error");
    return;
  }

  setFormDisabled(false);
  setStatus("");

  try {
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: MESSAGE_TYPES.REQUEST_STATUS
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Unknown error");
    }

    const { state } = response;
    if (state?.config) {
      const normalized = normalizeConfig(state.config);
      minInput.value = normalized.minSpeed;
      maxInput.value = normalized.maxSpeed;
      smoothingInput.value = normalized.smoothing;
      refreshInput.value = normalized.refreshIntervalMs;
      updateSmoothingLabel(Number.parseFloat(smoothingInput.value));
    }

  } catch (error) {
    const message =
      error instanceof Error &&
      error.message.includes("Could not establish connection")
        ? "Reload the YouTube tab to activate KineWatch."
        : error instanceof Error
        ? error.message
        : "Reload the video to activate KineWatch.";
    setStatus(message, "error");
  }
};

const renderConfig = (config) => {
  minInput.value = config.minSpeed;
  maxInput.value = config.maxSpeed;
  if (smoothingInput) {
    smoothingInput.value = config.smoothing;
    updateSmoothingLabel(Number.parseFloat(smoothingInput.value));
  }
  if (refreshInput) {
    refreshInput.value = config.refreshIntervalMs;
  }
};

const handleSubmit = async (event) => {
  event.preventDefault();

  const minValue = Number.parseFloat(minInput.value);
  const maxValue = Number.parseFloat(maxInput.value);

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    setStatus("Provide numeric values for both speeds.", "error");
    return;
  }

  const minSpeed = sanitizeSpeed(minValue, DEFAULT_CONFIG.minSpeed);
  const maxSpeed = sanitizeSpeed(maxValue, DEFAULT_CONFIG.maxSpeed);

  if (minSpeed > maxSpeed) {
    setStatus(
      "Minimum speed must be less than or equal to maximum speed.",
      "error"
    );
    return;
  }

  const smoothing = smoothingInput
    ? Number.parseFloat(smoothingInput.value)
    : DEFAULT_CONFIG.smoothing;
  const refreshIntervalMs = refreshInput
    ? Number.parseInt(refreshInput.value, 10)
    : DEFAULT_CONFIG.refreshIntervalMs;

  const config = normalizeConfig({
    minSpeed,
    maxSpeed,
    smoothing,
    refreshIntervalMs
  });

  setStatus("Saving…");
  saveButton.disabled = true;

  try {
    await storageSet(config);

    if (activeTabId !== null) {
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, {
          type: MESSAGE_TYPES.APPLY_CONFIG,
          config,
          persist: false
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Failed to apply settings.");
        }
      } catch (messageError) {
        if (
          messageError instanceof Error &&
          messageError.message.includes("Could not establish connection")
        ) {
          throw new Error(
            "Reload the YouTube tab to activate KineWatch after saving."
          );
        }
        if (messageError instanceof Error) {
          throw messageError;
        }
        throw new Error(String(messageError));
      }
    }

    setStatus("Saved and applied.", "success");
    await refreshActiveTabState();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Unable to save settings.",
      "error"
    );
  } finally {
    saveButton.disabled = false;
  }
};

const handlePresetClick = (event) => {
  const button = event.currentTarget;
  const minValue = Number.parseFloat(button.dataset.presetMin);
  const maxValue = Number.parseFloat(button.dataset.presetMax);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    return;
  }
  minInput.value = minValue;
  maxInput.value = maxValue;
  setStatus(
    `Applying ${minValue.toFixed(2)}×–${maxValue.toFixed(2)}× preset…`
  );
  formElement.requestSubmit();
};

const init = async () => {
  const storedConfig = await storageGet();
  renderConfig(storedConfig);
  await refreshActiveTabState();

  formElement.addEventListener("submit", handleSubmit);

  [minInput, maxInput].forEach((input) => {
    input.addEventListener("input", () => setStatus(""));
  });

  presetButtons.forEach((button) => {
    button.addEventListener("click", handlePresetClick);
  });

  if (smoothingInput) {
    smoothingInput.addEventListener("input", () => {
      updateSmoothingLabel(Number.parseFloat(smoothingInput.value));
    });
  }

  if (refreshInput) {
    refreshInput.addEventListener("input", () => setStatus(""));
  }
};

init().catch(() => {
  setFormDisabled(true);
  setStatus("Unable to initialise KineWatch.", "error");
});
