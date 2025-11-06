const MESSAGE_TYPES = {
  APPLY_CONFIG: "KINEWATCH_APPLY_CONFIG",
  REQUEST_STATUS: "KINEWATCH_REQUEST_STATUS"
};

const STORAGE_KEY = "kinewatchConfig";
const storageArea =
  chrome.storage?.sync ?? chrome.storage?.local ?? null;

const DEFAULT_CONFIG = {
  minSpeed: 1,
  maxSpeed: 2
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
    maxSpeed: round(maxSpeed)
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
const heatmapStatusElement = document.getElementById("heatmap-status");
const playbackRateElement = document.getElementById("playback-rate");
const saveButton = document.getElementById("save-button");
const formElement = document.getElementById("config-form");

let activeTabId = null;

const setStatus = (message, isError = false) => {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", Boolean(isError));
};

const setHeatmapInfo = ({
  heatmapAvailable,
  rawRatioAvailable,
  playbackRate,
  lastError
} = {}) => {
  if (heatmapAvailable) {
    heatmapStatusElement.textContent = rawRatioAvailable
      ? "Detected (raw ratio)"
      : "Detected";
  } else if (lastError) {
    heatmapStatusElement.textContent = `Unavailable (${lastError})`;
  } else {
    heatmapStatusElement.textContent = "Unavailable";
  }

  if (Number.isFinite(playbackRate)) {
    playbackRateElement.textContent = `${playbackRate.toFixed(2)}×`;
  } else {
    playbackRateElement.textContent = "—";
  }
};

const setFormDisabled = (disabled) => {
  minInput.disabled = disabled;
  maxInput.disabled = disabled;
  saveButton.disabled = disabled;
};

const refreshActiveTabState = async () => {
  const tab = await getActiveTab();
  activeTabId = tab?.id ?? null;

  if (!tab || !isYouTubeWatchPage(tab.url)) {
    setFormDisabled(true);
    setHeatmapInfo();
    setStatus("Open a YouTube video to enable KineWatch.", true);
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
    }

    setHeatmapInfo({
      heatmapAvailable: state?.heatmapAvailable ?? false,
      rawRatioAvailable: state?.rawRatioAvailable ?? false,
      playbackRate: state?.playbackRate ?? null,
      lastError: state?.lastError ?? null
    });
  } catch (error) {
    const message =
      error instanceof Error &&
      error.message.includes("Could not establish connection")
        ? "Reload the YouTube tab to activate KineWatch."
        : error instanceof Error
        ? error.message
        : "Reload the video to activate KineWatch.";
    setHeatmapInfo();
    setStatus(message, true);
  }
};

const renderConfig = (config) => {
  minInput.value = config.minSpeed;
  maxInput.value = config.maxSpeed;
};

const handleSubmit = async (event) => {
  event.preventDefault();

  const minValue = Number.parseFloat(minInput.value);
  const maxValue = Number.parseFloat(maxInput.value);

  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    setStatus("Provide numeric values for both speeds.", true);
    return;
  }

  const minSpeed = sanitizeSpeed(minValue, DEFAULT_CONFIG.minSpeed);
  const maxSpeed = sanitizeSpeed(maxValue, DEFAULT_CONFIG.maxSpeed);

  if (minSpeed > maxSpeed) {
    setStatus("Minimum speed must be less than or equal to maximum speed.", true);
    return;
  }

  const config = normalizeConfig({ minSpeed, maxSpeed });

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

    setStatus("Saved and applied.");
    await refreshActiveTabState();
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Unable to save settings.",
      true
    );
  } finally {
    saveButton.disabled = false;
  }
};

const init = async () => {
  const storedConfig = await storageGet();
  renderConfig(storedConfig);
  await refreshActiveTabState();

  formElement.addEventListener("submit", handleSubmit);

  [minInput, maxInput].forEach((input) => {
    input.addEventListener("input", () => setStatus(""));
  });
};

init().catch(() => {
  setFormDisabled(true);
  setHeatmapInfo();
  setStatus("Unable to initialise KineWatch.", true);
});
