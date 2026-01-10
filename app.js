import { firebaseConfig } from "./firebase-config.js";
import { processTags } from "./utils.js";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let CURRENT_USER_ID = null;
let CURRENT_USER_EMAIL = null;
let CURRENT_USER_NAME = "User";
let CURRENT_USER_DESIGNATION = "";

const ADMIN_EMAILS = ["jay@sbi.com", "ss@sbi.com", "ravi@sbi.com", "shyam@sbi.com"];
const DEFAULT_AVATAR = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23e0e0e0%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20font-family%3D%22sans-serif%22%20font-size%3D%2235%22%20fill%3D%22%23888%22%20dy%3D%22.3em%22%20text-anchor%3D%22middle%22%3EPL%3C%2Ftext%3E%3C%2Fsvg%3E";

// PO-wise state variables
let currentPLId = null;       // Currently selected PL
let currentPOId = null;       // Currently selected PO (null = All POs)
let poListForPL = [];         // Array of POs for the selected PL
let poMapForPL = {};          // Map of poId -> PO data for quick lookup
let filterChatByPO = false;   // Whether to filter chat by selected PO
let poModalMode = 'create';   // 'create' or 'update'
let messagesUnsubscribe = null; // Firestore listener cleanup


/* --- AUTH --- */
auth.onAuthStateChanged(user => {
    if (user) {
        CURRENT_USER_ID = user.uid;
        CURRENT_USER_EMAIL = user.email;
        document.getElementById("login-overlay").style.display = "none";
        document.getElementById("app-container").style.display = "flex";
        if (ADMIN_EMAILS.includes(CURRENT_USER_EMAIL)) {
            document.getElementById("btn-trash").style.display = "block";
            document.getElementById("menu-master-data").style.display = "block";
        } else {
            document.getElementById("btn-trash").style.display = "none";
            document.getElementById("menu-master-data").style.display = "none";
        }
        loadUserProfile();
        setupPLListener();
    } else {
        CURRENT_USER_ID = null;
        document.getElementById("app-container").style.display = "none";
        document.getElementById("login-overlay").style.display = "flex";
    }
});

/* --- PROFILE & DATA --- */
async function loadUserProfile() {
    const doc = await db.collection("Users").doc(CURRENT_USER_ID).get();
    if (doc.exists) {
        const data = doc.data();
        CURRENT_USER_NAME = data.displayName || getUsername(CURRENT_USER_EMAIL);
        CURRENT_USER_DESIGNATION = data.designation || "";
    } else {
        CURRENT_USER_NAME = getUsername(CURRENT_USER_EMAIL);
        await db.collection("Users").doc(CURRENT_USER_ID).set({ displayName: CURRENT_USER_NAME, email: CURRENT_USER_EMAIL, designation: "" });
    }
    updateProfileUI();
}
function updateProfileUI() {
    document.getElementById("user-name-display").textContent = `👤 ${CURRENT_USER_NAME}`;
    document.getElementById("profile-name").value = CURRENT_USER_NAME;
    document.getElementById("profile-designation").value = CURRENT_USER_DESIGNATION;
}
window.saveUserProfile = async () => {
    const newName = document.getElementById("profile-name").value.trim();
    const newDesig = document.getElementById("profile-designation").value.trim();
    if (!newName) return alert("Name cannot be empty");
    await db.collection("Users").doc(CURRENT_USER_ID).update({ displayName: newName, designation: newDesig });
    CURRENT_USER_NAME = newName; CURRENT_USER_DESIGNATION = newDesig;
    updateProfileUI(); closeEditProfile(); alert("Profile Updated!");
};

/* --- DASHBOARD LOGIC (NEW) --- */
window.openDashboard = () => {
    // 1. Calculate Stats
    let counts = { Total: 0, Urgent: 0, TPI: 0, Received: 0, Escalated: 0, Delayed: 0, OnTime: 0, Normal: 0 };
    let criticalItems = [];

    allPLs.forEach(pl => {
        if (pl.status === 'Deleted') return;

        counts.Total++;
        if (counts[pl.status] !== undefined) counts[pl.status]++;
        else counts.Normal++;

        // Add to critical list if Urgent or Escalated
        if (pl.status === 'Urgent' || pl.status === 'Escalated') {
            criticalItems.push(pl);
        }
    });

    // 2. Update UI Numbers
    document.getElementById("dash-total").textContent = counts.Total;
    document.getElementById("dash-urgent").textContent = counts.Urgent;
    document.getElementById("dash-tpi").textContent = counts.TPI;
    document.getElementById("dash-received").textContent = counts.Received;
    document.getElementById("dash-esc").textContent = counts.Escalated;
    document.getElementById("dash-delay").textContent = counts.Delayed;
    document.getElementById("dash-ontime").textContent = counts.OnTime;
    document.getElementById("dash-normal").textContent = counts.Normal;

    // 3. Render Critical List
    const listContainer = document.getElementById("dashboard-critical-list");
    listContainer.innerHTML = "";
    if (criticalItems.length === 0) {
        listContainer.innerHTML = `<div style="padding:10px; text-align:center; color:#888;">No critical items found. ✅</div>`;
    } else {
        criticalItems.forEach(pl => {
            const div = document.createElement("div");
            div.className = "dash-item";
            div.innerHTML = `<span><strong>${pl.id}</strong> - <span style="color:${pl.status === 'Urgent' ? '#d32f2f' : '#b71c1c'}">[${pl.status}]</span></span> <span>${pl.description.substring(0, 30)}...</span>`;
            div.onclick = () => { closeDashboard(); selectPL(pl.id, pl.description, pl.status); };
            listContainer.appendChild(div);
        });
    }

    document.getElementById("dashboard-modal").style.display = "block";
};
window.closeDashboard = () => { document.getElementById("dashboard-modal").style.display = "none"; };

/* --- REPORTS LOGIC --- */
window.openReportsModal = () => { document.getElementById("reports-modal").style.display = "block"; };
window.closeReportsModal = () => { document.getElementById("reports-modal").style.display = "none"; };

window.downloadAllPLReport = async () => {
    const btn = document.querySelector("#reports-modal .csv-btn");
    const statusEl = document.getElementById("report-status");
    btn.disabled = true;
    statusEl.textContent = "Fetching data... (This may take a moment)";

    try {
        const poSnap = await db.collection("POs").get();
        const poMap = {};
        poSnap.forEach(doc => { poMap[doc.id] = doc.data(); });

        const data = [];
        allPLs.forEach(pl => {
            const poNumbers = pl.relatedPOs || [];
            let suppliers = [];
            let qtys = [];

            poNumbers.forEach(poNum => {
                if (poMap[poNum]) {
                    if (poMap[poNum].supplier) suppliers.push(poMap[poNum].supplier);
                    if (poMap[poNum].qty) qtys.push(`${poNum}: ${poMap[poNum].qty}`);
                }
            });

            data.push({
                "PL Number": pl.id,
                "Description": pl.description,
                "Current Status": pl.status || "Normal",
                "Last Activity": pl.lastActivity ? new Date(pl.lastActivity).toLocaleString('en-GB') : "",
                "Related POs": poNumbers.join(", "),
                "Suppliers": [...new Set(suppliers)].join(", "),
                "Quantities": qtys.join("; ")
            });
        });

        const csv = Papa.unparse(data);
        downloadCSV(csv, `Master_Report_${new Date().toISOString().slice(0, 10)}.csv`);
        statusEl.textContent = "✅ Download Started!";
    } catch (e) {
        console.error(e);
        statusEl.textContent = "❌ Error: " + e.message;
    } finally {
        btn.disabled = false;
    }
};

window.exportChannelChat = async () => {
    if (!selectedPL) return alert("Please select a channel first.");
    const btn = document.getElementById("export-chat-btn");
    const originalText = btn.innerHTML;
    btn.innerHTML = "⏳";

    try {
        const snap = await db.collection("PLs").doc(selectedPL).collection("Messages").orderBy("timestamp", "asc").get();
        const data = [];
        snap.forEach(doc => {
            const m = doc.data();
            if (m.isDeleted) return;
            const tags = [];
            if (m.text && m.text.includes("#")) {
                const words = m.text.split(" ");
                words.forEach(w => { if (w.startsWith("#")) tags.push(w); });
            }
            data.push({
                "Date": new Date(m.timestamp).toLocaleDateString('en-GB'),
                "Time": new Date(m.timestamp).toLocaleTimeString('en-GB'),
                "Sender": m.userName || m.userEmail,
                "Designation": m.userDesignation || "",
                "Message": m.text || "[Image]",
                "PO Number": m.po || "",
                "PO Date": m.poDate || "",
                "Supplier": m.supplier || "",
                "Qty": m.qty || "",
                "DPDT": m.dpdt || "",
                "ETA": m.eta || "",
                "Status Tags": tags.join(", ")
            });
        });
        if (data.length === 0) return alert("No messages to export.");
        const csv = Papa.unparse(data);
        downloadCSV(csv, `Chat_${selectedPL}_${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
        alert("Export failed: " + e.message);
    } finally {
        btn.innerHTML = originalText;
    }
};

function downloadCSV(csvString, fileName) {
    const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", fileName);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/* --- IMAGE HANDLING --- */
window.triggerChatUpload = () => { document.getElementById("chat-file-input").click(); };
window.triggerDPUpload = () => { document.getElementById("dp-file-input").click(); };

window.viewChannelDetails = () => {
    const src = document.getElementById("header-pl-img").src;
    const title = document.getElementById("selected-pl-title").textContent;
    const plData = allPLs.find(p => p.id === selectedPL);
    const desc = plData ? plData.description : "No description";
    document.getElementById("detail-pl-img").src = src;
    document.getElementById("detail-pl-title").textContent = title;
    document.getElementById("detail-pl-desc").textContent = desc;
    document.getElementById("channel-details-modal").style.display = "block";
};
window.closeChannelDetails = () => { document.getElementById("channel-details-modal").style.display = "none"; };

window.handleChatImageSelect = async () => {
    const file = document.getElementById("chat-file-input").files[0];
    if (!file) return;
    document.getElementById("upload-progress-container").style.display = "block";
    try {
        const base64String = await compressAndConvertToBase64(file);
        await sendImageMessage(base64String);
    } catch (e) { alert("Error: " + e.message); }
    document.getElementById("upload-progress-container").style.display = "none";
    document.getElementById("chat-file-input").value = "";
};

window.handleDPSelect = async () => {
    const file = document.getElementById("dp-file-input").files[0];
    if (!file) return;
    if (!selectedPL) return alert("Select a channel first!");
    document.getElementById("upload-progress-container").style.display = "block";
    try {
        const base64String = await compressAndConvertToBase64(file);
        await db.collection("PLs").doc(selectedPL).update({ photoUrl: base64String });
        document.getElementById("header-pl-img").src = base64String;
        await db.collection("PLs").doc(selectedPL).collection("Messages").add({
            text: "🖼️ Updated the Channel Photo", isSystem: true,
            uid: CURRENT_USER_ID, userEmail: CURRENT_USER_EMAIL, userName: CURRENT_USER_NAME, userDesignation: CURRENT_USER_DESIGNATION,
            timestamp: Date.now()
        });
    } catch (e) { alert("Error: " + e.message); }
    document.getElementById("upload-progress-container").style.display = "none";
    document.getElementById("dp-file-input").value = "";
};

function compressAndConvertToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / img.width;
                canvas.width = MAX_WIDTH;
                canvas.height = img.height * scaleSize;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
        };
        reader.onerror = (error) => reject(error);
    });
}

async function sendImageMessage(base64String) {
    await db.collection("PLs").doc(selectedPL).collection("Messages").add({
        text: "", imageUrl: base64String,
        uid: CURRENT_USER_ID, userEmail: CURRENT_USER_EMAIL, userName: CURRENT_USER_NAME, userDesignation: CURRENT_USER_DESIGNATION,
        timestamp: Date.now(), isDeleted: false
    });
    await db.collection("PLs").doc(selectedPL).update({ lastActivity: Date.now() });
}

/* --- HELPERS --- */
function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${dateStr}, ${timeStr}`;
}
function formatDateString(isoDate) {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    if (isNaN(date)) return isoDate;
    // Format as DD/MM/YY as requested
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
}
function getUsername(email) { return email ? email.split('@')[0] : "User"; }

/* --- PO MANAGEMENT --- */
// Calculate days until a date (negative if expired)
function daysUntil(dateStr) {
    if (!dateStr) return Infinity;
    const target = new Date(dateStr);
    if (isNaN(target)) return Infinity;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

// Load POs for a specific PL
async function loadPOsForPL(plId) {
    if (!plId) {
        poListForPL = [];
        poMapForPL = {};
        renderPOList();
        populatePODropdown();
        return;
    }

    try {
        // Get POs from the PLs document's relatedPOs array
        const plDoc = await db.collection("PLs").doc(plId).get();
        const relatedPOIds = plDoc.exists ? (plDoc.data().relatedPOs || []) : [];

        // Fetch PO details from POs collection
        poListForPL = [];
        poMapForPL = {};

        for (const poId of relatedPOIds) {
            const poDoc = await db.collection("POs").doc(poId).get();
            if (poDoc.exists) {
                const poData = { id: poDoc.id, ...poDoc.data() };
                poListForPL.push(poData);
                poMapForPL[poDoc.id] = poData;
            } else {
                // PO reference exists but document doesn't - create minimal entry
                const poData = { id: poId, poNo: poId, firmName: 'Unknown', fdp: '', qtyTotal: 0 };
                poListForPL.push(poData);
                poMapForPL[poId] = poData;
            }
        }

        // Sort by DP date (closest first, expired at top)
        poListForPL.sort((a, b) => {
            const daysA = daysUntil(a.fdp || a.dpdt);
            const daysB = daysUntil(b.fdp || b.dpdt);
            // Expired POs first, then by closest DP
            if (daysA < 0 && daysB >= 0) return -1;
            if (daysB < 0 && daysA >= 0) return 1;
            return daysA - daysB;
        });

        renderPOList();
        populatePODropdown();
    } catch (e) {
        console.error("Error loading POs:", e);
        poListForPL = [];
        poMapForPL = {};
    }
}

// Render the PO list in the right panel
function renderPOList() {
    const container = document.getElementById("po-list-body");
    if (!container) return;
    container.innerHTML = "";

    if (poListForPL.length === 0) {
        container.innerHTML = `<div style="padding:20px; text-align:center; color:#666; font-size:12px;">No POs found for this PL</div>`;
        return;
    }

    // Find closest DP and max DP for highlighting
    let closestDPId = null;
    let maxDPId = null;
    let closestDays = Infinity;
    let maxDays = -Infinity;

    poListForPL.forEach(po => {
        const days = daysUntil(po.fdp || po.dpdt);
        if (days >= 0 && days < closestDays) {
            closestDays = days;
            closestDPId = po.id;
        }
        if (days > maxDays) {
            maxDays = days;
            maxDPId = po.id;
        }
    });

    poListForPL.forEach(po => {
        const row = document.createElement("div");
        row.className = "po-row" + (po.id === currentPOId ? " selected" : "");

        const days = daysUntil(po.fdp || po.dpdt);
        const isExpired = days < 0;
        const dpDisplay = po.fdp || po.dpdt || po.poDate || "-";
        const qtyDisplay = po.qtyTotal || po.qty || "-";
        const qsDisplay = po.percentQS || "-";
        const score = po.tpiScore || po.poScore || "-";

        // Score color class
        let scoreClass = "";
        if (typeof score === 'number') {
            if (score >= 80) scoreClass = "score-high";
            else if (score >= 50) scoreClass = "score-mid";
            else scoreClass = "score-low";
        }

        // Highlight pills
        let pillHtml = "";
        if (po.id === closestDPId && closestDays >= 0) pillHtml = `<span class="po-pill closest-dp">Closest</span>`;
        else if (po.id === maxDPId && poListForPL.length > 1) pillHtml = `<span class="po-pill max-dp">Max DP</span>`;
        if (isExpired && (po.extensionCount === 0 || !po.extensionCount)) pillHtml = `<span class="po-pill expired">Expired</span>`;

        row.innerHTML = `
            <span class="po-col po-no">${po.poNo || po.id}${pillHtml}</span>
            <span class="po-col firm" title="${po.firmName || po.supplier || ''}">${po.firmName || po.supplier || '-'}</span>
            <span class="po-col dp">${formatDateString(dpDisplay)}</span>
            <span class="po-col qty">${qtyDisplay}</span>
            <span class="po-col qs">${qsDisplay}</span>
            <span class="po-col score ${scoreClass}">${score}</span>
        `;

        row.onclick = () => selectPOFromList(po.id);
        container.appendChild(row);
    });
}

// Populate the PO dropdown in the header
function populatePODropdown() {
    const select = document.getElementById("po-select");
    if (!select) return;

    select.innerHTML = `<option value="">All POs</option>`;
    poListForPL.forEach(po => {
        const opt = document.createElement("option");
        opt.value = po.id;
        opt.textContent = `${po.poNo || po.id} - ${po.firmName || po.supplier || ''}`;
        if (po.id === currentPOId) opt.selected = true;
        select.appendChild(opt);
    });
}

// Select a PO from the right panel list
function selectPOFromList(poId) {
    currentPOId = poId;
    document.getElementById("po-select").value = poId || "";
    document.getElementById("btn-update-po").disabled = !poId;

    // Update PO link indicator
    updatePOLinkIndicator();

    // Highlight selected row
    document.querySelectorAll(".po-row").forEach(row => row.classList.remove("selected"));
    if (poId) {
        const rows = document.querySelectorAll(".po-row");
        rows.forEach(row => {
            if (row.querySelector(".po-no")?.textContent.includes(poId)) {
                row.classList.add("selected");
            }
        });
    }

    // Re-render messages if filter is on
    if (filterChatByPO && selectedPL) {
        loadMessagesForPL(selectedPL);
    }
}

// Handle PO dropdown change
window.onPOSelect = () => {
    const poId = document.getElementById("po-select").value || null;
    selectPOFromList(poId);
};

// Handle filter checkbox toggle
window.onFilterChatToggle = () => {
    filterChatByPO = document.getElementById("filter-chat-checkbox").checked;
    if (selectedPL) {
        loadMessagesForPL(selectedPL);
    }
};

// Update the PO link indicator in chat controls
function updatePOLinkIndicator() {
    const indicator = document.getElementById("po-link-indicator");
    const textEl = document.getElementById("po-link-text");
    if (!indicator || !textEl) return;

    if (currentPOId && poMapForPL[currentPOId]) {
        const po = poMapForPL[currentPOId];
        indicator.style.display = "block";
        textEl.textContent = `📎 Linking to: ${po.poNo || currentPOId}`;
    } else {
        indicator.style.display = "none";
    }
}

// Toggle PO panel visibility
window.togglePOPanel = () => {
    const panel = document.getElementById("po-panel");
    if (panel) {
        panel.classList.toggle("collapsed");
        const btn = panel.querySelector(".po-panel-toggle");
        if (btn) btn.textContent = panel.classList.contains("collapsed") ? "▶" : "◀";
    }
};

// Open PO modal for create or update
window.openPOModal = (mode) => {
    poModalMode = mode;
    const modal = document.getElementById("po-modal");
    const title = document.getElementById("po-modal-title");

    if (mode === 'update' && currentPOId && poMapForPL[currentPOId]) {
        title.textContent = "Update PO";
        const po = poMapForPL[currentPOId];
        document.getElementById("po-form-number").value = po.poNo || po.id || "";
        document.getElementById("po-form-firm").value = po.firmName || po.supplier || "";
        document.getElementById("po-form-date").value = po.poDate || "";
        document.getElementById("po-form-fdp").value = po.fdp || po.dpdt || "";
        document.getElementById("po-form-qty").value = po.qtyTotal || po.qty || "";
        document.getElementById("po-form-qs").value = po.percentQS || "";
        document.getElementById("po-form-ext").value = po.extensionCount || 0;
        document.getElementById("po-form-tpi-count").value = po.tpiCount || 0;
        document.getElementById("po-form-tpi-score").value = po.tpiScore || "";
        document.getElementById("po-form-status").value = po.status || "Open";
        document.getElementById("po-form-feedback").value = po.satisfaction || "";
        document.getElementById("po-form-number").disabled = true;
    } else {
        title.textContent = "Create New PO";
        document.getElementById("po-form-number").value = "";
        document.getElementById("po-form-firm").value = "";
        document.getElementById("po-form-date").value = "";
        document.getElementById("po-form-fdp").value = "";
        document.getElementById("po-form-qty").value = "";
        document.getElementById("po-form-qs").value = "";
        document.getElementById("po-form-ext").value = "0";
        document.getElementById("po-form-tpi-count").value = "0";
        document.getElementById("po-form-tpi-score").value = "";
        document.getElementById("po-form-status").value = "Open";
        document.getElementById("po-form-feedback").value = "";
        document.getElementById("po-form-number").disabled = false;
    }

    modal.style.display = "block";
};

window.closePOModal = () => {
    document.getElementById("po-modal").style.display = "none";
};

// Save PO (create or update)
window.savePO = async () => {
    const poNo = document.getElementById("po-form-number").value.trim();
    const firmName = document.getElementById("po-form-firm").value.trim();
    const fdp = document.getElementById("po-form-fdp").value;

    if (!poNo) return alert("PO Number is required");
    if (!firmName) return alert("Firm Name is required");
    if (!fdp) return alert("DP/FDP Date is required");
    if (!selectedPL) return alert("No PL selected");

    const poData = {
        poNo,
        firmName,
        supplier: firmName,
        poDate: document.getElementById("po-form-date").value || "",
        fdp,
        dpdt: fdp,
        qtyTotal: parseInt(document.getElementById("po-form-qty").value) || 0,
        qty: document.getElementById("po-form-qty").value || "",
        percentQS: parseInt(document.getElementById("po-form-qs").value) || 0,
        extensionCount: parseInt(document.getElementById("po-form-ext").value) || 0,
        tpiCount: parseInt(document.getElementById("po-form-tpi-count").value) || 0,
        tpiScore: parseInt(document.getElementById("po-form-tpi-score").value) || 0,
        status: document.getElementById("po-form-status").value || "Open",
        satisfaction: document.getElementById("po-form-feedback").value || "",
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    try {
        if (poModalMode === 'create') {
            poData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            // Save to POs collection
            await db.collection("POs").doc(poNo).set(poData, { merge: true });
            // Add to PL's relatedPOs array
            await db.collection("PLs").doc(selectedPL).update({
                relatedPOs: firebase.firestore.FieldValue.arrayUnion(poNo)
            });
        } else {
            // Update existing PO
            await db.collection("POs").doc(currentPOId).update(poData);
        }

        closePOModal();
        await loadPOsForPL(selectedPL);
        alert(poModalMode === 'create' ? "PO Created!" : "PO Updated!");
    } catch (e) {
        console.error("Error saving PO:", e);
        alert("Error: " + e.message);
    }
};

// Load messages for a PL (with optional PO filter)
function loadMessagesForPL(plId) {
    // Cleanup previous listener
    if (messagesUnsubscribe) {
        messagesUnsubscribe();
        messagesUnsubscribe = null;
    }

    const box = document.getElementById("chat-box");
    box.innerHTML = "";

    let query = db.collection("PLs").doc(plId).collection("Messages").orderBy("timestamp", "asc");

    messagesUnsubscribe = query.onSnapshot(snap => {
        box.innerHTML = "";
        snap.forEach(doc => {
            const m = doc.data();

            // Filter by PO if enabled
            if (filterChatByPO && currentPOId) {
                const msgPO = m.poId || m.po || null;
                if (msgPO !== currentPOId) return;
            }

            const div = document.createElement("div");
            div.className = "message" + (m.uid === CURRENT_USER_ID ? " you" : "");
            if (m.isDeleted) div.classList.add("deleted");

            const senderName = m.userName || getUsername(m.userEmail);
            const senderDesig = m.userDesignation ? `<span class="msg-designation">${m.userDesignation}</span>` : "";
            const userHtml = `<span class="msg-sender">${senderName}</span>${senderDesig}`;

            let bodyHtml = "";
            if (m.isDeleted) {
                bodyHtml = `<div class="msg-text-content">🚫 This message was deleted</div>`;
            } else {
                // PO metadata header - only show if PO is valid
                const msgPO = m.poId || m.po;
                if (msgPO) {
                    const poData = poMapForPL[msgPO];
                    // Only show PO header if PO exists in current PL's list OR has snapshot data
                    const hasSnapshot = m.poNoSnapshot || m.firmSnapshot;
                    const isValidPO = poData || hasSnapshot;

                    if (isValidPO) {
                        const poNo = m.poNoSnapshot || (poData && poData.poNo) || msgPO;
                        const firm = m.firmSnapshot || (poData && (poData.firmName || poData.supplier)) || "";
                        const qty = m.qtySnapshot || (poData && (poData.qtyTotal || poData.qty)) || "";
                        const fdp = m.fdpSnapshot || (poData && (poData.fdp || poData.dpdt)) || "";
                        bodyHtml += `<div class="msg-po-header">
                            <span class="po-num">PO: ${poNo}</span>
                            <span class="po-firm">Firm: ${firm}</span>
                            ${qty ? `<span class="po-qty">Qty: ${qty}</span>` : ''}
                            ${fdp ? `<span class="po-fdp">FDP: ${formatDateString(fdp)}</span>` : ''}
                        </div>`;
                    } else {
                        // PO reference exists but is not valid (fake PO)
                        bodyHtml += `<div class="msg-po-header msg-invalid-po">⚠️ Invalid PO: ${msgPO}</div>`;
                    }
                } else if (m.poId === null) {
                    // Legacy unlinked message - show warning that PO selection is now required  
                    bodyHtml += `<div class="msg-po-header msg-unlinked">⚠️ Legacy message (no PO linked)</div>`;
                }

                if (m.imageUrl) bodyHtml += `<img src="${m.imageUrl}" class="msg-image" onclick="window.open('${m.imageUrl}')">`;
                if (m.text || m.po) {
                    let metaHtml = "";
                    if (m.po || m.supplier || m.eta || m.qty || m.dpdt || m.poDate) {
                        metaHtml += `<div class="msg-meta-box">`;
                        if (m.po || m.poDate) {
                            metaHtml += `<div class="meta-row">`;
                            if (m.po) metaHtml += `<span><span class="meta-label">PO:</span> <span class="meta-val">${m.po}</span></span>`;
                            if (m.poDate) metaHtml += `<span><span class="meta-label">Dt:</span> <span class="meta-val">${m.poDate}</span></span>`;
                            metaHtml += `</div>`;
                        }
                        if (m.supplier) metaHtml += `<div class="meta-row"><span class="meta-label">Sup:</span> <span class="meta-val">${m.supplier}</span></div>`;
                        if (m.qty || m.dpdt) {
                            metaHtml += `<div class="meta-row">`;
                            if (m.qty) metaHtml += `<span><span class="meta-label">Qty:</span> <span class="meta-val">${m.qty}</span></span>`;
                            if (m.dpdt) metaHtml += `<span><span class="meta-label">DPDT:</span> <span class="meta-val">${m.dpdt}</span></span>`;
                            metaHtml += `</div>`;
                        }
                        if (m.eta) metaHtml += `<div class="meta-row"><span class="meta-label">ETA:</span> <span class="meta-val">${m.eta}</span></div>`;
                        metaHtml += `</div>`;
                    }
                    bodyHtml += metaHtml + processTags(m.text);
                }
            }

            let deleteBtn = "";
            const isAdmin = ADMIN_EMAILS.includes(CURRENT_USER_EMAIL);
            if ((m.uid === CURRENT_USER_ID || isAdmin) && !m.isDeleted) {
                deleteBtn = `<span id="btn-${m.timestamp}" class="msg-delete-btn" onclick="deleteMessage('${doc.id}', '${plId}', ${m.timestamp}, 'btn-${m.timestamp}')">🗑️</span>`;
            }

            const timeHtml = `<span class="msg-time">${formatTime(m.timestamp)}${deleteBtn}</span>`;
            div.innerHTML = userHtml + bodyHtml + timeHtml;
            box.appendChild(div);
        });
        box.scrollTop = box.scrollHeight;
    });
}


/* --- PL LIST --- */
let allPLs = []; let currentFilter = 'All'; let selectedPL = null;
function setupPLListener() { db.collection("PLs").onSnapshot(snap => { allPLs = []; snap.forEach(doc => { allPLs.push({ id: doc.id, ...doc.data() }); }); renderPLList(); }); }

window.renderPLList = () => {
    const listEl = document.getElementById("pl-list");
    listEl.innerHTML = "";
    const searchText = document.getElementById("pl-search").value.toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(CURRENT_USER_EMAIL);

    allPLs.sort((a, b) => {
        const timeA = a.lastActivity || a.created || 0;
        const timeB = b.lastActivity || b.created || 0;
        return timeB - timeA;
    });

    allPLs.forEach(pl => {
        const desc = pl.description ? pl.description.toLowerCase() : "";
        const matchesSearch = pl.id.toLowerCase().includes(searchText) || desc.includes(searchText);
        let matchesFilter = false;

        if (currentFilter === 'Trash') matchesFilter = pl.status === 'Deleted';
        else if (pl.status !== 'Deleted') {
            if (currentFilter === 'All') matchesFilter = true;
            else matchesFilter = pl.status === currentFilter;
        }

        if (matchesSearch && matchesFilter) {
            const div = document.createElement("div");
            div.className = `pl-item status-${pl.status || 'Normal'}`;
            if (pl.id === selectedPL) div.classList.add("active");

            let badge = "";
            if (pl.status === "Urgent") badge = `<span class="pl-status-badge" style="background:#d32f2f; color:white">Urgent</span>`;
            else if (pl.status === "Delayed") badge = `<span class="pl-status-badge" style="background:#f57c00; color:white">Delayed</span>`;
            else if (pl.status === "Escalated") badge = `<span class="pl-status-badge" style="background:#b71c1c; color:white">Escalated</span>`;
            else if (pl.status === "OnTime") badge = `<span class="pl-status-badge" style="background:#388e3c; color:white">OnTime</span>`;
            else if (pl.status === "Received") badge = `<span class="pl-status-badge" style="background:#008069; color:white">Received</span>`;
            else if (pl.status === "TPI") badge = `<span class="pl-status-badge" style="background:#673ab7; color:white">TPI</span>`;

            let buttonsHtml = isAdmin ? (currentFilter === 'Trash' ?
                `<button class="restore-pl-btn" onclick="restorePL('${pl.id}', event)">♻️</button><button class="delete-pl-btn" onclick="hardDeletePL('${pl.id}', event)">❌</button>` :
                `<button class="delete-pl-btn" onclick="softDeletePL('${pl.id}', event)">🗑️</button>`) : '';

            const avatarSrc = pl.photoUrl || DEFAULT_AVATAR;
            const avatarHtml = `<img src="${avatarSrc}" class="pl-avatar" onerror="this.src='${DEFAULT_AVATAR}'">`;

            div.innerHTML = `${avatarHtml}<div class="pl-info">${badge}${buttonsHtml}<span class="pl-number">${pl.id}</span><span class="pl-desc">${pl.description}</span></div>`;
            div.onclick = (e) => { if (e.target.tagName === 'BUTTON') return; selectPL(pl.id, pl.description, pl.status); };
            if (isAdmin) { div.onmouseenter = () => { if (div.querySelector('.delete-pl-btn')) div.querySelector('.delete-pl-btn').style.display = 'block'; }; div.onmouseleave = () => { if (div.querySelector('.delete-pl-btn')) div.querySelector('.delete-pl-btn').style.display = 'none'; }; }
            listEl.appendChild(div);
        }
    });
};
window.filterPLs = () => { renderPLList(); };
window.setFilter = (f) => {
    currentFilter = f;
    document.querySelectorAll('.chip').forEach(btn => btn.classList.remove('active'));
    if (f === 'All') document.getElementById('btn-all').classList.add('active');
    else if (f === 'Urgent') document.getElementById('btn-urgent').classList.add('active');
    else if (f === 'Delayed') document.getElementById('btn-delayed').classList.add('active');
    else if (f === 'Escalated') document.getElementById('btn-escalated').classList.add('active');
    else if (f === 'OnTime') document.getElementById('btn-ontime').classList.add('active');
    else if (f === 'Received') document.getElementById('btn-received').classList.add('active');
    else if (f === 'TPI') document.getElementById('btn-tpi').classList.add('active');
    else if (f === 'Trash') document.getElementById('btn-trash').classList.add('active');
    renderPLList();
};

/* --- CHAT LOGIC --- */
window.selectPL = async (plNumber, description, status) => {
    selectedPL = plNumber;
    currentPLId = plNumber;
    currentPOId = null; // Reset PO selection
    filterChatByPO = false;
    document.getElementById("filter-chat-checkbox").checked = false;
    document.getElementById("po-select").value = "";
    document.getElementById("btn-update-po").disabled = true;
    document.getElementById("chat-input").value = "";

    renderPLList();
    document.getElementById("selected-pl-title").textContent = plNumber;
    document.getElementById("selected-pl-desc").textContent = description;
    document.getElementById("selected-pl-status").textContent = status && status !== 'Normal' && status !== 'Deleted' ? `[${status}]` : '';

    const statusEl = document.getElementById("selected-pl-status");
    if (status === 'Urgent') statusEl.style.color = '#d32f2f';
    else if (status === 'Delayed') statusEl.style.color = '#f57c00';
    else if (status === 'Escalated') statusEl.style.color = '#b71c1c';
    else if (status === 'OnTime') statusEl.style.color = '#388e3c';
    else if (status === 'Received') statusEl.style.color = '#008069';
    else if (status === 'TPI') statusEl.style.color = '#673ab7';
    else statusEl.style.color = 'grey';

    const plData = allPLs.find(p => p.id === plNumber);
    const dpUrl = (plData && plData.photoUrl) ? plData.photoUrl : DEFAULT_AVATAR;
    const dpImg = document.getElementById("header-pl-img");
    dpImg.src = dpUrl;
    dpImg.onerror = function () { this.src = DEFAULT_AVATAR; };

    document.getElementById("app-container").classList.add("chat-active");
    document.getElementById("chat-controls").style.display = "flex";
    document.getElementById("quick-tags").style.display = "flex";

    // Load POs for this PL
    await loadPOsForPL(plNumber);

    // Update PO link indicator
    updatePOLinkIndicator();

    // Load messages using new function
    loadMessagesForPL(plNumber);
};

window.deleteMessage = async (msgId, plId, timestamp, btnId) => {
    if (!confirm("Delete this message?")) return;
    await db.collection("PLs").doc(plId).collection("Messages").doc(msgId).update({
        isDeleted: true,
        text: "🚫 This message was deleted",
        imageUrl: null
    });
    recalcChannelStatus(plId);
};
// setInterval removed as time limit check is no longer needed

async function recalcChannelStatus(plId) {
    const snap = await db.collection("PLs").doc(plId).collection("Messages").orderBy("timestamp", "desc").limit(20).get();
    let newStatus = "Normal";
    for (const doc of snap.docs) {
        const msg = doc.data();
        if (msg.isDeleted) continue;
        const text = msg.text ? msg.text.toLowerCase() : "";
        if (text.includes("#received")) { newStatus = "Received"; break; }
        else if (text.includes("#tpi")) { newStatus = "TPI"; break; }
        else if (text.includes("#escalated")) { newStatus = "Escalated"; break; }
        else if (text.includes("#urgent")) { newStatus = "Urgent"; break; }
        else if (text.includes("#delayed")) { newStatus = "Delayed"; break; }
        else if (text.includes("#ontime")) { newStatus = "OnTime"; break; }
    }
    await db.collection("PLs").doc(plId).update({ status: newStatus });
}

window.sendMessage = async () => {
    const textInput = document.getElementById("chat-input");
    const text = textInput.value.trim();

    if (!text) return;

    // Validation: Require PO to be selected before sending
    if (!currentPOId) {
        alert("⚠️ Please select a PO from the dropdown before sending a message.");
        return;
    }

    // Validate that the selected PO exists in the current PL's PO list
    if (!poMapForPL[currentPOId]) {
        alert("⚠️ The selected PO is not valid for this PL. Please select a valid PO.");
        return;
    }

    // Get PO data if a PO is selected
    let poId = currentPOId || null;
    let poNoSnapshot = "";
    let firmSnapshot = "";
    let qtySnapshot = "";
    let fdpSnapshot = "";

    if (poId && poMapForPL[poId]) {
        const po = poMapForPL[poId];
        poNoSnapshot = po.poNo || poId;
        firmSnapshot = po.firmName || po.supplier || "";
        qtySnapshot = po.qtyTotal || po.qty || "";
        fdpSnapshot = po.fdp || po.dpdt || "";
    }

    const messageData = {
        text,
        poId,
        poNoSnapshot,
        firmSnapshot,
        qtySnapshot,
        fdpSnapshot,
        uid: CURRENT_USER_ID,
        userEmail: CURRENT_USER_EMAIL,
        userName: CURRENT_USER_NAME,
        userDesignation: CURRENT_USER_DESIGNATION,
        timestamp: Date.now(),
        isDeleted: false
    };

    await db.collection("PLs").doc(selectedPL).collection("Messages").add(messageData);

    const lowerText = text.toLowerCase();
    let newStatus = null;
    if (lowerText.includes("#received")) newStatus = "Received";
    else if (lowerText.includes("#tpi")) newStatus = "TPI";
    else if (lowerText.includes("#escalated")) newStatus = "Escalated";
    else if (lowerText.includes("#urgent")) newStatus = "Urgent";
    else if (lowerText.includes("#delayed")) newStatus = "Delayed";
    else if (lowerText.includes("#ontime")) newStatus = "OnTime";

    const updateData = { lastActivity: Date.now() };
    if (newStatus) updateData.status = newStatus;
    await db.collection("PLs").doc(selectedPL).update(updateData);
    textInput.value = "";
};

window.toggleUserMenu = () => { document.getElementById("user-display").classList.toggle("active"); };
window.onclick = (e) => {
    if (!e.target.closest('#user-display')) document.getElementById("user-display").classList.remove("active");
    if (e.target == document.getElementById("settings-modal")) closeSettings();
    if (e.target == document.getElementById("reports-modal")) closeReportsModal();
    if (e.target == document.getElementById("dashboard-modal")) closeDashboard();
    if (e.target == document.getElementById("profile-modal")) closeEditProfile();
    if (e.target == document.getElementById("channel-details-modal")) closeChannelDetails();
    if (e.target == document.getElementById("po-modal")) closePOModal();
};
window.openEditProfile = () => { document.getElementById("profile-modal").style.display = "block"; };
window.closeEditProfile = () => { document.getElementById("profile-modal").style.display = "none"; };
window.autoFillData = async () => {
    const poVal = document.getElementById("input-po").value.trim();
    if (!poVal) return;
    const poDoc = await db.collection("POs").doc(poVal).get();
    if (poDoc.exists) {
        const d = poDoc.data();
        if (d.supplier) document.getElementById("input-sup").value = d.supplier;
        if (d.qty) document.getElementById("input-qty").value = d.qty;
    }
};
window.loginUser = () => { const email = document.getElementById("login-email").value; const pass = document.getElementById("login-password").value; auth.signInWithEmailAndPassword(email, pass).catch((e) => alert(e.message)); };
window.logoutUser = () => { if (confirm("Are you sure?")) { auth.signOut(); window.location.reload(); } };
window.createPL = async () => { const newPL = document.getElementById("new-pl").value.trim(); const desc = document.getElementById("new-pl-desc").value.trim(); if (!newPL) return; await db.collection("PLs").doc(newPL).set({ description: desc || "No description", status: "Normal", created: Date.now(), lastActivity: Date.now() }); document.getElementById("new-pl").value = ""; document.getElementById("new-pl-desc").value = ""; };
window.softDeletePL = async (id, e) => { e.stopPropagation(); if (confirm("Move to Trash?")) await db.collection("PLs").doc(id).update({ status: 'Deleted' }); };
window.restorePL = async (id, e) => { e.stopPropagation(); await db.collection("PLs").doc(id).update({ status: 'Normal' }); };
window.hardDeletePL = async (id, e) => { e.stopPropagation(); if (confirm("Delete Permanently?")) await db.collection("PLs").doc(id).delete(); };
window.closeChat = () => { document.getElementById("app-container").classList.remove("chat-active"); selectedPL = null; renderPLList(); };
window.addTag = (tag) => { document.getElementById("chat-input").value += " " + tag + " "; };
window.openSettings = () => { document.getElementById("settings-modal").style.display = "block"; };
window.closeSettings = () => { document.getElementById("settings-modal").style.display = "none"; };
window.uploadMasterCSV = () => {
    const file = document.getElementById("master-csv").files[0];
    if (!file) return alert("Select file");
    document.getElementById("upload-status").textContent = "Processing...";
    Papa.parse(file, {
        header: false, skipEmptyLines: 'greedy', encoding: "UTF-8",
        complete: async function (results) {
            const batchLimit = 400; let batch = db.batch(); let opCount = 0;
            for (let i = 0; i < results.data.length; i++) {
                const row = results.data[i];
                if (row.length < 8) continue;
                const plNo = String(row[0]).trim(); const plDesc = String(row[1]).trim(); const poNo = String(row[2]).trim(); const poDate = String(row[3]).trim(); const qty = String(row[4]).trim(); const unit = String(row[5]).trim(); const dpdt = String(row[6]).trim(); const supName = String(row[7]).trim(); const status = row[8] ? String(row[8]).trim().toLowerCase() : "open";
                if (plNo.toLowerCase().includes("pl") || !plNo) continue;
                const fullQty = unit ? `${qty} ${unit}` : qty;
                batch.set(db.collection("PLs").doc(plNo), { description: plDesc, relatedPOs: status === 'open' ? firebase.firestore.FieldValue.arrayUnion(poNo) : firebase.firestore.FieldValue.arrayRemove(poNo), closedPOs: status !== 'open' ? firebase.firestore.FieldValue.arrayUnion(poNo) : firebase.firestore.FieldValue.arrayRemove(poNo), status: 'Normal', created: Date.now(), lastActivity: Date.now() }, { merge: true });
                opCount++;
                batch.set(db.collection("POs").doc(poNo), { supplier: supName, poDate: poDate, dpdt: dpdt, qty: fullQty, status: status === 'open' ? 'Open' : 'Closed', relatedPLs: firebase.firestore.FieldValue.arrayUnion({ pl: plNo, qty: fullQty }) }, { merge: true });
                opCount++;
                if (opCount >= batchLimit) { await batch.commit(); batch = db.batch(); opCount = 0; }
            }
            if (opCount > 0) await batch.commit();
            document.getElementById("upload-status").textContent = "✅ Complete!"; alert("Upload Complete!"); closeSettings();
        }
    });
};
document.getElementById("chat-input").addEventListener("keypress", function (e) { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });