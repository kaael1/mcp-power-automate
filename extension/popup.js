const els = {
  bridgeStatus: document.getElementById('bridge-status'),
  capturedAt: document.getElementById('captured-at'),
  changedState: document.getElementById('changed-state'),
  envId: document.getElementById('env-id'),
  flowId: document.getElementById('flow-id'),
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
  runId: document.getElementById('run-id'),
  runStarted: document.getElementById('run-started'),
  runStatus: document.getElementById('run-status'),
  snapshotSource: document.getElementById('snapshot-source'),
  tokenSource: document.getElementById('token-source'),
  updateAt: document.getElementById('update-at'),
};

const formatValue = (value) => value || '-';

const setMessage = (text, tone = 'ok') => {
  els.messageBox.textContent = text;
  els.messageBox.className = `status ${tone}`;
};

const renderStatus = (payload) => {
  const session = payload?.session || null;
  const bridge = payload?.bridge || null;
  const lastRun = payload?.lastRun?.run || null;
  const lastUpdate = payload?.lastUpdate || null;

  els.bridgeStatus.textContent = bridge?.ok ? 'Online' : 'Offline';
  els.envId.textContent = formatValue(session?.envId);
  els.flowId.textContent = formatValue(session?.flowId);
  els.capturedAt.textContent = formatValue(session?.capturedAt);
  els.lastSentAt.textContent = formatValue(payload?.lastSentAt);
  els.legacyState.textContent = session?.legacyApiUrl && session?.legacyToken ? 'Ready' : 'Not captured';
  els.snapshotSource.textContent = formatValue(payload?.snapshot?.source);
  els.tokenSource.textContent = formatValue(payload?.tokenMeta?.source);
  els.updateAt.textContent = formatValue(lastUpdate?.capturedAt);
  els.runId.textContent = formatValue(lastRun?.runId);
  els.runStatus.textContent = formatValue(lastRun?.status);
  els.runStarted.textContent = formatValue(lastRun?.startTime);
  els.runFinished.textContent = formatValue(lastRun?.endTime);
  els.runFailedAction.textContent = formatValue(lastRun?.failedActionName);
  els.beforeName.textContent = formatValue(lastUpdate?.summary?.beforeDisplayName);
  els.afterName.textContent = formatValue(lastUpdate?.summary?.afterDisplayName);
  els.changedState.textContent = lastUpdate
    ? lastUpdate.summary?.changedFlowBody
      ? 'Logic changed'
      : lastUpdate.summary?.changedDisplayName
        ? 'Name only'
      : 'Metadata only'
    : '-';
  els.revertButton.disabled = !lastUpdate;

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

  if (!lastRun) {
    setMessage('No recent runs were found for the active flow yet.', 'ok');
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
    const sameFlow = lastUpdate.flowId === session.flowId && lastUpdate.envId === session.envId;
    if (sameFlow) {
      setMessage('A previous update is available. You can refresh this tab or revert the last saved change.', 'ok');
      return;
    }

    setMessage('The last saved update belongs to a different flow. Revert is disabled until you open that flow.', 'ok');
    els.revertButton.disabled = true;
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
