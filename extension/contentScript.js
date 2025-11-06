const HEAT_MAP_SELECTORS = [
  "path.ytp-modern-heat-map",
  "path.ytp-heat-map-path"
];

const MESSAGE_TYPES = {
  APPLY_CONFIG: "KINEWATCH_APPLY_CONFIG",
  REQUEST_STATUS: "KINEWATCH_REQUEST_STATUS"
};

const STORAGE_KEY = "kinewatchConfig";
const STORAGE_AREA_NAME = chrome.storage?.sync ? "sync" : "local";
const storageArea = chrome.storage?.[STORAGE_AREA_NAME] ?? null;

const DEFAULT_CONFIG = {
  minSpeed: 1,
  maxSpeed: 2
};

const MIN_SPEED = 0.1;
const MAX_SPEED = 16;

const OVERLAY_ID = "kinewatch-overlay";
const OVERLAY_STYLE_ID = "kinewatch-overlay-style";

let overlayElement = null;

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

const parseNumberPair = (token) => {
  const [x, y] = token.split(",").map((part) => Number.parseFloat(part));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
};

const normalizeTime = (rawX) => clamp((rawX - 5) / 1000, 0, 1);
const normalizeIntensity = (rawY) => clamp((100 - rawY) / 100, 0, 1);

const parseHeatMapPath = (d) => {
  const commandRegex = /([A-Za-z])([^A-Za-z]*)/g;
  const points = [];

  let match;
  while ((match = commandRegex.exec(d)) !== null) {
    const command = match[1];
    const params = match[2].trim();

    if (!params || command.toUpperCase() !== "C") {
      continue;
    }

    const tokens = params
      .split(/\s+/)
      .map(parseNumberPair)
      .filter(Boolean);

    for (let i = 2; i < tokens.length; i += 3) {
      const point = tokens[i];
      if (!point) {
        continue;
      }
      points.push({
        localTimeRatio: normalizeTime(point.x),
        normalizedIntensity: normalizeIntensity(point.y),
        rawY: point.y
      });
    }
  }

  return points;
};

const dedupeAndSortPoints = (points) => {
  const sorted = points
    .filter(
      (point) =>
        Number.isFinite(point.timeRatio) &&
        Number.isFinite(point.normalizedIntensity)
    )
    .sort((a, b) => a.timeRatio - b.timeRatio);

  if (!sorted.length) {
    return [];
  }

  const deduped = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const previous = deduped[deduped.length - 1];
    if (Math.abs(current.timeRatio - previous.timeRatio) < 1e-4) {
      previous.normalizedIntensity =
        (previous.normalizedIntensity + current.normalizedIntensity) / 2;
      if (Number.isFinite(previous.rawY) && Number.isFinite(current.rawY)) {
        previous.rawY = (previous.rawY + current.rawY) / 2;
      }
      continue;
    }
    deduped.push(current);
  }

  return deduped;
};

const ensureOverlayStyles = () => {
  if (document.getElementById(OVERLAY_STYLE_ID)) {
    return;
  }

  const style = document.createElement("style");
  style.id = OVERLAY_STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: absolute;
      top: 12px;
      right: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
      font-size: 14px;
      line-height: 1.3;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      letter-spacing: 0.02em;
      pointer-events: none;
      z-index: 2147483646;
      opacity: 0;
      transition: opacity 0.2s ease-in-out;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
    }

    body.ytp-fullscreen-allowed #${OVERLAY_ID} {
      top: max(2vw, 12px);
      right: max(2vw, 12px);
      font-size: max(1.1vw, 14px);
    }
  `;

  document.head?.appendChild(style);
};

const gatherHeatMapPoints = () => {
  const pathElements = HEAT_MAP_SELECTORS.flatMap((selector) =>
    Array.from(document.querySelectorAll(selector))
  );

  const uniquePaths = Array.from(new Set(pathElements));
  if (!uniquePaths.length) {
    throw new Error("Heat map graph not available.");
  }

  const allPoints = uniquePaths.flatMap((pathElement) => {
    const dAttribute = pathElement.getAttribute("d");
    if (!dAttribute) {
      return [];
    }
    const chapterElement = pathElement.closest(".ytp-heat-map-chapter");
    const bounds = computeChapterBounds(chapterElement);
    const range = bounds.endRatio - bounds.startRatio;
    const scale = range > 0 ? range : 1;
    const offset = bounds.hasChapter ? bounds.startRatio : 0;

    const localPoints = parseHeatMapPath(dAttribute);
    return localPoints.map((point) => ({
      timeRatio: clamp(offset + point.localTimeRatio * scale, 0, 1),
      normalizedIntensity: point.normalizedIntensity,
      rawY: point.rawY
    }));
  });

  if (!allPoints.length) {
    throw new Error("Heat map points unavailable.");
  }

  return dedupeAndSortPoints(allPoints);
};

const setOverlayVisibility = (visible) => {
  if (!overlayElement) {
    return;
  }
  overlayElement.style.opacity = visible ? "1" : "0";
};

const ensureOverlayElement = () => {
  if (!videoElement) {
    return null;
  }

  const playerContainer =
    videoElement.closest(".html5-video-player") || videoElement.parentElement;

  if (!playerContainer) {
    return null;
  }

  ensureOverlayStyles();

  let overlay = playerContainer.querySelector(`#${OVERLAY_ID}`);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.textContent = "KineWatch —";
    overlay.style.opacity = "0";
    playerContainer.appendChild(overlay);
  }

  overlayElement = overlay;
  return overlay;
};

const renderOverlay = (data = {}) => {
  const overlay = overlayElement ?? ensureOverlayElement();
  if (!overlay) {
    return;
  }

  const {
    playbackRate,
    targetRate,
    normalizedIntensity,
    rawRatio,
    heatmapAvailable,
    rawRatioAvailable,
    speedRatio
  } = data;

  if (!Number.isFinite(playbackRate)) {
    overlay.textContent = "KineWatch —";
    setOverlayVisibility(false);
    return;
  }

  const speedText = `${playbackRate.toFixed(2)}×`;
  const targetText =
    Number.isFinite(targetRate) && Math.abs(targetRate - playbackRate) > 0.01
      ? ` → ${targetRate.toFixed(2)}×`
      : "";

  let detailText = "";
  if (heatmapAvailable) {
    if (Number.isFinite(normalizedIntensity)) {
      detailText = ` • heat ${(clamp(normalizedIntensity, 0, 1) * 100).toFixed(
        0
      )}%`;
    }
    if (rawRatioAvailable && Number.isFinite(rawRatio)) {
      detailText += ` • raw ${(clamp(rawRatio, 0, 1) * 100).toFixed(0)}%`;
    }
    if (Number.isFinite(speedRatio)) {
      detailText += ` • speed ${(clamp(speedRatio, 0, 1) * 100).toFixed(0)}%`;
    }
  } else if (heatmapAvailable === false) {
    detailText = " • heat-map unavailable";
  }

  overlay.textContent = `KineWatch ${speedText}${targetText}${detailText}`;
  setOverlayVisibility(true);
};

const parsePixelValue = (value) => {
  if (typeof value !== "string" || !value.length) {
    return null;
  }
  const parsed = Number.parseFloat(value.replace("px", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const computeChapterBounds = (chapterElement) => {
  if (!chapterElement) {
    return {
      hasChapter: false,
      startRatio: 0,
      endRatio: 1
    };
  }

  const container = chapterElement.parentElement;
  if (!container) {
    return {
      hasChapter: false,
      startRatio: 0,
      endRatio: 1
    };
  }

  const containerWidth = container.getBoundingClientRect().width;
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return {
      hasChapter: false,
      startRatio: 0,
      endRatio: 1
    };
  }

  const left = parsePixelValue(chapterElement.style.left);
  const width = parsePixelValue(chapterElement.style.width);

  if (!Number.isFinite(left) || !Number.isFinite(width)) {
    return {
      hasChapter: false,
      startRatio: 0,
      endRatio: 1
    };
  }

  const start = clamp(left / containerWidth, 0, 1);
  const end = clamp((left + width) / containerWidth, 0, 1);
  const orderedStart = Math.min(start, end);
  const orderedEnd = Math.max(start, end);

  if (orderedEnd - orderedStart <= 1e-6) {
    return {
      hasChapter: false,
      startRatio: 0,
      endRatio: 1
    };
  }

  return {
    hasChapter: true,
    startRatio: orderedStart,
    endRatio: orderedEnd
  };
};

const sampleHeatMapMetrics = (points, ratio) => {
  if (!points.length || !Number.isFinite(ratio)) {
    return {
      normalizedIntensity: null,
      rawY: null
    };
  }

  const first = points[0];
  if (ratio <= first.timeRatio) {
    return {
      normalizedIntensity: first.normalizedIntensity,
      rawY: first.rawY ?? null
    };
  }

  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    if (ratio <= current.timeRatio) {
      const previous = points[i - 1];
      const span = current.timeRatio - previous.timeRatio;
      if (span <= 0) {
        return {
          normalizedIntensity: current.normalizedIntensity,
          rawY: current.rawY ?? null
        };
      }
      const weight = (ratio - previous.timeRatio) / span;
      return {
        normalizedIntensity:
          previous.normalizedIntensity +
          weight *
            (current.normalizedIntensity - previous.normalizedIntensity),
        rawY:
          Number.isFinite(previous.rawY) && Number.isFinite(current.rawY)
            ? previous.rawY + weight * (current.rawY - previous.rawY)
            : current.rawY ?? previous.rawY ?? null
      };
    }
  }

  const last = points[points.length - 1];
  return {
    normalizedIntensity: last.normalizedIntensity,
    rawY: last.rawY ?? null
  };
};

const getTargetPlaybackRate = (ratio, config) => {
  if (!Number.isFinite(ratio)) {
    return config.minSpeed;
  }
  const range = config.maxSpeed - config.minSpeed;
  if (range <= 0) {
    return config.minSpeed;
  }
  const normalized = clamp(ratio, 0, 1);
  const value = config.minSpeed + normalized * range;
  return clamp(value, MIN_SPEED, MAX_SPEED);
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
  new Promise((resolve) => {
    if (!storageArea) {
      resolve();
      return;
    }
    storageArea.set({ [STORAGE_KEY]: value }, () => resolve());
  });

let config = { ...DEFAULT_CONFIG };
let heatmapPoints = [];
let lastHeatmapError = null;
let heatmapRetryHandle = null;
let heatmapRetryAttempt = 0;
let videoElement = null;
let currentVideoId = null;
let heatmapMinRawY = 0;
let heatmapMaxRawY = 0;

const samplePlaybackRatio = () => {
  if (!videoElement || !Number.isFinite(videoElement.duration) || videoElement.duration <= 0) {
    return null;
  }
  const ratio = videoElement.currentTime / videoElement.duration;
  return clamp(ratio, 0, 1);
};

const updatePlaybackRate = () => {
  if (!videoElement) {
    return;
  }

  const ratio = samplePlaybackRatio();
  const metrics = sampleHeatMapMetrics(heatmapPoints, ratio);
  let rawRatio = null;
  if (
    Number.isFinite(metrics.rawY) &&
    Number.isFinite(heatmapMinRawY) &&
    Number.isFinite(heatmapMaxRawY) &&
    heatmapMaxRawY > heatmapMinRawY
  ) {
    rawRatio = clamp(
      (metrics.rawY - heatmapMinRawY) / (heatmapMaxRawY - heatmapMinRawY),
      0,
      1
    );
  }
  const speedRatio = rawRatio;
  const rawRatioAvailable =
    Number.isFinite(heatmapMinRawY) &&
    Number.isFinite(heatmapMaxRawY) &&
    heatmapMaxRawY > heatmapMinRawY;
  const targetRate = Number.isFinite(speedRatio)
    ? getTargetPlaybackRate(speedRatio, config)
    : null;

  if (Number.isFinite(targetRate)) {
    const difference = Math.abs(videoElement.playbackRate - targetRate);
    if (difference > 0.01) {
      videoElement.playbackRate = targetRate;
    }
  }

  renderOverlay({
    playbackRate: videoElement.playbackRate,
    targetRate,
    normalizedIntensity: metrics.normalizedIntensity,
    rawRatio,
    heatmapAvailable: rawRatioAvailable,
    rawRatioAvailable,
    speedRatio
  });
};

const clearHeatmapRetry = () => {
  if (heatmapRetryHandle !== null) {
    window.clearTimeout(heatmapRetryHandle);
    heatmapRetryHandle = null;
  }
};

const scheduleHeatmapRefresh = () => {
  clearHeatmapRetry();
  const delay = Math.min(1000 * Math.pow(1.5, heatmapRetryAttempt), 10000);
  heatmapRetryHandle = window.setTimeout(() => {
    heatmapRetryAttempt += 1;
    refreshHeatmap();
  }, delay);
};

const refreshHeatmap = () => {
  if (!videoElement) {
    scheduleHeatmapRefresh();
    return;
  }

  try {
    const points = gatherHeatMapPoints();
    heatmapPoints = points;
    const rawValues = points
      .map((point) => point.rawY)
      .filter((value) => Number.isFinite(value));
    if (rawValues.length) {
      heatmapMinRawY = rawValues.reduce(
        (min, value) => (value < min ? value : min),
        rawValues[0]
      );
      heatmapMaxRawY = rawValues.reduce(
        (max, value) => (value > max ? value : max),
        rawValues[0]
      );
    } else {
      heatmapMinRawY = 0;
      heatmapMaxRawY = 0;
    }
    lastHeatmapError = null;
    heatmapRetryAttempt = 0;
    clearHeatmapRetry();
    updatePlaybackRate();
  } catch (error) {
    heatmapPoints = [];
    heatmapMinRawY = 0;
    heatmapMaxRawY = 0;
    lastHeatmapError = error instanceof Error ? error.message : String(error);
    updatePlaybackRate();
    scheduleHeatmapRefresh();
  }
};

const detachVideoListeners = () => {
  if (!videoElement) {
    return;
  }
  videoElement.removeEventListener("timeupdate", updatePlaybackRate);
  videoElement.removeEventListener("loadedmetadata", refreshHeatmap);
  videoElement.removeEventListener("durationchange", refreshHeatmap);
  if (overlayElement) {
    overlayElement.style.opacity = "0";
  }
  videoElement = null;
  overlayElement = null;
  heatmapMinRawY = 0;
  heatmapMaxRawY = 0;
};

const attachVideoListeners = () => {
  const element = document.querySelector("video");
  if (!element || element === videoElement) {
    return;
  }

  detachVideoListeners();

  videoElement = element;
  videoElement.addEventListener("timeupdate", updatePlaybackRate);
  videoElement.addEventListener("loadedmetadata", refreshHeatmap);
  videoElement.addEventListener("durationchange", refreshHeatmap);

  ensureOverlayElement();
  updatePlaybackRate();
  refreshHeatmap();
};

const observeVideoElement = () => {
  const observer = new MutationObserver(() => {
    attachVideoListeners();
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
};

const getVideoIdFromUrl = (url) => {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get("v");
  } catch (_error) {
    return null;
  }
};

const handleNavigation = () => {
  const nextVideoId = getVideoIdFromUrl(window.location.href);
  if (nextVideoId === currentVideoId) {
    attachVideoListeners();
    return;
  }

  currentVideoId = nextVideoId;
  heatmapPoints = [];
  lastHeatmapError = null;
  heatmapRetryAttempt = 0;
  clearHeatmapRetry();
  if (overlayElement) {
    overlayElement.style.opacity = "0";
  }
  overlayElement = null;
  heatmapMinRawY = 0;
  heatmapMaxRawY = 0;

  attachVideoListeners();
  updatePlaybackRate();
  refreshHeatmap();
};

const navigationEvents = [
  "yt-navigate-finish",
  "yt-page-data-updated",
  "yt-navigate-complete",
  "popstate"
];

navigationEvents.forEach((eventName) => {
  window.addEventListener(eventName, () => {
    window.setTimeout(handleNavigation, 50);
  });
});

const setConfig = async (partialConfig = {}, options = { persist: false }) => {
  const nextConfig = normalizeConfig({ ...config, ...partialConfig });
  const changed =
    Math.abs(nextConfig.minSpeed - config.minSpeed) > 1e-6 ||
    Math.abs(nextConfig.maxSpeed - config.maxSpeed) > 1e-6;

  config = nextConfig;

  if (options.persist) {
    await storageSet(nextConfig);
  }

  if (changed) {
    updatePlaybackRate();
  }

  return nextConfig;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== "string") {
    return undefined;
  }

  if (message.type === MESSAGE_TYPES.REQUEST_STATUS) {
    sendResponse({
      ok: true,
      state: {
        config,
        heatmapAvailable:
          Number.isFinite(heatmapMinRawY) &&
          Number.isFinite(heatmapMaxRawY) &&
          heatmapMaxRawY > heatmapMinRawY,
        rawRatioAvailable:
          Number.isFinite(heatmapMinRawY) &&
          Number.isFinite(heatmapMaxRawY) &&
          heatmapMaxRawY > heatmapMinRawY,
        lastError: lastHeatmapError,
        playbackRate: videoElement?.playbackRate ?? null,
        maxRawY: heatmapMaxRawY,
        videoId: currentVideoId ?? null
      }
    });
    return true;
  }

  if (message.type === MESSAGE_TYPES.APPLY_CONFIG) {
    setConfig(message.config, { persist: Boolean(message.persist) })
      .then((appliedConfig) => {
        sendResponse({ ok: true, config: appliedConfig });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    return true;
  }

  return undefined;
});

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== STORAGE_AREA_NAME || !changes[STORAGE_KEY]) {
      return;
    }
    const newValue = changes[STORAGE_KEY]?.newValue;
    if (!newValue) {
      return;
    }
    config = normalizeConfig(newValue);
    updatePlaybackRate();
  });
}

const initialise = async () => {
  config = await storageGet();
  attachVideoListeners();
  observeVideoElement();
  handleNavigation();
  updatePlaybackRate();
};

initialise().catch(() => {
  // Fail silently to avoid breaking the page; popup will surface errors if needed.
});
