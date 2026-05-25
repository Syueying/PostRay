import { CLEAR_HISTORY, COLLECTING_STATE, EXPORT_RUN, LIST_RUNS, NET_RESPONSE, NET_TIMEOUT, START_COLLECTION, START_HOOK, START_SCROLL, STOP_COLLECTION, HISTORY, HISTORY_REFRESH_TS, DEFAULT_ITEMS_TO_COLLECT } from "../../consts";
import { addRecords, deleteAllRunStores, deleteRunRecords, getRecordsByRun } from "../utils/recordsDb";

import * as XLSX from "xlsx";

const runState = new Map();
const NO_RESPONSE_TIMEOUT_MS = 10000;
const INITIAL_RESPONSE_TIMEOUT_MS = 15000;

const clearNoResponseTimer = (state) => {
  if (state?.noResponseTimer) {
    clearTimeout(state.noResponseTimer);
    state.noResponseTimer = null;
  }
};

const armNoResponseTimer = (tabId, timeoutMs = NO_RESPONSE_TIMEOUT_MS, reason = "no_response") => {
  const state = runState.get(tabId);
  if (!state || state.stopped) return;
  clearNoResponseTimer(state);
  state.noResponseTimer = setTimeout(async () => {
    await finalizeRun(tabId, reason);
  }, timeoutMs);
  runState.set(tabId, state);
};


export const onMessageListener = () => {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    (async () => {
      if (msg?.type === START_COLLECTION) {
        await collect(msg);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === NET_RESPONSE) {
        await handleNetResponse(msg.payload, sender);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === NET_TIMEOUT) {
        const tabId = sender?.tab?.id;
        if (tabId != null) {
          await finalizeRun(tabId, "timeout");
        }
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === STOP_COLLECTION) {
        await stopByActiveTab();
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === LIST_RUNS) {
        const runs = await getRuns();
        sendResponse({ ok: true, runs });
        return;
      }

      if (msg?.type === EXPORT_RUN) {
        const { runId } = msg.payload || {};
        if (!runId) {
          sendResponse({ ok: false, error: "Missing runId" });
          return;
        }
        await exportRunToExcel(runId);
        sendResponse({ ok: true });
        return;
      }

      if (msg?.type === CLEAR_HISTORY) {
        await clearHistory();
        sendResponse({ ok: true });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message type" });
    })().catch((e) => {
      sendResponse({ ok: false, error: e?.message || String(e) });
    });

    return true;
  });

  chrome.tabs.onRemoved.addListener(async (tabId) => {
    const state = runState.get(tabId);
    if (!state || state.stopped) return;
    await finalizeRun(tabId, "tab_closed");
  });

  chrome.windows.onRemoved.addListener(async (windowId) => {
    for (const [tabId, state] of runState.entries()) {
      if (state?.windowId === windowId && !state.stopped) {
        await finalizeRun(tabId, "window_closed");
      }
    }
  });
};

const parseLocalDateRange = (startInput, endInput) => {
  const toDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    return new Date(value);
  };
  const startDate = toDate(startInput);
  const endDate = toDate(endInput);
  if (!startDate || Number.isNaN(startDate.getTime())) return { startAt: null, endAt: null };
  if (!endDate || Number.isNaN(endDate.getTime())) return { startAt: null, endAt: null };

  // Normalize to local day bounds
  const startAt = new Date(
    startDate.getFullYear(),
    startDate.getMonth(),
    startDate.getDate(),
    0, 0, 0, 0
  ).getTime();
  const endAt = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
    23, 59, 59, 999
  ).getTime();
  return { startAt, endAt };
};

const collect = async (msg) => {
  // 1. 获取配置项
  const { runId, accountId, accountType, startTime, endTime } = msg.payload || {};
  const resolvedTargetUrl = `https://www.instagram.com/${accountId}/`;
  const resolvedApiUrlIncludes = "/graphql/query";
  const { startAt, endAt } = parseLocalDateRange(startTime, endTime);
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = currentTab?.id;
  const windowId = currentTab?.windowId;
  runState.set( tabId, {
    runId,
    accountId,
    accountType,
    startAt,
    endAt,
    startTime,
    endTime,
    apiUrlIncludes: resolvedApiUrlIncludes,
    stopped: false,
    windowId,
    collectedCount: 0,
    hasReceivedResponse: false,
  });

  await chrome.storage.local.set({
    [COLLECTING_STATE]: {
      isCollecting: true,
      tabId,
      windowId,
      runId,
      accountId,
      startTime,
      endTime
    }
  });
  
  // 2. 打开目标网站后再发 START_HOOK，避免找不到接收端
  await chrome.tabs.update(tabId, { url: resolvedTargetUrl });
  const onUpdated = async (updatedTabId, info) => {
    if (updatedTabId !== tabId || info.status !== "complete") return;
    chrome.tabs.onUpdated.removeListener(onUpdated);

    try {
      await chrome.tabs.sendMessage(tabId, {
        type: START_HOOK,
        payload: {
          apiUrlIncludes: resolvedApiUrlIncludes,
          startAt: startTime,
          endAt: endTime
        }
      });
      armNoResponseTimer(tabId, INITIAL_RESPONSE_TIMEOUT_MS, "initial_no_response");
    } catch (e) {
      // Content script not ready yet.
    }
  };
  chrome.tabs.onUpdated.addListener(onUpdated);

  // 3. 更新历史任务记录
  await upsertRun({
    runId,
    accountId,
    endTime: endTime,
    startTime: startTime
  });
}

const upsertRun = async (meta) => {
  if (!meta?.runId) return;
  const data = await chrome.storage.local.get(HISTORY);
  const runs = data[HISTORY] || [];
  const existing = runs.find((r) => r.runId === meta.runId);
  if (existing) return;

  const next = [
    {
      runId: meta.runId,
      accountId: meta.accountId,
      createdAt: meta.createdAt,
      targetUrl: meta.targetUrl,
      endTime: meta.endTime,
      startTime: meta.startTime,
      count: 0
    },
    ...runs
  ];
  const trimmed = next.slice(0, 3);
  await chrome.storage.local.set({ [HISTORY]: trimmed });

  if (next.length > 3) {
    const removed = next.slice(3);
    for (const r of removed) {
      if (r?.runId) {
        await deleteRunRecords(r.runId);
      }
    }
  }
};

const clearHistory = async () => {
  await deleteAllRunStores();
  await chrome.storage.local.set({ [HISTORY]: [], [HISTORY_REFRESH_TS]: Date.now() });
};

const stopCollection = async (tabId) => {
  try {
    await chrome.tabs.sendMessage(tabId, { type: STOP_COLLECTION });
  } catch (e) {
    // Ignore if content script is not ready or tab closed.
  }
};

const triggerScroll = async (tabId) => {
  try {
    await chrome.tabs.sendMessage(tabId, { type: START_SCROLL });
  } catch (e) {
    // Ignore if content script is not ready or tab closed.
  }
};

const stopByActiveTab = async () => {
  const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabId = currentTab?.id;
  if (tabId == null) return;
  await finalizeRun(tabId, "manual_stop");
};

const getRuns = async () => {
  const data = await chrome.storage.local.get(HISTORY);
  return data[HISTORY] || [];
};

const exportRunToExcel = async (runId, filenameOverride) => {
  const records = await getRecordsByRun(runId);
  const rows = records
    .map((r) => {
      if (!r || typeof r !== "object") return null;
      const { id, runId: _runId, ...rest } = r;
      return rest;
    })
    .filter((row) => row && typeof row === "object");
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "data");

  const runs = await getRuns();
  const run = runs.find((r) => r.runId === runId);
  const filename = filenameOverride
    ? filenameOverride
    : run?.accountId
    ? buildFilename(run)
    : `claw_${runId}.xlsx`;

  const base64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
  const url = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}`;
  await chrome.downloads.download({ url, filename, saveAs: true });
};

const hasActiveDateWindow = (state) =>
  Number.isFinite(state?.startAt) && Number.isFinite(state?.endAt);

const isPinnedNode = (node) => {
  if (!node || typeof node !== "object") return false;
  if (node.is_pinned === true) return true;
  if (Array.isArray(node.pinned_for_users) && node.pinned_for_users.length > 0) return true;
  return false;
};

const handleNetResponse = async (payload, sender) => {
  if (!payload) return;
  const { url, text } = payload;
  if (!url) return;
  const tabId = sender?.tab?.id;
  if (tabId == null) return;

  const state = runState.get(tabId);
  if (!state || state.stopped) return;

  if (state.apiUrlIncludes && !url.includes(state.apiUrlIncludes)) return;
  clearNoResponseTimer(state);
  state.hasReceivedResponse = true;
  runState.set(tabId, state);

  // 核心处理逻辑
  if (text.includes('xdt_api__v1__feed__user_timeline_graphql_connection')) {
    const body = JSON.parse(text);
    const data = body?.data;
    const timeline = data?.xdt_api__v1__feed__user_timeline_graphql_connection;
    const edges = Array.isArray(timeline?.edges) ? timeline.edges : [];

    const rowsToSave = [];
    let shouldStop = edges.length === 0;
    let crossedStartBoundary = false;

    const useDateWindow = hasActiveDateWindow(state);

    for (const edge of edges) {
      const node = edge?.node || {};
      const caption = node?.caption || {};
      const createdAtRaw = node?.taken_at;
      const pinned = isPinnedNode(node);

      const row = {
        accountId: state.accountId,
        created_at: createdAtRaw,
        text: caption?.text ?? "",
        comment_count: node?.comment_count ?? 0,
        like_count: node?.like_count ?? 0,
        // media_type: node?.media_type ?? null
      };
      
      if (!useDateWindow) {
        if (state.collectedCount < DEFAULT_ITEMS_TO_COLLECT) {
          rowsToSave.push(row);
          state.collectedCount += 1;
        }
        if (state.collectedCount >= DEFAULT_ITEMS_TO_COLLECT) {
          shouldStop = true;
          break;
        }
      } else {
        if (createdAtRaw >= (state.startAt / 1000) && createdAtRaw <= (state.endAt / 1000)) {
          rowsToSave.push(row);
        }

        // Instagram may place pinned posts ahead of the normal timeline order.
        // Those old pinned posts should not terminate the collection early.
        if (!pinned && createdAtRaw < (state.startAt / 1000)) {
          crossedStartBoundary = true;
        }
      }
    }

    if (useDateWindow && crossedStartBoundary) {
      shouldStop = true;
    }

    if (rowsToSave.length > 0) {
      const records = rowsToSave.map((row) => ({
        runId: state.runId,
        text: row.text,
        created_at: row.created_at != null
          ? new Date(row.created_at < 1e12 ? row.created_at * 1000 : row.created_at).toLocaleString()
          : null,
        comment_count: row.comment_count,
        like_count: row.like_count
        // media_type: row.media_type
      }));
      await addRecords(records);
    }

    if (shouldStop) {
      await finalizeRun(tabId);
      return;
    }

    await triggerScroll(tabId);
    armNoResponseTimer(tabId, NO_RESPONSE_TIMEOUT_MS, "no_response");
  }
};

const buildFilename = (state) => {
  const safe = (value) => String(value || "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_");

  const runDate = new Date(state.runId || Date.now());
  const pad = (n) => String(n).padStart(2, "0");
  const localTime = `${runDate.getFullYear()}${pad(runDate.getMonth() + 1)}${pad(runDate.getDate())}${pad(runDate.getHours())}${pad(runDate.getMinutes())}`;

  const start = safe(state.startTime);
  const end = safe(state.endTime);
  const account = safe(state.accountId);

  return `${account}_${localTime}_${start}_${end}.xlsx`;
};

const finalizeRun = async (tabId, reason = "finished") => {
  const state = runState.get(tabId);
  if (!state || state.stopped) return;
  state.stopped = true;
  clearNoResponseTimer(state);
  runState.set(tabId, state);

  await stopCollection(tabId);
  try {
    chrome.runtime.sendMessage({
      type: STOP_COLLECTION,
      payload: { runId: state.runId, reason },
    });
  } catch (e) {
    // Ignore if no listeners.
  }

  const filename = buildFilename(state);
  // await exportRunToExcel(state.runId, filename);

  await chrome.storage.local.set({
    [COLLECTING_STATE]: {
      isCollecting: false,
      tabId,
      windowId: state.windowId,
      runId: state.runId,
      reason
    },
    [HISTORY_REFRESH_TS]: Date.now()
  });
};
