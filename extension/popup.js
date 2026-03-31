const els = {
  bridgeStatus: document.getElementById('bridge-status'),
  bridgeMode: document.getElementById('bridge-mode'),
  capturedAt: document.getElementById('captured-at'),
  changedState: document.getElementById('changed-state'),
  currentTabFlowId: document.getElementById('current-tab-flow-id'),
  currentTabFlowName: document.getElementById('current-tab-flow-name'),
  envId: document.getElementById('env-id'),
  afterName: document.getElementById('after-name'),
  beforeName: document.getElementById('before-name'),
  lastSentAt: document.getElementById('last-sent-at'),
  legacyState: document.getElementById('legacy-state'),
  messageBox: document.getElementById('message-box'),
  refreshButton: document.getElementById('refresh-button'),
  refreshRunButton: document.getElementById('refresh-run-button'),
  resendButton: document.getElementById('resend-button'),
  revertButton: document.getElementById('revert-button'),
  runFailedAction: document.getElementById('run-failed-action'),
  runFinished: document.getElementById('run-finished'),
  runFlowId: document.getElementById('run-flow-id'),
  runFlowName: document.getElementById('run-flow-name'),
  runId: document.getElementById('run-id'),
  runStarted: document.getElementById('run-started'),
  runStatus: document.getElementById('run-status'),
  snapshotSource: document.getElementById('snapshot-source'),
  snapshotSourceMain: document.getElementById('snapshot-source-main'),
  selectedFlowId: document.getElementById('selected-flow-id'),
  selectedFlowName: document.getElementById('selected-flow-name'),
  setTabTargetButton: document.getElementById('use-tab-target-button'),
  tokenSourceFull: document.getElementById('token-source-full'),
  tokenSourceMain: document.getElementById('token-source-main'),
  tokenSourceShort: document.getElementById('token-source-short'),
  updateAt: document.getElementById('update-at'),
  updateFlowId: document.getElementById('update-flow-id'),
};

const formatValue = (value) => value || '-';

const summarizeTokenSource = (value) => {
  if (!value) return '-';
  if (value.startsWith('request-header')) return 'request-header';
  if (value.startsWith('localStorage:')) return 'localStorage';
  if (value.startsWith('sessionStorage:')) return 'sessionStorage';
  if (value.startsWith('indexedDB:')) return 'indexedDB';
  return value.length > 36 ? `${value.slice(0, 36)}...` : value;
};

const setMessage = (text, tone = 'ok') => {
  els.messageBox.textContent = text;
  els.messageBox.className = `status ${tone}`;
};

const renderStatus = (payload) => {
  const session = payload?.session || null;
  const bridge = payload?.bridge || null;
  const activeTarget = payload?.activeFlow?.activeTarget || payload?.status?.activeTarget || null;
  const currentTab = payload?.activeFlow?.currentTab || {
    displayName: payload?.status?.currentTabFlowName || null,
    envId: session?.envId || null,
    flowId: payload?.status?.currentTabFlowId || session?.flowId || null,
  };
  const sameRunFlow =
    payload?.lastRun &&
    activeTarget &&
    payload.lastRun.flowId === activeTarget.flowId &&
    payload.lastRun.envId === activeTarget.envId;
  const sameUpdateFlow =
    payload?.lastUpdate &&
    activeTarget &&
    payload.lastUpdate.flowId === activeTarget.flowId &&
    payload.lastUpdate.envId === activeTarget.envId;
  const lastRun = sameRunFlow ? payload?.lastRun?.run || null : null;
  const lastUpdate = sameUpdateFlow ? payload?.lastUpdate || null : null;
  const selectedFlowName =
    activeTarget?.displayName ||
    lastUpdate?.after?.displayName ||
    payload?.snapshot?.displayName ||
    payload?.snapshot?.flow?.definition?.metadata?.displayName ||
    null;
  const runFlowName = sameRunFlow ? selectedFlowName : null;

  els.bridgeStatus.textContent = bridge?.ok ? 'Online' : 'Offline';
  els.selectedFlowName.textContent = formatValue(selectedFlowName);
  els.selectedFlowId.textContent = formatValue(activeTarget?.flowId);
  els.currentTabFlowName.textContent = formatValue(currentTab?.displayName);
  els.currentTabFlowId.textContent = formatValue(currentTab?.flowId);
  els.envId.textContent = formatValue(session?.envId);
  els.capturedAt.textContent = formatValue(session?.capturedAt);
  els.lastSentAt.textContent = formatValue(payload?.lastSentAt);
  els.legacyState.textContent = session?.legacyApiUrl && session?.legacyToken ? 'Ready' : 'Not captured';
  els.bridgeMode.textContent = formatValue(bridge?.bridgeMode);
  els.snapshotSource.textContent = formatValue(payload?.snapshot?.source);
  els.snapshotSourceMain.textContent = formatValue(payload?.snapshot?.source);
  els.tokenSourceMain.textContent = summarizeTokenSource(payload?.tokenMeta?.source);
  els.tokenSourceShort.textContent = summarizeTokenSource(payload?.tokenMeta?.source);
  els.tokenSourceFull.textContent = formatValue(payload?.tokenMeta?.source);
  els.updateAt.textContent = formatValue(lastUpdate?.capturedAt);
  els.runId.textContent = formatValue(lastRun?.runId);
  els.runFlowName.textContent = formatValue(runFlowName);
  els.runFlowId.textContent = formatValue(payload?.lastRun?.flowId);
  els.runStatus.textContent = formatValue(lastRun?.status);
  els.runStarted.textContent = formatValue(lastRun?.startTime);
  els.runFinished.textContent = formatValue(lastRun?.endTime);
  els.runFailedAction.textContent = formatValue(lastRun?.failedActionName);
  els.beforeName.textContent = formatValue(lastUpdate?.summary?.beforeDisplayName);
  els.afterName.textContent = formatValue(lastUpdate?.summary?.afterDisplayName);
  els.updateFlowId.textContent = formatValue(payload?.lastUpdate?.flowId);
  els.changedState.textContent = lastUpdate
    ? lastUpdate.summary?.changedFlowBody
      ? 'Logic changed'
      : lastUpdate.summary?.changedDisplayName
        ? 'Name only'
      : 'Metadata only'
    : '-';
  els.revertButton.disabled = !lastUpdate;
  els.setTabTargetButton.disabled = !currentTab?.flowId;

  if (payload?.error) {
    setMessage(payload.error, 'error');
    return;
  }

  if (payload?.lastError) {
    setMessage(payload.lastError, 'error');
    return;
  }

  if (!session) {
    setMessage('Open or refresh a flow in Power Automate to capture a session.', 'ok');
    return;
  }

  if (!activeTarget?.flowId) {
    setMessage('Session captured, but no selected flow target is locked yet.', 'ok');
    return;
  }

  if (currentTab?.flowId && currentTab.flowId !== activeTarget.flowId) {
    setMessage('The selected flow target is different from the current browser tab. Use the button below if you want to switch targets.', 'ok');
    return;
  }

  if (!lastRun) {
    if (payload?.lastRun?.run && !sameRunFlow) {
      setMessage('The cached last run belongs to a different selected flow. Refresh run status for this target.', 'ok');
      return;
    }

    setMessage('No recent runs were found for the selected flow target yet.', 'ok');
    return;
  }

  if ((lastRun.status || '').toLowerCase() === 'failed') {
    setMessage('The latest run failed. Inspect the failed action in the popup or query run details from MCP.', 'error');
    return;
  }

  if ((lastRun.status || '').toLowerCase() && !['succeeded', 'failed', 'cancelled', 'canceled', 'timedout'].includes((lastRun.status || '').toLowerCase())) {
    setMessage('The latest run is still in progress.', 'ok');
    return;
  }

  if (lastUpdate) {
    const sameFlow = lastUpdate.flowId === activeTarget.flowId && lastUpdate.envId === activeTarget.envId;
    if (sameFlow) {
      setMessage('A previous update is available. You can refresh this tab or revert the last saved change.', 'ok');
      return;
    }

    setMessage('The last saved update belongs to a different flow. Revert is disabled until you open that flow.', 'ok');
    els.revertButton.disabled = true;
    return;
  }

  if (payload?.lastUpdate && !sameUpdateFlow) {
    setMessage('The cached last update belongs to a different selected flow.', 'ok');
    return;
  }

  if (payload?.snapshot?.flow?.definition) {
    setMessage('Session captured and browser snapshot is available.', 'ok');
    return;
  }

  if (!bridge?.ok) {
    setMessage('The local MCP bridge is not reachable on http://127.0.0.1:17373.', 'error');
    return;
  }

  setMessage('Session captured and ready for the local MCP bridge.', 'ok');
};

const sendMessage = (message) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });

const refresh = async () => {
  const payload = await sendMessage({ type: 'get-status' });
  renderStatus(payload);
};

els.resendButton.addEventListener('click', async () => {
  els.resendButton.disabled = true;
  setMessage('Re-sending the captured session...', 'ok');

  try {
    const payload = await sendMessage({ type: 'resend-session' });
    renderStatus(payload);
  } finally {
    els.resendButton.disabled = false;
  }
});

els.refreshButton.addEventListener('click', async () => {
  els.refreshButton.disabled = true;
  setMessage('Refreshing the current Power Automate tab...', 'ok');

  try {
    const payload = await sendMessage({ type: 'refresh-current-tab' });
    renderStatus(payload);
  } finally {
    els.refreshButton.disabled = false;
  }
});

els.setTabTargetButton.addEventListener('click', async () => {
  els.setTabTargetButton.disabled = true;
  setMessage('Switching the selected flow target to the current tab...', 'ok');

  try {
    const payload = await sendMessage({ type: 'set-active-flow-from-tab' });
    renderStatus(payload);
  } finally {
    els.setTabTargetButton.disabled = false;
  }
});

els.revertButton.addEventListener('click', async () => {
  els.revertButton.disabled = true;
  setMessage('Reverting the last saved update...', 'ok');

  try {
    const payload = await sendMessage({ type: 'revert-last-update' });
    renderStatus(payload);
  } finally {
    els.revertButton.disabled = false;
  }
});

els.refreshRunButton.addEventListener('click', async () => {
  els.refreshRunButton.disabled = true;
  setMessage('Refreshing the latest run status...', 'ok');

  try {
    const payload = await sendMessage({ type: 'refresh-last-run' });
    renderStatus(payload);
  } finally {
    els.refreshRunButton.disabled = false;
  }
});

refresh().catch((error) => {
  renderStatus({
    error: error instanceof Error ? error.message : String(error),
  });
});
