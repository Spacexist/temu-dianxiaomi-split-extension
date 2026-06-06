const collectBtn = document.getElementById("collectBtn");
const copyBtn = document.getElementById("copyBtn");
const selectCountBtn = document.getElementById("selectCountBtn");
const selectCountInput = document.getElementById("selectCountInput");
const statusText = document.getElementById("statusText");
const markdownOutput = document.getElementById("markdownOutput");
const logOutput = document.getElementById("logOutput");

let latestOutput = "";

function setStatus(text) {
  statusText.textContent = text;
}

function setBusy(isBusy) {
  collectBtn.disabled = isBusy;
  selectCountBtn.disabled = isBusy;
  collectBtn.textContent = isBusy ? "采集中..." : "采集";
  selectCountBtn.textContent = isBusy ? "处理中..." : "按数量选择";
}

function renderLogs(logs) {
  const lines = Array.isArray(logs) && logs.length ? logs : ["暂无日志"];
  logOutput.textContent = lines.join("\n");
}

function cleanOutputText(text) {
  return String(text || "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildOutputText(items) {
  if (!items.length) {
    return "商品分类修正建议\n\n全部 SKC：\n\n未采集到带有“商品分类错误待修正”的商品。";
  }

  const skcList = items.map((item) => cleanOutputText(item.skc)).filter(Boolean).join(",");

  const blocks = items.map((item, index) => {
    const suggestions = [item.suggestion1, item.suggestion2, item.suggestion3]
      .map((text, suggestionIndex) => `${suggestionIndex + 1}. ${cleanOutputText(text) || "-"}`)
      .join("\n");

    return [
      `${index + 1}. ${cleanOutputText(item.listing) || "未识别商品标题"}`,
      `SKC：${cleanOutputText(item.skc) || "-"}`,
      `原先错误类目：${cleanOutputText(item.originalCategory) || "-"}`,
      "修改建议：",
      suggestions
    ].join("\n");
  });

  return ["商品分类修正建议", "", `全部 SKC：${skcList}`, "", ...blocks].join("\n\n");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("未找到当前标签页");
  }
  return tab;
}

async function collectFromPage() {
  const tab = await getActiveTab();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  return chrome.tabs.sendMessage(tab.id, {
    type: "CATEGORY_CORRECTION_COLLECT"
  });
}

async function selectDxmRows(count) {
  const tab = await getActiveTab();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"]
  });

  return chrome.tabs.sendMessage(tab.id, {
    type: "DXM_SELECT_ROWS_BY_COUNT",
    count
  });
}

collectBtn.addEventListener("click", async () => {
  setBusy(true);
  copyBtn.disabled = true;
  markdownOutput.value = "";
  renderLogs(["开始采集..."]);
  latestOutput = "";
  setStatus("正在读取当前页面...");

  try {
    const response = await collectFromPage();
    const items = Array.isArray(response?.items) ? response.items : [];
    renderLogs(response?.logs);
    latestOutput = buildOutputText(items);
    markdownOutput.value = latestOutput;
    copyBtn.disabled = !latestOutput;
    setStatus(`采集完成：${items.length} 条`);
  } catch (error) {
    const message = error?.message || String(error);
    markdownOutput.value = "";
    renderLogs([`采集失败：${message}`]);
    setStatus(`采集失败：${message}`);
  } finally {
    setBusy(false);
  }
});

copyBtn.addEventListener("click", async () => {
  if (!latestOutput) return;

  try {
    await navigator.clipboard.writeText(latestOutput);
    setStatus("结果已复制");
  } catch (error) {
    markdownOutput.focus();
    markdownOutput.select();
    document.execCommand("copy");
    setStatus("结果已复制");
  }
});

selectCountBtn.addEventListener("click", async () => {
  const count = Number.parseInt(selectCountInput.value, 10);
  if (!Number.isFinite(count) || count <= 0) {
    setStatus("请输入大于 0 的选择数量");
    renderLogs(["按数量选择失败：数量必须大于 0"]);
    return;
  }

  setBusy(true);
  renderLogs([`开始按数量选择：${count}`]);
  setStatus("正在选择店小秘商品...");

  try {
    const response = await selectDxmRows(count);
    renderLogs(response?.logs);
    const selected = Number(response?.selected || 0);
    const requested = Number(response?.requested || count);
    setStatus(`选择完成：${selected}/${requested}`);
  } catch (error) {
    const message = error?.message || String(error);
    renderLogs([`按数量选择失败：${message}`]);
    setStatus(`按数量选择失败：${message}`);
  } finally {
    setBusy(false);
  }
});
