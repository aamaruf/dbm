// ==================== STATE MANAGEMENT ====================
let backups = [];
let connections = [];
let drivers = [];
let operationGroups = [];
let schedulerRunning = false;
let configMode = "env"; // 'env' or 'manual'

const DB_TYPE_LABELS = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
};

const DEFAULT_PORTS = {
  postgres: 5432,
  mysql: 3306,
  mongodb: 27017,
};

// ==================== UTILITY FUNCTIONS ====================

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getConnectionById(id) {
  return connections.find((conn) => conn.id === id) || null;
}

function getConnectionTitle(id) {
  return getConnectionById(id)?.title || id;
}

function getDriverFormats(type) {
  const driver = drivers.find((d) => d.type === type);
  return driver ? driver.formats : [];
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Format operation type for display
 */
function formatOperationType(type) {
  if (type === "upload") return "Upload";
  return type === "restore" ? "Restore" : "Backup";
}

/**
 * Format operation status for display
 */
function formatOperationStatus(status) {
  if (status === "success") return "Success";
  if (status === "error") return "Failed";
  if (status === "in_progress") return "In Progress";
  if (status === "started") return "Started";
  return "Info";
}

function formatOperationStatusClass(status) {
  if (status === "success") return "success";
  if (status === "error") return "failed";
  if (status === "in_progress" || status === "started") return "active";
  return "info";
}

/**
 * Show toast notification
 */
function showToast(type, title, message) {
  const container = document.getElementById("toast-container");

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icon =
    type === "success"
      ? '<path d="M12 2C6.5 2 2 6.5 2 12S6.5 22 12 22 22 17.5 22 12 17.5 2 12 2M10 17L5 12L6.41 10.59L10 14.17L17.59 6.58L19 8L10 17Z" />'
      : type === "error"
        ? '<path d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />'
        : '<path d="M13,9H11V7H13M13,17H11V11H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" />';

  toast.innerHTML = `
    <svg class="toast-icon" viewBox="0 0 24 24" fill="currentColor">${icon}</svg>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close">&times;</button>
  `;

  container.appendChild(toast);

  toast.querySelector(".toast-close").addEventListener("click", () => {
    toast.remove();
  });

  setTimeout(() => {
    toast.remove();
  }, 5000);
}

/**
 * Show loading overlay
 */
function showLoading() {
  document.getElementById("loading").classList.remove("hidden");
}

/**
 * Hide loading overlay
 */
function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

/**
 * API request helper
 */
async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Request failed");
    }

    return data;
  } catch (error) {
    throw error;
  }
}

/**
 * Toggle password visibility
 */
function togglePasswordVisibility(button) {
  const targetId = button.dataset.target;
  const input = document.getElementById(targetId);

  if (input.type === "password") {
    input.type = "text";
    button.classList.add("hidden");
  } else {
    input.type = "password";
    button.classList.remove("hidden");
  }
}

// ==================== DATA FETCHING ====================

/**
 * Load backups and statistics
 */
async function loadBackups() {
  showLoading();

  try {
    const filter = document.getElementById("backup-connection-filter").value;
    const query = filter ? `?connectionId=${encodeURIComponent(filter)}` : "";
    const data = await apiRequest(`/api/backups${query}`);

    backups = data.backups || [];
    const stats = data.stats || { total: 0, local: 0, remote: 0, totalSize: 0 };

    updateStatistics(stats);
    renderBackupsTable();
  } catch (error) {
    console.error("Error loading backups:", error);
    showToast("error", "Error", "Failed to load backups: " + error.message);
  } finally {
    hideLoading();
  }
}

/**
 * Load operation logs
 */
async function loadOperationLogs() {
  try {
    const data = await apiRequest("/api/operations?limit=20&stepsPerOperation=500");
    operationGroups = data.operations || [];
    renderOperationLogs();
  } catch (error) {
    console.error("Error loading operation logs:", error);
    showToast("error", "Error", "Failed to load operation logs: " + error.message);
  }
}

async function clearOperationLogs() {
  if (!confirm("Clear all operation logs? This cannot be undone.")) {
    return;
  }

  try {
    const data = await apiRequest("/api/operations", {
      method: "DELETE",
    });
    showToast("success", "Success", data.message);
    await loadOperationLogs();
  } catch (error) {
    console.error("Error clearing operation logs:", error);
    showToast("error", "Error", "Failed to clear logs: " + error.message);
  }
}

/**
 * Render operation logs
 */
function renderOperationLogs() {
  const container = document.getElementById("operations-log-list");

  if (!container) {
    return;
  }

  if (operationGroups.length === 0) {
    container.innerHTML =
      '<div class="operations-empty">No operations yet. Create or restore a backup to see progress logs.</div>';
    return;
  }

  const operations = operationGroups.slice(0, 20);
  container.innerHTML = operations
    .map((operation) => {
      const groupFilename = operation.filename
        ? ` - ${escapeHtml(operation.filename)}`
        : "";
      const connectionLabel = operation.connectionTitle
        ? `<span class="operation-connection">${escapeHtml(operation.connectionTitle)}</span>`
        : "";
      const steps = (operation.steps || [])
        .map((log) => {
          const details = log.details ? ` (${escapeHtml(log.details)})` : "";
          return `
          <div class="operation-line status-${log.status || "info"}">
            <span class="operation-line-time">${dayjs(log.timestamp).format("HH:mm:ss")}</span>
            <span class="operation-line-status">${formatOperationStatus(log.status)}</span>
            <span class="operation-line-text">${escapeHtml(log.step)}${details}</span>
          </div>
        `;
        })
        .join("");

      return `
        <div class="operation-item-card">
          <div class="operation-compact-header">
            <span class="operation-type">${formatOperationType(operation.type)}</span>
            ${connectionLabel}
            <span class="operation-status operation-status-chip ${formatOperationStatusClass(operation.latestStatus)}">${formatOperationStatus(operation.latestStatus)}</span>
            <span class="operation-time">${dayjs(operation.latestTimestamp).fromNow()}</span>
          </div>
          <div class="operation-compact-title">${escapeHtml(operation.latestStep)}${groupFilename}</div>
          <div class="operation-compact-list">${steps}</div>
        </div>
      `;
    })
    .join("");
}

/**
 * Update statistics cards
 */
function updateStatistics(stats) {
  document.getElementById("stat-total").textContent = stats.total;
  document.getElementById("stat-local").textContent = stats.local;
  document.getElementById("stat-remote").textContent = stats.remote;
  document.getElementById("stat-size").textContent = formatFileSize(
    stats.totalSize,
  );
}

/**
 * Render backups table
 */
function renderBackupsTable() {
  const tbody = document.getElementById("backups-tbody");

  if (backups.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <svg class="empty-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8.01V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z" />
            </svg>
            <p>No backups found</p>
            <p class="empty-hint">Use the Backup action on a connection to get started</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = backups
    .map((backup) => {
      const locationClass =
        backup.location === "local"
          ? "location-local"
          : backup.location === "remote"
            ? "location-remote"
            : "location-both";
      const locationText =
        backup.location === "both"
          ? "Local & Remote"
          : backup.location.charAt(0).toUpperCase() + backup.location.slice(1);

      const connectionExists = Boolean(getConnectionById(backup.connectionId));
      const dataAttrs = `data-filename="${escapeHtml(backup.filename)}" data-connection-id="${escapeHtml(backup.connectionId)}"`;

      return `
      <tr>
        <td><strong>${escapeHtml(backup.filename)}</strong></td>
        <td>${escapeHtml(getConnectionTitle(backup.connectionId))}</td>
        <td>${formatFileSize(backup.size)}</td>
        <td>${dayjs(backup.date).fromNow()}</td>
        <td>
          <span class="location-badge ${locationClass}">${locationText}</span>
        </td>
        <td>
          <div class="action-buttons">
            <button class="action-btn btn-download" ${dataAttrs} title="Download backup" aria-label="Download backup">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z" />
              </svg><span class="sr-only">Download</span>
            </button>
            ${
              connectionExists
                ? `<button class="action-btn btn-restore" ${dataAttrs} title="Restore this backup" aria-label="Restore this backup">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z" />
              </svg><span class="sr-only">Restore</span>
            </button>`
                : ""
            }
            <button class="action-btn danger btn-delete" ${dataAttrs} title="Delete backup" aria-label="Delete backup">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
              </svg><span class="sr-only">Delete</span>
            </button>
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".btn-download").forEach((btn) => {
    btn.addEventListener("click", () => {
      downloadBackup(btn.dataset.connectionId, btn.dataset.filename);
    });
  });
  tbody.querySelectorAll(".btn-restore").forEach((btn) => {
    btn.addEventListener("click", () => {
      openRestoreModal(
        btn.dataset.connectionId,
        btn.dataset.connectionId,
        btn.dataset.filename,
      );
    });
  });
  tbody.querySelectorAll(".btn-delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      deleteBackup(btn.dataset.connectionId, btn.dataset.filename);
    });
  });
}

// ==================== CONNECTIONS ====================

/**
 * Load connections and refresh the connection-dependent UI
 */
async function loadConnections() {
  try {
    const data = await apiRequest("/api/connections");
    connections = data.connections || [];
    drivers = data.drivers || [];
    renderConnectionsTable();
    renderConnectionFilter();
  } catch (error) {
    console.error("Error loading connections:", error);
    showToast("error", "Error", "Failed to load connections: " + error.message);
  }
}

function renderConnectionFilter() {
  const select = document.getElementById("backup-connection-filter");
  const current = select.value;
  select.innerHTML =
    '<option value="">All connections</option>' +
    connections
      .map(
        (conn) =>
          `<option value="${escapeHtml(conn.id)}">${escapeHtml(conn.title)}</option>`,
      )
      .join("");
  select.value = getConnectionById(current) ? current : "";
}

function renderConnectionsTable() {
  const tbody = document.getElementById("connections-tbody");

  if (connections.length === 0) {
    tbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="7">
          <div class="empty-state">
            <p>No connections yet</p>
            <p class="empty-hint">Click "Add Connection" to get started</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = connections
    .map((conn) => {
      const id = escapeHtml(conn.id);
      const hostText = conn.options?.srv ? conn.host : `${conn.host}:${conn.port}`;
      const manageButtons = conn.isDefault
        ? ""
        : `
            <button class="action-btn btn-conn-edit" data-id="${id}" title="Edit connection" aria-label="Edit connection">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z" />
              </svg><span class="sr-only">Edit</span>
            </button>
            <button class="action-btn danger btn-conn-delete" data-id="${id}" title="Delete connection" aria-label="Delete connection">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
              </svg><span class="sr-only">Delete</span>
            </button>`;

      return `
      <tr>
        <td>
          <strong>${escapeHtml(conn.title)}</strong>
          ${conn.isDefault ? '<span class="default-tag">from Configure</span>' : ""}
        </td>
        <td><span class="db-type-badge db-type-${escapeHtml(conn.type)}">${DB_TYPE_LABELS[conn.type] || escapeHtml(conn.type)}</span></td>
        <td>${escapeHtml(hostText)}</td>
        <td>${escapeHtml(conn.database)}</td>
        <td>${conn.backupCount || 0}</td>
        <td>${conn.lastBackupAt ? dayjs(conn.lastBackupAt).fromNow() : "Never"}</td>
        <td>
          <div class="action-buttons">
            <button class="action-btn btn-conn-backup" data-id="${id}" title="Backup now" aria-label="Backup now">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
              </svg><span class="sr-only">Backup</span>
            </button>
            <button class="action-btn btn-conn-restore" data-id="${id}" title="Restore from a backup" aria-label="Restore from a backup">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z" />
              </svg><span class="sr-only">Restore</span>
            </button>
            ${manageButtons}
          </div>
        </td>
      </tr>
    `;
    })
    .join("");

  tbody.querySelectorAll(".btn-conn-backup").forEach((btn) => {
    btn.addEventListener("click", () => backupConnection(btn.dataset.id, btn));
  });
  tbody.querySelectorAll(".btn-conn-restore").forEach((btn) => {
    btn.addEventListener("click", () => openRestoreModal(btn.dataset.id));
  });
  tbody.querySelectorAll(".btn-conn-edit").forEach((btn) => {
    btn.addEventListener("click", () =>
      openConnectionModal(getConnectionById(btn.dataset.id)),
    );
  });
  tbody.querySelectorAll(".btn-conn-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteConnection(btn.dataset.id));
  });
}

function showModal(id) {
  document.getElementById(id).classList.add("show");
}

function hideModal(id) {
  document.getElementById(id).classList.remove("show");
}

function updateConnectionTypeFields(type) {
  document.querySelectorAll(".conn-options").forEach((block) => {
    const types = block.dataset.dbType.split(" ");
    block.style.display = types.includes(type) ? "block" : "none";
  });
}

/**
 * Open the connection modal to add (no argument) or edit a connection
 */
function openConnectionModal(conn = null) {
  const form = document.getElementById("connection-form");
  form.reset();

  const type = conn?.type || "postgres";
  const options = conn?.options || {};

  document.getElementById("connection-modal-title").textContent = conn
    ? "Edit Connection"
    : "Add Connection";
  document.getElementById("conn-id").value = conn?.id || "";
  document.getElementById("conn-type").value = type;
  document.getElementById("conn-type").disabled = Boolean(conn);
  document.getElementById("conn-title").value = conn?.title || "";
  document.getElementById("conn-host").value = conn?.host || "";
  document.getElementById("conn-port").value = conn?.port || DEFAULT_PORTS[type];
  document.getElementById("conn-user").value = conn?.user || "";
  document.getElementById("conn-password").value = "";
  document.getElementById("conn-password-hint").textContent =
    conn?.hasPassword ? "Leave blank to keep the saved password" : "";
  document.getElementById("conn-database").value = conn?.database || "";
  document.getElementById("conn-pg-schema").value = options.schema || "";
  document.getElementById("conn-exclude-tables").value = (
    options.excludeTables || []
  ).join(", ");
  document.getElementById("conn-ssl").checked = options.sslMode === "on";
  document.getElementById("conn-auth-source").value = options.authSource || "";
  document.getElementById("conn-exclude-collections").value = (
    options.excludeCollections || []
  ).join(", ");
  document.getElementById("conn-tls").checked = Boolean(options.tls);
  document.getElementById("conn-srv").checked = Boolean(options.srv);

  updateConnectionTypeFields(type);
  showModal("connection-modal");
}

function readConnectionForm() {
  const type = document.getElementById("conn-type").value;
  const id = document.getElementById("conn-id").value;
  const payload = {
    type,
    title: document.getElementById("conn-title").value.trim(),
    host: document.getElementById("conn-host").value.trim(),
    port: parseInt(document.getElementById("conn-port").value, 10),
    user: document.getElementById("conn-user").value.trim(),
    password: document.getElementById("conn-password").value,
    database: document.getElementById("conn-database").value.trim(),
    options: {},
  };

  if (type === "postgres" || type === "mysql") {
    payload.options.excludeTables = document
      .getElementById("conn-exclude-tables")
      .value.trim();
    payload.options.sslMode = document.getElementById("conn-ssl").checked
      ? "on"
      : "off";
  }
  if (type === "postgres") {
    payload.options.schema = document.getElementById("conn-pg-schema").value.trim();
  }
  if (type === "mongodb") {
    payload.options.authSource =
      document.getElementById("conn-auth-source").value.trim() || "admin";
    payload.options.excludeCollections = document
      .getElementById("conn-exclude-collections")
      .value.trim();
    payload.options.tls = document.getElementById("conn-tls").checked;
    payload.options.srv = document.getElementById("conn-srv").checked;
  }

  return { id, payload };
}

async function testConnectionForm() {
  const button = document.getElementById("btn-test-connection");
  const { id, payload } = readConnectionForm();
  button.disabled = true;

  try {
    const data = await apiRequest("/api/connections/test", {
      method: "POST",
      body: JSON.stringify(id ? { ...payload, id } : payload),
    });
    showToast("success", "Connection successful", escapeHtml(data.version || ""));
  } catch (error) {
    showToast("error", "Connection failed", escapeHtml(error.message));
  } finally {
    button.disabled = false;
  }
}

async function saveConnection(event) {
  event.preventDefault();
  const button = document.getElementById("btn-save-connection");
  const { id, payload } = readConnectionForm();
  button.disabled = true;

  try {
    const data = await apiRequest(
      id ? `/api/connections/${encodeURIComponent(id)}` : "/api/connections",
      {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      },
    );
    showToast("success", "Success", escapeHtml(data.message));
    hideModal("connection-modal");
    await loadConnections();
  } catch (error) {
    showToast("error", "Error", escapeHtml(error.message));
  } finally {
    button.disabled = false;
  }
}

async function deleteConnection(id) {
  const conn = getConnectionById(id);
  if (
    !conn ||
    !confirm(
      `Delete connection "${conn.title}"? Existing backup files are kept.`,
    )
  ) {
    return;
  }

  try {
    const data = await apiRequest(`/api/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    showToast("success", "Success", escapeHtml(data.message));
    await loadConnections();
    await loadBackups();
  } catch (error) {
    showToast("error", "Error", escapeHtml(error.message));
  }
}

/**
 * Create an instant backup for a connection
 */
async function backupConnection(id, button) {
  if (button) button.disabled = true;

  try {
    const data = await apiRequest(
      `/api/connections/${encodeURIComponent(id)}/backups`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );
    showToast("success", "Success", escapeHtml(data.message));
    await Promise.all([loadConnections(), loadBackups()]);
  } catch (error) {
    console.error("Error creating backup:", error);
    showToast("error", "Error", "Failed to create backup: " + escapeHtml(error.message));
  } finally {
    await loadOperationLogs();
    if (button) button.disabled = false;
  }
}

// ==================== RESTORE ====================

/**
 * Open the restore modal for a target connection.
 * Optionally preselect a source connection and backup file.
 */
async function openRestoreModal(targetId, sourceId = null, filename = null) {
  const target = getConnectionById(targetId);
  if (!target) return;

  document.getElementById("restore-target-id").value = targetId;
  document.getElementById("restore-target-label").textContent =
    `${target.title} (${DB_TYPE_LABELS[target.type]} - ${target.database})`;
  document.getElementById("restore-target-warning").textContent = target.title;

  const sourceSelect = document.getElementById("restore-source");
  const sameType = connections.filter((conn) => conn.type === target.type);
  sourceSelect.innerHTML = sameType
    .map(
      (conn) =>
        `<option value="${escapeHtml(conn.id)}">${escapeHtml(conn.title)}${
          conn.id === targetId ? " (this connection)" : ""
        }</option>`,
    )
    .join("");
  sourceSelect.value = sourceId && getConnectionById(sourceId) ? sourceId : targetId;

  showModal("restore-modal");
  await loadRestoreFiles(sourceSelect.value, filename);
}

/**
 * Fill the backup file dropdown with the source connection's backups
 */
async function loadRestoreFiles(sourceId, selectedFilename = null) {
  const fileSelect = document.getElementById("restore-file");
  const confirmButton = document.getElementById("btn-confirm-restore");
  fileSelect.innerHTML = "<option value=''>Loading...</option>";
  fileSelect.disabled = true;
  confirmButton.disabled = true;

  try {
    const data = await apiRequest(
      `/api/connections/${encodeURIComponent(sourceId)}/backups`,
    );
    const files = data.backups || [];

    if (files.length === 0) {
      fileSelect.innerHTML = "<option value=''>No backups available</option>";
      return;
    }

    fileSelect.innerHTML = files
      .map(
        (file) =>
          `<option value="${escapeHtml(file.filename)}">${escapeHtml(file.filename)} - ${formatFileSize(file.size)} - ${dayjs(file.date).format("YYYY-MM-DD HH:mm")}</option>`,
      )
      .join("");
    if (selectedFilename && files.some((f) => f.filename === selectedFilename)) {
      fileSelect.value = selectedFilename;
    }
    fileSelect.disabled = false;
    confirmButton.disabled = false;
  } catch (error) {
    fileSelect.innerHTML = "<option value=''>Failed to load backups</option>";
    showToast("error", "Error", escapeHtml(error.message));
  }
}

async function confirmRestore() {
  const targetId = document.getElementById("restore-target-id").value;
  const sourceConnectionId = document.getElementById("restore-source").value;
  const filename = document.getElementById("restore-file").value;
  const target = getConnectionById(targetId);

  if (!filename) {
    showToast("error", "Error", "Select a backup file to restore");
    return;
  }
  if (
    !confirm(
      `Restore "${target?.title}" from "${filename}"? This will overwrite current data.`,
    )
  ) {
    return;
  }

  const button = document.getElementById("btn-confirm-restore");
  button.disabled = true;
  hideModal("restore-modal");
  showLoading();

  try {
    const data = await apiRequest(
      `/api/connections/${encodeURIComponent(targetId)}/restore`,
      {
        method: "POST",
        body: JSON.stringify({ sourceConnectionId, filename }),
      },
    );
    showToast("success", "Success", escapeHtml(data.message));
  } catch (error) {
    console.error("Error restoring backup:", error);
    showToast("error", "Error", "Failed to restore backup: " + escapeHtml(error.message));
  } finally {
    await loadOperationLogs();
    hideLoading();
    button.disabled = false;
  }
}

// ==================== UPLOAD ====================

function updateUploadAcceptHint() {
  const conn = getConnectionById(document.getElementById("upload-connection").value);
  const formats = conn ? getDriverFormats(conn.type) : [];
  const accept = formats.map((f) => `.${f}`).join(",");
  document.getElementById("backup-file-input").accept = accept;
  document.getElementById("upload-accept-hint").textContent = accept
    ? `Accepted files: ${accept.replace(/,/g, ", ")}`
    : "";
}

function openUploadModal() {
  if (connections.length === 0) {
    showToast("error", "Error", "Add a connection before uploading a backup");
    return;
  }

  const select = document.getElementById("upload-connection");
  select.innerHTML = connections
    .map(
      (conn) =>
        `<option value="${escapeHtml(conn.id)}">${escapeHtml(conn.title)} (${DB_TYPE_LABELS[conn.type]})</option>`,
    )
    .join("");
  const filter = document.getElementById("backup-connection-filter").value;
  if (filter) select.value = filter;
  updateUploadAcceptHint();
  showModal("upload-modal");
}

/**
 * Load scheduler status
 */
async function loadSchedulerStatus() {
  try {
    const data = await apiRequest("/api/scheduler");

    schedulerRunning = data.running;

    const toggle = document.getElementById("toggle-scheduler");
    const statusBadge = document.getElementById("scheduler-status");

    toggle.checked = schedulerRunning;

    if (schedulerRunning) {
      statusBadge.textContent = "Running";
      statusBadge.className = "status-badge status-badge-active";
    } else {
      statusBadge.textContent = "Stopped";
      statusBadge.className = "status-badge status-badge-inactive";
    }
  } catch (error) {
    console.error("Error loading scheduler status:", error);
  }
}

// ==================== BACKUP ACTIONS ====================

/**
 * Upload a backup file for the connection selected in the upload modal
 */
async function uploadBackupFile(file) {
  if (!file) {
    return;
  }

  const connectionId = document.getElementById("upload-connection").value;
  const conn = getConnectionById(connectionId);
  const formats = conn ? getDriverFormats(conn.type) : [];
  const ext = file.name.toLowerCase().split(".").pop();
  if (!formats.includes(ext)) {
    showToast(
      "error",
      "Error",
      `Only ${formats.map((f) => `.${f}`).join(", ")} files are allowed for this connection`,
    );
    return;
  }

  showLoading();

  try {
    const formData = new FormData();
    formData.append("connectionId", connectionId);
    formData.append("backupFile", file);

    const response = await fetch("/api/backups/upload", {
      method: "POST",
      body: formData,
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Upload failed");
    }

    showToast("success", "Success", data.message);
    await Promise.all([loadConnections(), loadBackups()]);
  } catch (error) {
    console.error("Error uploading backup file:", error);
    showToast("error", "Error", "Failed to upload backup file: " + error.message);
  } finally {
    await loadOperationLogs();
    hideLoading();
  }
}

/**
 * Download backup
 */
function downloadBackup(connectionId, filename) {
  window.location.href = `/api/backups/${encodeURIComponent(
    connectionId,
  )}/${encodeURIComponent(filename)}/download`;
}

/**
 * Load and display current config mode
 */
async function loadConfigMode() {
  try {
    const data = await apiRequest("/api/config/mode");
    configMode = data.mode;

    const toggle = document.getElementById("config-mode-switch");
    const badge = document.getElementById("config-mode-status");

    toggle.checked = configMode === "manual";
    badge.textContent = configMode.toUpperCase();
    badge.className =
      "config-mode-badge " + (configMode === "manual" ? "manual" : "env");

    // Update UI first (enable/disable fields)
    updateUIForConfigMode();

    // Then populate form fields based on mode
    if (configMode === "manual" && data.manualConfig) {
      // Show manual values in form (editable)
      populateFormFromConfig(data.manualConfig);
    } else {
      // ENV mode: clear all fields (don't show ENV values for security)
      clearFormFields();
    }
  } catch (error) {
    console.error("Error loading config mode:", error);
  }
}

/**
 * Populate form fields from config object
 */
function populateFormFromConfig(config) {
  // Database fields
  if (config.database) {
    const db = config.database;
    document.getElementById("input-db-host").value = db.host || "";
    document.getElementById("input-db-port").value = db.port || "";
    document.getElementById("input-db-user").value = db.user || "";
    document.getElementById("input-db-name").value = db.database || "";
    document.getElementById("input-schema").value = db.schema || "";
    document.getElementById("input-exclude-tables").value = Array.isArray(
      db.excludeTables,
    )
      ? db.excludeTables.join(", ")
      : db.excludeTables || "";
    document.getElementById("input-db-password").value = db.password || "";
    const sslCheckbox = document.getElementById("input-ssl-mode");
    const sslBadge = document.getElementById("ssl-mode-status");
    sslCheckbox.checked = db.sslMode === "on";
    sslBadge.textContent = db.sslMode === "on" ? "ON" : "OFF";
    sslBadge.className =
      "config-mode-badge " + (db.sslMode === "on" ? "manual" : "env");
  }

  // Backup fields
  if (config.backup) {
    const backup = config.backup;
    document.getElementById("input-backup-format").value =
      backup.format || "sql";
    document.getElementById("input-retention").value =
      backup.retentionDays || 7;
    document.getElementById("input-schedule").value =
      backup.schedule || "0 2 * * *";
    document.getElementById("input-storage").value = backup.storage || "local";
  }

  // S3 fields
  if (config.s3) {
    const s3 = config.s3;
    document.getElementById("input-access-key").value = s3.accessKeyId || "";
    document.getElementById("input-secret-key").value =
      s3.secretAccessKey || "";
    document.getElementById("input-bucket").value = s3.bucket || "";
    document.getElementById("input-region").value = s3.region || "";
    document.getElementById("input-prefix").value = s3.prefix || "";
    document.getElementById("input-endpoint").value = s3.endpoint || "";

    // Show force path style status (auto-detected or manual)
    const forcePathStyleCheckbox = document.getElementById(
      "input-force-path-style",
    );
    forcePathStyleCheckbox.checked = s3.s3ForcePathStyle || false;

    // Update hint to show current detection
    updateForcePathStyleHint(s3.endpoint, s3.s3ForcePathStyle);
  }
}

/**
 * Update force path style hint based on endpoint
 */
function updateForcePathStyleHint(endpoint, currentValue) {
  const checkbox = document.getElementById("input-force-path-style");
  const hintText = checkbox.closest(".form-group").querySelector(".form-hint");

  if (!endpoint) {
    hintText.innerHTML =
      "✨ Auto-detected based on endpoint (Supabase, MinIO, localhost → enabled; AWS S3 → disabled)";
    return;
  }

  const endpointLower = endpoint.toLowerCase();
  const shouldForce =
    endpointLower.includes("supabase.co") ||
    endpointLower.includes("minio") ||
    endpointLower.includes("localhost") ||
    endpointLower.includes("127.0.0.1") ||
    endpointLower.includes("digitaloceanspaces.com");

  const status = currentValue ? "✅ Enabled" : "❌ Disabled";
  const detection = shouldForce
    ? "(Auto-detected: should be enabled)"
    : "(Auto-detected: should be disabled)";

  hintText.innerHTML = `${status} ${detection}`;
}

/**
 * Clear all form fields (for ENV mode)
 */
function clearFormFields() {
  // Database fields
  document.getElementById("input-db-host").value = "";
  document.getElementById("input-db-port").value = "";
  document.getElementById("input-db-user").value = "";
  document.getElementById("input-db-name").value = "";
  document.getElementById("input-db-password").value = "";
  document.getElementById("input-schema").value = "";
  document.getElementById("input-exclude-tables").value = "";
  document.getElementById("input-ssl-mode").checked = false;
  document.getElementById("ssl-mode-status").textContent = "OFF";
  document.getElementById("ssl-mode-status").className =
    "config-mode-badge env";

  // Backup fields
  document.getElementById("input-backup-format").value = "sql";
  document.getElementById("input-retention").value = "7";
  document.getElementById("input-schedule").value = "0 2 * * *";
  document.getElementById("input-storage").value = "local";

  // S3 fields
  document.getElementById("input-access-key").value = "";
  document.getElementById("input-secret-key").value = "";
  document.getElementById("input-secret-key").placeholder = "secret123...";
  document.getElementById("input-bucket").value = "";
  document.getElementById("input-region").value = "";
  document.getElementById("input-prefix").value = "";
  document.getElementById("input-endpoint").value = "";
  document.getElementById("input-force-path-style").checked = false;
}

/**
 * Toggle config mode between ENV and Manual
 */
async function toggleConfigMode(isManual) {
  try {
    const mode = isManual ? "manual" : "env";
    await apiRequest("/api/config/mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });

    configMode = mode;
    const badge = document.getElementById("config-mode-status");
    badge.textContent = mode.toUpperCase();
    badge.className =
      "config-mode-badge " + (mode === "manual" ? "manual" : "env");

    // Reload config to populate form with appropriate values
    await loadConfigMode();
    await loadConnections();

    showToast(
      "success",
      "Success",
      `Configuration mode changed to ${mode.toUpperCase()}`,
    );
  } catch (error) {
    console.error("Error toggling config mode:", error);
    showToast(
      "error",
      "Error",
      "Failed to change config mode: " + error.message,
    );
    // Revert toggle
    document.getElementById("config-mode-switch").checked =
      configMode === "manual";
  }
}

/**
 * Update UI based on current config mode
 */
function updateUIForConfigMode() {
  const isManual = configMode === "manual";

  // Show/hide reset button (only in manual mode)
  const resetBtn = document.getElementById("btn-reset-manual-config");
  if (resetBtn) {
    resetBtn.style.display = isManual ? "inline-flex" : "none";
  }

  // Update scheduler toggle and add visual feedback to parent
  const schedulerToggle = document.getElementById("toggle-scheduler");
  const schedulerContainer = document.querySelector(".scheduler-toggle");
  if (schedulerToggle) {
    schedulerToggle.disabled = !isManual;
    if (schedulerContainer) {
      if (isManual) {
        schedulerContainer.classList.remove("disabled");
      } else {
        schedulerContainer.classList.add("disabled");
      }
    }
  }

  // Update all input fields in config modal tabs
  // Get all inputs, selects, and checkboxes
  const allInputs = document.querySelectorAll(
    "#tab-database input, #tab-database select, " +
      "#tab-backup input, #tab-backup select, " +
      "#tab-storage input, #tab-storage select",
  );

  allInputs.forEach((input) => {
    if (input.type === "checkbox") {
      input.disabled = !isManual;
    } else if (input.tagName === "SELECT") {
      input.disabled = !isManual;
    } else if (
      input.type === "number" ||
      input.type === "text" ||
      input.type === "password"
    ) {
      input.readOnly = !isManual;
    }
  });

  // Show/hide manual config save buttons
  const saveButtons = document.querySelectorAll(".manual-save-btn");
  saveButtons.forEach((btn) => {
    btn.style.display = isManual ? "inline-block" : "none";
  });

  // Show/hide ENV/Manual mode info boxes in all tabs
  // Database tab
  const dbEnvInfo = document.getElementById("database-env-info");
  const dbManualInfo = document.getElementById("database-manual-info");
  if (dbEnvInfo) dbEnvInfo.style.display = isManual ? "none" : "block";
  if (dbManualInfo) dbManualInfo.style.display = isManual ? "block" : "none";

  // Storage tab
  const storageEnvInfo = document.getElementById("storage-env-info");
  const storageManualInfo = document.getElementById("storage-manual-info");
  if (storageEnvInfo)
    storageEnvInfo.style.display = isManual ? "none" : "block";
  if (storageManualInfo)
    storageManualInfo.style.display = isManual ? "block" : "none";

  // Backup tab
  const backupEnvMode = document.getElementById("backup-env-mode");
  const backupManualMode = document.getElementById("backup-manual-mode");
  if (backupEnvMode) backupEnvMode.style.display = isManual ? "none" : "block";
  if (backupManualMode)
    backupManualMode.style.display = isManual ? "block" : "none";
}

/**
 * Save manual database config
 */
async function saveManualDatabaseConfig() {
  const config = {
    host: document.getElementById("input-db-host").value,
    port: parseInt(document.getElementById("input-db-port").value),
    database: document.getElementById("input-db-name").value,
    user: document.getElementById("input-db-user").value,
    password: document.getElementById("input-db-password").value,
    schema: document.getElementById("input-schema").value.trim() || null,
    excludeTables: document.getElementById("input-exclude-tables").value.trim(),
    sslMode: document.getElementById("input-ssl-mode").checked ? "on" : "off",
  };

  try {
    await apiRequest("/api/config/manual/database", {
      method: "POST",
      body: JSON.stringify(config),
    });

    showToast("success", "Success", "Database configuration saved");
    await loadConnections();
  } catch (error) {
    console.error("Error saving database config:", error);
    showToast(
      "error",
      "Error",
      "Failed to save database config: " + error.message,
    );
  }
}

/**
 * Save manual backup config
 */
async function saveManualBackupConfig() {
  const config = {
    format: document.getElementById("input-backup-format").value,
    retentionDays: parseInt(document.getElementById("input-retention").value),
    storage: document.getElementById("input-storage").value,
    schedule: document.getElementById("input-schedule").value,
    auto: false, // Will be controlled by scheduler toggle
    localPath: "./backups",
  };

  try {
    await apiRequest("/api/config/manual/backup", {
      method: "POST",
      body: JSON.stringify(config),
    });

    showToast("success", "Success", "Backup configuration saved");
  } catch (error) {
    console.error("Error saving backup config:", error);
    showToast(
      "error",
      "Error",
      "Failed to save backup config: " + error.message,
    );
  }
}

/**
 * Save manual S3 config
 */
async function saveManualS3Config() {
  const config = {
    accessKeyId: document.getElementById("input-access-key").value,
    secretAccessKey: document.getElementById("input-secret-key").value,
    region: document.getElementById("input-region").value,
    bucket: document.getElementById("input-bucket").value,
    prefix: document.getElementById("input-prefix").value,
    endpoint: document.getElementById("input-endpoint").value,
    s3ForcePathStyle: document.getElementById("input-force-path-style").checked,
  };

  try {
    await apiRequest("/api/config/manual/s3", {
      method: "POST",
      body: JSON.stringify(config),
    });

    showToast("success", "Success", "S3 configuration saved");
  } catch (error) {
    console.error("Error saving S3 config:", error);
    showToast("error", "Error", "Failed to save S3 config: " + error.message);
  }
}

/**
 * Reset manual configuration
 */
async function resetManualConfig() {
  if (
    !confirm(
      "Are you sure you want to reset all manual configuration? This will clear all saved settings (Database, Backup, and S3 configuration).",
    )
  ) {
    return;
  }

  try {
    const data = await apiRequest("/api/config/reset", {
      method: "POST",
    });

    // Clear form fields and reload config
    clearFormFields();
    await loadConfigMode();
    await loadConnections();

    showToast("success", "Success", data.message);
  } catch (error) {
    console.error("Error resetting config:", error);
    showToast("error", "Error", "Failed to reset config: " + error.message);
  }
}

/**
 * Delete backup
 */
async function deleteBackup(connectionId, filename) {
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) {
    return;
  }

  showLoading();

  try {
    const data = await apiRequest(
      `/api/backups/${encodeURIComponent(connectionId)}/${encodeURIComponent(filename)}`,
      {
        method: "DELETE",
      },
    );

    showToast("success", "Success", data.message);
    await Promise.all([loadConnections(), loadBackups()]);
  } catch (error) {
    console.error("Error deleting backup:", error);
    showToast("error", "Error", "Failed to delete backup: " + error.message);
  } finally {
    hideLoading();
  }
}

// ==================== SCHEDULER ACTIONS ====================

/**
 * Toggle scheduler
 */
async function toggleScheduler(enabled) {
  try {
    if (enabled) {
      const data = await apiRequest("/api/scheduler", {
        method: "POST",
      });
      showToast("success", "Success", data.message);
    } else {
      const data = await apiRequest("/api/scheduler", {
        method: "DELETE",
      });
      showToast("success", "Success", data.message);
    }

    // Refresh scheduler status after toggle
    await loadSchedulerStatus();
  } catch (error) {
    console.error("Error toggling scheduler:", error);
    showToast("error", "Error", "Failed to toggle scheduler: " + error.message);

    // Revert toggle on error
    document.getElementById("toggle-scheduler").checked = !enabled;
  }
}

// ==================== CONFIG MODAL ====================

/**
 * Show configuration modal
 */
function showConfigModal() {
  // Reload config mode to populate form with correct values
  loadConfigMode();
  document.getElementById("config-modal").classList.add("show");
  switchTab("database");
}

/**
 * Hide configuration modal
 */
function hideConfigModal() {
  document.getElementById("config-modal").classList.remove("show");
}

/**
 * Switch configuration tab
 */
function switchTab(tabName) {
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });

  document.querySelectorAll(".config-tab").forEach((btn) => {
    btn.classList.remove("active");
  });

  document.getElementById(`tab-${tabName}`).classList.add("active");

  document.querySelector(`[data-tab="${tabName}"]`).classList.add("active");
}

// ==================== EVENT LISTENERS ====================

document.addEventListener("DOMContentLoaded", () => {
  // Set dynamic copyright year
  const yearElement = document.getElementById("current-year");
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  loadConnections().then(loadBackups);
  loadOperationLogs();
  loadSchedulerStatus();
  loadConfigMode();

  document
    .getElementById("btn-add-connection")
    .addEventListener("click", () => openConnectionModal());
  document.getElementById("conn-type").addEventListener("change", (e) => {
    document.getElementById("conn-port").value = DEFAULT_PORTS[e.target.value];
    updateConnectionTypeFields(e.target.value);
  });
  document
    .getElementById("connection-form")
    .addEventListener("submit", saveConnection);
  document
    .getElementById("btn-test-connection")
    .addEventListener("click", testConnectionForm);

  document.getElementById("restore-source").addEventListener("change", (e) => {
    loadRestoreFiles(e.target.value);
  });
  document
    .getElementById("btn-confirm-restore")
    .addEventListener("click", confirmRestore);

  document
    .getElementById("backup-connection-filter")
    .addEventListener("change", loadBackups);

  const uploadButton = document.getElementById("btn-upload");
  const backupFileInput = document.getElementById("backup-file-input");
  uploadButton.addEventListener("click", openUploadModal);
  document
    .getElementById("upload-connection")
    .addEventListener("change", updateUploadAcceptHint);
  document
    .getElementById("btn-choose-upload-file")
    .addEventListener("click", () => {
      backupFileInput.click();
    });
  backupFileInput.addEventListener("change", async (e) => {
    const [file] = e.target.files || [];
    hideModal("upload-modal");
    await uploadBackupFile(file);
    e.target.value = "";
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => hideModal(button.dataset.closeModal));
  });
  ["connection-modal", "restore-modal", "upload-modal"].forEach((id) => {
    document.getElementById(id).addEventListener("click", (e) => {
      if (e.target.id === id) hideModal(id);
    });
  });

  document.getElementById("btn-refresh").addEventListener("click", () => {
    loadConnections().then(loadBackups);
  });
  document
    .getElementById("btn-refresh-logs")
    .addEventListener("click", loadOperationLogs);
  document
    .getElementById("btn-clear-logs")
    .addEventListener("click", clearOperationLogs);

  document
    .getElementById("btn-config")
    .addEventListener("click", showConfigModal);

  document
    .getElementById("toggle-scheduler")
    .addEventListener("change", (e) => {
      toggleScheduler(e.target.checked);
    });

  // Config mode toggle - fixed to use correct ID
  const configModeToggle = document.getElementById("config-mode-switch");
  if (configModeToggle) {
    configModeToggle.addEventListener("change", (e) => {
      toggleConfigMode(e.target.checked);
    });
  }

  // SSL mode toggle - update badge on change
  const sslToggle = document.getElementById("input-ssl-mode");
  if (sslToggle) {
    sslToggle.addEventListener("change", (e) => {
      const badge = document.getElementById("ssl-mode-status");
      badge.textContent = e.target.checked ? "ON" : "OFF";
      badge.className =
        "config-mode-badge " + (e.target.checked ? "manual" : "env");
    });
  }

  // Reset manual config button
  const resetBtn = document.getElementById("btn-reset-manual-config");
  if (resetBtn) {
    resetBtn.addEventListener("click", resetManualConfig);
  }

  // Manual config save buttons
  document
    .getElementById("btn-save-db-manual")
    .addEventListener("click", saveManualDatabaseConfig);
  document
    .getElementById("btn-save-backup-manual")
    .addEventListener("click", saveManualBackupConfig);
  document
    .getElementById("btn-save-s3-manual")
    .addEventListener("click", saveManualS3Config);

  document
    .getElementById("config-modal-close")
    .addEventListener("click", hideConfigModal);

  // Prevent form submissions (we use manual save buttons)
  document.getElementById("config-form").addEventListener("submit", (e) => {
    e.preventDefault();
  });
  document.getElementById("storage-form").addEventListener("submit", (e) => {
    e.preventDefault();
  });

  document.querySelectorAll(".config-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      switchTab(e.target.dataset.tab);
    });
  });

  document.getElementById("config-modal").addEventListener("click", (e) => {
    if (e.target.id === "config-modal") {
      hideConfigModal();
    }
  });

  // Password toggle buttons
  document.querySelectorAll(".toggle-password").forEach((button) => {
    button.addEventListener("click", () => {
      togglePasswordVisibility(button);
    });
  });

  // Operation logs are refreshed on-demand and after operation completion.
});

window.downloadBackup = downloadBackup;
window.deleteBackup = deleteBackup;
window.hideConfigModal = hideConfigModal;
