(() => {
  if (window.__CATEGORY_CORRECTION_COLLECTOR__?.supportsDxmSelect) {
    return;
  }

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function normalizeText(text) {
    return String(text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .trim();
  }

  function singleLine(text) {
    return normalizeText(text).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function textOf(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function findTextElements(regex) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const value = normalizeText(node.nodeValue);
        if (!value || !regex.test(value)) return NodeFilter.FILTER_REJECT;
        regex.lastIndex = 0;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    const elements = [];
    let node = walker.nextNode();
    while (node) {
      if (node.parentElement && isVisible(node.parentElement)) {
        elements.push(node.parentElement);
      }
      node = walker.nextNode();
    }
    return elements;
  }

  function findRowFromElement(element) {
    const preferred = element.closest(
      [
        "tr",
        "[role='row']",
        "[class*='table-row']",
        "[class*='TableRow']",
        "[class*='semi-table-row']",
        "[class*='beast-table-row']"
      ].join(",")
    );

    if (preferred && /SKC\s*ID/i.test(textOf(preferred))) {
      return preferred;
    }

    let current = element;
    let fallback = null;

    for (let depth = 0; current && current !== document.body && depth < 12; depth += 1) {
      const text = textOf(current);
      const rect = current.getBoundingClientRect();

      if (/SKC\s*ID/i.test(text) && rect.width > 240 && rect.height > 30 && text.length < 6000) {
        fallback = current;
        if (/商品分类错误|分类错误待修正/.test(text)) {
          return current;
        }
      }

      current = current.parentElement;
    }

    return fallback;
  }

  function uniqueRows(rows) {
    const seen = new Set();
    return rows.filter((row) => {
      const skc = extractSkc(textOf(row));
      const key = skc || textOf(row).slice(0, 120);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function findRows() {
    const skcElements = findTextElements(/SKC\s*ID/i);
    const rows = skcElements.map(findRowFromElement).filter(Boolean);
    return uniqueRows(rows).filter((row) => findErrorTag(row));
  }

  function extractSkc(rowText) {
    const match = rowText.match(/SKC\s*ID\s*[:：]?\s*(\d+)/i);
    return match?.[1] || "";
  }

  function extractListing(row) {
    const selectors = [
      "[class*='product-info_productName']",
      "[class*='product-info_productTitle']",
      "[class*='goods-item_productName']",
      "[class*='productName']",
      "[class*='productTitle']"
    ];

    for (const selector of selectors) {
      const element = Array.from(row.querySelectorAll(selector)).find((candidate) => {
        const text = singleLine(textOf(candidate));
        return text && !/SKC\s*ID|SPU\s*ID|货号|类目/.test(text);
      });
      if (element) return singleLine(textOf(element));
    }

    const lines = textOf(row)
      .split(/\n+/)
      .map(singleLine)
      .filter(Boolean);

    const lineBeforeCategory = lines.find((line, index) => {
      const next = lines[index + 1] || "";
      return (
        next.includes("类目") &&
        !/SKC\s*ID|SPU\s*ID|货号|类目|商品分类错误|待修正|NEW|美国站/.test(line)
      );
    });

    if (lineBeforeCategory) return lineBeforeCategory;

    return (
      lines.find(
        (line) =>
          line.length >= 8 &&
          !/SKC\s*ID|SPU\s*ID|货号|类目|商品分类错误|待修正|NEW|美国站|复制/.test(line)
      ) || ""
    );
  }

  function findErrorTag(row) {
    return Array.from(row.querySelectorAll("*"))
      .filter((element) => {
        if (!isVisible(element)) return false;
        const text = singleLine(textOf(element));
        return /商品分类错误待修正|分类错误待修正|商品分类错误/.test(text);
      })
      .sort((a, b) => singleLine(textOf(a)).length - singleLine(textOf(b)).length)[0];
  }

  function dispatchHover(element) {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    ["pointerover", "mouseover", "pointerenter", "mouseenter", "mousemove"].forEach((eventName) => {
      element.dispatchEvent(new MouseEvent(eventName, options));
    });
  }

  function getHoverTargets(element, row) {
    const targets = [];
    let current = element;

    for (let depth = 0; current && current !== row && current !== document.body && depth < 5; depth += 1) {
      if (isVisible(current)) targets.push(current);
      current = current.parentElement;
    }

    return [...new Set(targets)];
  }

  function dispatchLeave(element) {
    const options = { bubbles: true, cancelable: true, view: window };
    ["mouseout", "mouseleave", "pointerout", "pointerleave"].forEach((eventName) => {
      element.dispatchEvent(new MouseEvent(eventName, options));
    });
  }

  function getPopoverCandidates() {
    return Array.from(
      document.body.querySelectorAll(
        [
          "[role='tooltip']",
          "[role='dialog']",
          "[class*='popover']",
          "[class*='Popover']",
          "[class*='tooltip']",
          "[class*='Tooltip']",
          "[class*='modal']",
          "div"
        ].join(",")
      )
    )
      .filter(isVisible)
      .map((element) => ({ element, text: textOf(element) }))
      .filter(({ text }) => {
        return (
          text.length > 20 &&
          text.length < 5000 &&
          /修改建议/.test(text) &&
          /当前类目/.test(text)
        );
      })
      .sort((a, b) => a.text.length - b.text.length);
  }

  async function waitForPopover(previousTexts) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 4000) {
      const candidate = getPopoverCandidates().find(({ text }) => !previousTexts.has(text));
      if (candidate) return candidate.text;
      await delay(100);
    }
    return getPopoverCandidates()[0]?.text || "";
  }

  function parseOriginalCategory(popoverText) {
    const text = normalizeText(popoverText);
    const match = text.match(/当前类目\s*[:：]\s*([\s\S]*?)(?=\s*修改建议\s*[:：]|$)/);
    return singleLine(match?.[1] || "");
  }

  function parseSuggestions(popoverText) {
    const text = normalizeText(popoverText);
    const section = text.includes("修改建议")
      ? text.slice(text.indexOf("修改建议")).replace(/^修改建议\s*[:：]?/, "")
      : text;
    const markers = [];
    const markerRegex = /(?:^|\n|\s)([1-9])\s*[.。]\s*/g;
    let match = markerRegex.exec(section);

    while (match) {
      markers.push({
        number: Number(match[1]),
        start: match.index,
        contentStart: markerRegex.lastIndex
      });
      match = markerRegex.exec(section);
    }

    const suggestions = [];
    markers.forEach((marker, index) => {
      if (marker.number < 1 || marker.number > 3) return;
      const next = markers[index + 1]?.start ?? section.length;
      const value = singleLine(section.slice(marker.contentStart, next));
      suggestions[marker.number - 1] = value.replace(/去修改\s*$/, "").trim();
    });

    return [suggestions[0] || "", suggestions[1] || "", suggestions[2] || ""];
  }

  function summarizeDebugItem(prefix, item) {
    return [
      `${prefix}：${item.skc || "未知 SKC"}`,
      `  原类目：${item.originalCategory || "-"}`,
      `  建议1：${item.suggestion1 || "-"}`,
      `  建议2：${item.suggestion2 || "-"}`,
      `  建议3：${item.suggestion3 || "-"}`
    ];
  }

  function isAutoDiscardText(text) {
    return /\d+\s*天后自动废弃|天后自动废弃|自动废弃/.test(singleLine(text));
  }

  async function readRowSuggestion(row, options = {}) {
    const includeDebugSummary = Boolean(options.includeDebugSummary);
    const logs = [];
    const rowText = textOf(row);
    const errorTag = findErrorTag(row);
    const listing = extractListing(row);
    const skc = extractSkc(rowText);

    if (!errorTag) {
      logs.push(`跳过无分类错误标签商品：${skc || "未知 SKC"}`);
      return { item: null, logs };
    }

    let popoverText = "";
    const previousTexts = new Set(getPopoverCandidates().map(({ text }) => text));
    const hoverTargets = getHoverTargets(errorTag, row);

    for (const target of hoverTargets) {
      logs.push(`尝试触发 hover：${skc || "未知 SKC"} / ${singleLine(textOf(target)).slice(0, 40)}`);
      dispatchHover(target);
      popoverText = await waitForPopover(previousTexts);
      dispatchLeave(target);
      if (popoverText) break;
      await delay(120);
    }

    const [suggestion1, suggestion2, suggestion3] = parseSuggestions(popoverText);
    const item = {
      listing,
      skc,
      originalCategory: parseOriginalCategory(popoverText),
      suggestion1,
      suggestion2,
      suggestion3
    };

    if (popoverText) {
      logs.push(`已获取弹窗：${skc || "未知 SKC"}，建议数：${[suggestion1, suggestion2, suggestion3].filter(Boolean).length}`);
    } else {
      logs.push(`未获取到修改建议弹窗：${skc || "未知 SKC"}`);
    }

    if (includeDebugSummary) {
      logs.push(...summarizeDebugItem("自动废弃调试结果", item));
    }

    return { logs, item };
  }

  async function collectRow(row) {
    return readRowSuggestion(row);
  }

  async function collect() {
    const logs = [];
    const rows = findRows();
    const items = [];
    logs.push(`找到候选商品行：${rows.length}`);

    for (const row of rows) {
      const rowText = textOf(row);
      if (isAutoDiscardText(rowText)) {
        const stoppedSkc = extractSkc(rowText) || "未知 SKC";
        logs.push(`遇到自动废弃标记，停止采集：${stoppedSkc}`);
        break;
      }

      const result = await collectRow(row);
      if (result?.logs?.length) logs.push(...result.logs);
      if (result?.item) items.push(result.item);
      await delay(120);
    }

    logs.push(`采集完成：${items.length} 条`);
    return { items, logs };
  }

  function getDxmRows() {
    return Array.from(document.querySelectorAll("tr.pddkj-product-table-row, tr.vxe-body--row"))
      .filter((row) => {
        if (!isVisible(row)) return false;
        if (!row.querySelector("input[type='checkbox']")) return false;
        const text = singleLine(textOf(row));
        return /认领|Temu|CNY|创建|更新/.test(text);
      });
  }

  function getDxmRowCheckbox(row) {
    return row.querySelector("td[colid='col_6'] input[type='checkbox'], input[type='checkbox']");
  }

  function isCheckboxChecked(input) {
    if (!input) return false;
    const wrapper = input.closest(".ant-checkbox, .vxe-checkbox, label");
    return (
      input.checked ||
      input.getAttribute("aria-checked") === "true" ||
      /checked|is--checked/.test(wrapper?.className || "")
    );
  }

  function getDxmRowLabel(row) {
    const title =
      singleLine(textOf(row.querySelector(".white-space"))) ||
      singleLine(textOf(row.querySelector("td[colid='col_8']")));
    const skcText = singleLine(textOf(row.querySelector("td[colid='col_10']")));
    const skc = skcText.match(/\b\d{8,}\b/)?.[0] || "";
    const spu = singleLine(textOf(row.querySelector(".productUrl")));
    return [skc && `SKC ${skc}`, spu && `SPU ${spu}`, title].filter(Boolean).join(" / ").slice(0, 120);
  }

  function getDxmFirstRowKey() {
    const row = getDxmRows()[0];
    if (!row) return "";
    return row.getAttribute("rowid") || singleLine(textOf(row)).slice(0, 160);
  }

  function findPagerButton(title) {
    return Array.from(document.querySelectorAll(`button[title='${title}'], .vxe-pager button[title='${title}']`))
      .find((button) => {
        const className = button.className || "";
        return isVisible(button) && !button.disabled && !/is--disabled|disabled/.test(className);
      });
  }

  async function waitForDxmRows() {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
      const rows = getDxmRows();
      if (rows.length) return rows;
      await delay(120);
    }
    return getDxmRows();
  }

  async function waitForDxmPageChange(previousKey) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 8000) {
      const rows = getDxmRows();
      const nextKey = getDxmFirstRowKey();
      if (rows.length && nextKey && nextKey !== previousKey) return true;
      await delay(150);
    }
    return false;
  }

  async function goToDxmFirstPage(logs) {
    const firstButton = findPagerButton("首页");
    if (!firstButton) {
      logs.push("当前已经在第一页，或未找到可点击的首页按钮");
      return;
    }

    const previousKey = getDxmFirstRowKey();
    firstButton.click();
    logs.push("已点击首页，准备从第一条开始选择");
    await waitForDxmPageChange(previousKey);
    await delay(300);
  }

  async function ensureDxmRowChecked(row) {
    const checkbox = getDxmRowCheckbox(row);
    if (!checkbox || checkbox.disabled) {
      return { checked: false, reason: "没有可用复选框" };
    }

    if (isCheckboxChecked(checkbox)) {
      return { checked: true, reason: "已选中" };
    }

    checkbox.scrollIntoView({ block: "center", inline: "center" });
    await delay(40);
    checkbox.click();
    await delay(80);

    if (!isCheckboxChecked(checkbox)) {
      const clickTarget = checkbox.closest("label, .ant-checkbox-wrapper, .vxe-cell") || checkbox;
      clickTarget.click();
      await delay(100);
    }

    return {
      checked: isCheckboxChecked(checkbox),
      reason: isCheckboxChecked(checkbox) ? "已点击选中" : "点击后仍未选中"
    };
  }

  async function selectDxmRowsByCount(requestedCount) {
    const requested = Math.max(1, Math.floor(Number(requestedCount) || 0));
    const logs = [`目标选择数量：${requested}`];
    let selected = 0;
    let pageNumber = 1;
    const visitedPages = new Set();

    await goToDxmFirstPage(logs);

    while (selected < requested) {
      const rows = await waitForDxmRows();
      const pageKey = rows.map((row) => row.getAttribute("rowid") || singleLine(textOf(row)).slice(0, 60)).join("|");

      if (!rows.length) {
        logs.push("未找到店小秘商品行，请确认当前页面是数据搬家列表");
        break;
      }

      if (visitedPages.has(pageKey)) {
        logs.push("检测到分页内容未变化，停止选择，避免重复勾选");
        break;
      }
      visitedPages.add(pageKey);

      logs.push(`第 ${pageNumber} 页可选商品行：${rows.length}`);

      for (const row of rows) {
        if (selected >= requested) break;
        const result = await ensureDxmRowChecked(row);
        const label = getDxmRowLabel(row) || "未知商品";

        if (result.checked) {
          selected += 1;
          logs.push(`已选择 ${selected}/${requested}：${label}`);
        } else {
          logs.push(`选择失败：${label}，原因：${result.reason}`);
        }
      }

      if (selected >= requested) break;

      const nextButton = findPagerButton("下一页");
      if (!nextButton) {
        logs.push(`没有下一页，已停止。实际选择：${selected}/${requested}`);
        break;
      }

      const previousKey = getDxmFirstRowKey();
      nextButton.click();
      logs.push("已点击下一页，继续选择");

      const changed = await waitForDxmPageChange(previousKey);
      if (!changed) {
        logs.push("等待下一页加载超时，已停止");
        break;
      }

      pageNumber += 1;
      await delay(300);
    }

    logs.push(`按数量选择完成：${selected}/${requested}`);
    return { requested, selected, logs };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "DXM_SELECT_ROWS_BY_COUNT") {
      selectDxmRowsByCount(message.count)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({
            requested: Number(message.count) || 0,
            selected: 0,
            logs: [`按数量选择异常：${error?.message || String(error)}`],
            error: error?.message || String(error)
          });
        });

      return true;
    }

    if (message?.type !== "CATEGORY_CORRECTION_COLLECT") {
      return false;
    }

    collect()
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          items: [],
          logs: [`采集异常：${error?.message || String(error)}`],
          error: error?.message || String(error)
        });
      });

    return true;
  });

  window.__CATEGORY_CORRECTION_COLLECTOR__ = {
    collect,
    selectDxmRowsByCount,
    supportsDxmSelect: true
  };
})();
