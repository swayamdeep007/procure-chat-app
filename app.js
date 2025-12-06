import { firebaseConfig } from "./firebase-config.js";
import { processTags } from "./utils.js";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let CURRENT_USER_ID = null;
let CURRENT_USER_EMAIL = null;
let CURRENT_USER_NAME = "User";
let CURRENT_USER_DESIGNATION = "";

const ADMIN_EMAILS = ["jay@sbi.com", "ss@sbi.com"]; 

/* --- AUTH --- */
auth.onAuthStateChanged(user => {
  if (user) {
    CURRENT_USER_ID = user.uid;
    CURRENT_USER_EMAIL = user.email;
    document.getElementById("login-overlay").style.display = "none";
    document.getElementById("app-container").style.display = "flex";
    if(ADMIN_EMAILS.includes(CURRENT_USER_EMAIL)) {
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
    if(doc.exists) {
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
    if(!newName) return alert("Name cannot be empty");
    await db.collection("Users").doc(CURRENT_USER_ID).update({ displayName: newName, designation: newDesig });
    CURRENT_USER_NAME = newName; CURRENT_USER_DESIGNATION = newDesig;
    updateProfileUI(); closeEditProfile(); alert("Profile Updated!");
};

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
    if(!isoDate) return "";
    const date = new Date(isoDate);
    if(isNaN(date)) return isoDate;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}
function getUsername(email) { return email ? email.split('@')[0] : "User"; }

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
        
        if(currentFilter === 'Trash') matchesFilter = pl.status === 'Deleted';
        else if(pl.status !== 'Deleted') {
             if(currentFilter === 'All') matchesFilter = true;
             else matchesFilter = pl.status === currentFilter;
        }

        if (matchesSearch && matchesFilter) {
            const div = document.createElement("div");
            div.className = `pl-item status-${pl.status || 'Normal'}`;
            if (pl.id === selectedPL) div.classList.add("active");

            let badge = "";
            if(pl.status === "Urgent") badge = `<span class="pl-status-badge" style="background:#d32f2f; color:white">Urgent</span>`;
            else if(pl.status === "Delayed") badge = `<span class="pl-status-badge" style="background:#f57c00; color:white">Delayed</span>`;
            else if(pl.status === "Escalated") badge = `<span class="pl-status-badge" style="background:#b71c1c; color:white">Escalated</span>`;
            else if(pl.status === "OnTime") badge = `<span class="pl-status-badge" style="background:#388e3c; color:white">OnTime</span>`;
            else if(pl.status === "Received") badge = `<span class="pl-status-badge" style="background:#008069; color:white">Received</span>`;
            else if(pl.status === "TPI") badge = `<span class="pl-status-badge" style="background:#673ab7; color:white">TPI</span>`;

            let buttonsHtml = isAdmin ? (currentFilter === 'Trash' ? 
                `<button class="restore-pl-btn" onclick="restorePL('${pl.id}', event)">♻️</button><button class="delete-pl-btn" onclick="hardDeletePL('${pl.id}', event)">❌</button>` : 
                `<button class="delete-pl-btn" onclick="softDeletePL('${pl.id}', event)">🗑️</button>`) : '';

            const avatarSrc = pl.photoUrl || "https://via.placeholder.com/35?text=PL";
            const avatarHtml = `<img src="${avatarSrc}" class="pl-avatar" onerror="this.src='https://via.placeholder.com/35?text=PL'">`;

            div.innerHTML = `${avatarHtml}<div class="pl-info">${badge}${buttonsHtml}<span class="pl-number">${pl.id}</span><span class="pl-desc">${pl.description}</span></div>`;
            div.onclick = (e) => { if(e.target.tagName === 'BUTTON') return; selectPL(pl.id, pl.description, pl.status); };
            if(isAdmin) { div.onmouseenter = () => { if(div.querySelector('.delete-pl-btn')) div.querySelector('.delete-pl-btn').style.display = 'block'; }; div.onmouseleave = () => { if(div.querySelector('.delete-pl-btn')) div.querySelector('.delete-pl-btn').style.display = 'none'; }; }
            listEl.appendChild(div);
        }
    });
};
window.filterPLs = () => { renderPLList(); };
window.setFilter = (f) => { 
    currentFilter = f; 
    document.querySelectorAll('.chip').forEach(btn => btn.classList.remove('active')); 
    if(f === 'All') document.getElementById('btn-all').classList.add('active'); 
    else if(f === 'Urgent') document.getElementById('btn-urgent').classList.add('active'); 
    else if(f === 'Delayed') document.getElementById('btn-delayed').classList.add('active'); 
    else if(f === 'Escalated') document.getElementById('btn-escalated').classList.add('active'); 
    else if(f === 'OnTime') document.getElementById('btn-ontime').classList.add('active'); 
    else if(f === 'Received') document.getElementById('btn-received').classList.add('active');
    else if(f === 'TPI') document.getElementById('btn-tpi').classList.add('active');
    else if(f === 'Trash') document.getElementById('btn-trash').classList.add('active'); 
    renderPLList(); 
};

/* --- CHAT LOGIC --- */
window.selectPL = (plNumber, description, status) => {
  selectedPL = plNumber;
  
  // CLEAR INPUTS ON CHANNEL SWITCH (FIXED)
  document.getElementById("input-po").value = "";
  document.getElementById("input-sup").value = "";
  document.getElementById("input-qty").value = "";
  document.getElementById("input-eta").value = "";
  document.getElementById("chat-input").value = "";

  renderPLList(); 
  document.getElementById("selected-pl-title").textContent = plNumber;
  document.getElementById("selected-pl-desc").textContent = description;
  document.getElementById("selected-pl-status").textContent = status && status !== 'Normal' && status !== 'Deleted' ? `[${status}]` : '';
  
  const statusEl = document.getElementById("selected-pl-status");
  if(status === 'Urgent') statusEl.style.color = '#d32f2f'; 
  else if(status === 'Delayed') statusEl.style.color = '#f57c00'; 
  else if(status === 'Escalated') statusEl.style.color = '#b71c1c'; 
  else if(status === 'OnTime') statusEl.style.color = '#388e3c'; 
  else if(status === 'Received') statusEl.style.color = '#008069';
  else if(status === 'TPI') statusEl.style.color = '#673ab7';
  else statusEl.style.color = 'grey';
  
  const plData = allPLs.find(p => p.id === plNumber);
  const dpUrl = (plData && plData.photoUrl) ? plData.photoUrl : "https://via.placeholder.com/40?text=PL";
  const dpImg = document.getElementById("header-pl-img");
  dpImg.src = dpUrl;
  dpImg.onerror = function() { this.src = "https://via.placeholder.com/40?text=PL"; }; 

  document.getElementById("app-container").classList.add("chat-active");
  document.getElementById("chat-controls").style.display = "flex";
  document.getElementById("quick-tags").style.display = "flex";

  db.collection("PLs").doc(plNumber).get().then(doc => { 
      if(doc.exists) { 
          const dl = document.getElementById("pos-list"); 
          dl.innerHTML = ""; 
          (doc.data().relatedPOs || []).forEach(po => { const opt = document.createElement("option"); opt.value = po; dl.appendChild(opt); }); 
      } 
  });

  db.collection("PLs").doc(plNumber).collection("Messages").orderBy("timestamp", "asc").onSnapshot(snap => {
      const box = document.getElementById("chat-box");
      box.innerHTML = "";
      snap.forEach(doc => {
        const m = doc.data();
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
            if (m.imageUrl) bodyHtml += `<img src="${m.imageUrl}" class="msg-image" onclick="window.open('${m.imageUrl}')">`;
            if (m.text || m.po) {
                let metaHtml = "";
                if (m.po || m.supplier || m.eta || m.qty || m.dpdt || m.poDate) {
                    metaHtml += `<div class="msg-meta-box">`;
                    if(m.po || m.poDate) {
                        metaHtml += `<div class="meta-row">`;
                        if(m.po) metaHtml += `<span><span class="meta-label">PO:</span> <span class="meta-val">${m.po}</span></span>`;
                        if(m.poDate) metaHtml += `<span><span class="meta-label">Dt:</span> <span class="meta-val">${m.poDate}</span></span>`;
                        metaHtml += `</div>`;
                    }
                    if(m.supplier) metaHtml += `<div class="meta-row"><span class="meta-label">Sup:</span> <span class="meta-val">${m.supplier}</span></div>`;
                    if(m.qty || m.dpdt) {
                        metaHtml += `<div class="meta-row">`;
                        if(m.qty) metaHtml += `<span><span class="meta-label">Qty:</span> <span class="meta-val">${m.qty}</span></span>`;
                        if(m.dpdt) metaHtml += `<span><span class="meta-label">DPDT:</span> <span class="meta-val">${m.dpdt}</span></span>`;
                        metaHtml += `</div>`;
                    }
                    if(m.eta) metaHtml += `<div class="meta-row"><span class="meta-label">ETA:</span> <span class="meta-val">${m.eta}</span></div>`; 
                    metaHtml += `</div>`;
                }
                bodyHtml += metaHtml + processTags(m.text);
            }
        }
        
        let deleteBtn = "";
        if(m.uid === CURRENT_USER_ID && !m.isDeleted) {
            const timeDiff = Date.now() - m.timestamp;
            if(timeDiff < 2 * 60 * 1000) deleteBtn = `<span id="btn-${m.timestamp}" class="msg-delete-btn" data-ts="${m.timestamp}" onclick="deleteMessage('${doc.id}', '${plNumber}', ${m.timestamp}, 'btn-${m.timestamp}')">🗑️</span>`;
        }

        const timeHtml = `<span class="msg-time">${formatTime(m.timestamp)}${deleteBtn}</span>`;
        div.innerHTML = userHtml + bodyHtml + timeHtml;
        box.appendChild(div);
      });
      box.scrollTop = box.scrollHeight;
    });
};

window.deleteMessage = async (msgId, plId, timestamp, btnId) => { if(Date.now() - timestamp > 2 * 60 * 1000) { alert("Time limit exceeded."); document.getElementById(btnId).style.display='none'; return; } if(!confirm("Delete?")) return; await db.collection("PLs").doc(plId).collection("Messages").doc(msgId).update({ isDeleted: true, text: "Deleted" }); recalcChannelStatus(plId); };
setInterval(() => { document.querySelectorAll('.msg-delete-btn').forEach(btn => { if (Date.now() - parseInt(btn.getAttribute('data-ts')) > 2 * 60 * 1000) btn.style.display = 'none'; }); }, 1000); 

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
  const po = document.getElementById("input-po").value.trim();
  const sup = document.getElementById("input-sup").value.trim();
  const qty = document.getElementById("input-qty").value.trim();
  let etaRaw = document.getElementById("input-eta").value;
  let etaFormatted = etaRaw ? formatDateString(etaRaw) : "";
  const text = textInput.value.trim();
  
  if (!text && !po && !sup) return;

  let poDate = ""; let dpdt = "";
  if(po) {
      const poDoc = await db.collection("POs").doc(po).get();
      if(poDoc.exists) {
          const data = poDoc.data();
          poDate = data.poDate || "";
          dpdt = data.dpdt || "";
      }
  }

  await db.collection("PLs").doc(selectedPL).collection("Messages").add({
      text, po, supplier: sup, qty, eta: etaFormatted, 
      poDate, dpdt,
      uid: CURRENT_USER_ID, userEmail: CURRENT_USER_EMAIL, userName: CURRENT_USER_NAME, userDesignation: CURRENT_USER_DESIGNATION, 
      timestamp: Date.now(), isDeleted: false
  });
  
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
    if (e.target == document.getElementById("profile-modal")) closeEditProfile(); 
    if (e.target == document.getElementById("channel-details-modal")) closeChannelDetails();
};
window.openEditProfile = () => { document.getElementById("profile-modal").style.display = "block"; };
window.closeEditProfile = () => { document.getElementById("profile-modal").style.display = "none"; };
window.autoFillData = async () => { 
    const poVal = document.getElementById("input-po").value.trim(); 
    if(!poVal) return; 
    const poDoc = await db.collection("POs").doc(poVal).get(); 
    if(poDoc.exists) { 
        const d = poDoc.data();
        if(d.supplier) document.getElementById("input-sup").value = d.supplier; 
        if(d.qty) document.getElementById("input-qty").value = d.qty; 
    } 
};
window.loginUser = () => { const email = document.getElementById("login-email").value; const pass = document.getElementById("login-password").value; auth.signInWithEmailAndPassword(email, pass).catch((e) => alert(e.message)); };
window.logoutUser = () => { if(confirm("Are you sure?")) { auth.signOut(); window.location.reload(); } };
window.createPL = async () => { const newPL = document.getElementById("new-pl").value.trim(); const desc = document.getElementById("new-pl-desc").value.trim(); if (!newPL) return; await db.collection("PLs").doc(newPL).set({ description: desc || "No description", status: "Normal", created: Date.now(), lastActivity: Date.now() }); document.getElementById("new-pl").value = ""; document.getElementById("new-pl-desc").value = ""; };
window.softDeletePL = async (id, e) => { e.stopPropagation(); if(confirm("Move to Trash?")) await db.collection("PLs").doc(id).update({ status: 'Deleted' }); };
window.restorePL = async (id, e) => { e.stopPropagation(); await db.collection("PLs").doc(id).update({ status: 'Normal' }); };
window.hardDeletePL = async (id, e) => { e.stopPropagation(); if(confirm("Delete Permanently?")) await db.collection("PLs").doc(id).delete(); };
window.closeChat = () => { document.getElementById("app-container").classList.remove("chat-active"); selectedPL = null; renderPLList(); };
window.addTag = (tag) => { document.getElementById("chat-input").value += " " + tag + " "; };
window.openSettings = () => { document.getElementById("settings-modal").style.display = "block"; };
window.closeSettings = () => { document.getElementById("settings-modal").style.display = "none"; };
window.uploadMasterCSV = () => { 
    const file = document.getElementById("master-csv").files[0]; 
    if(!file) return alert("Select file"); 
    document.getElementById("upload-status").textContent = "Processing..."; 
    Papa.parse(file, { 
        header: false, skipEmptyLines: 'greedy', encoding: "UTF-8", 
        complete: async function(results) { 
            const batchLimit = 400; let batch = db.batch(); let opCount = 0; 
            for (let i = 0; i < results.data.length; i++) { 
                const row = results.data[i]; 
                if(row.length < 8) continue; 
                const plNo = String(row[0]).trim(); const plDesc = String(row[1]).trim(); const poNo = String(row[2]).trim(); const poDate = String(row[3]).trim(); const qty = String(row[4]).trim(); const unit = String(row[5]).trim(); const dpdt = String(row[6]).trim(); const supName = String(row[7]).trim(); const status = row[8] ? String(row[8]).trim().toLowerCase() : "open"; 
                if (plNo.toLowerCase().includes("pl") || !plNo) continue; 
                const fullQty = unit ? `${qty} ${unit}` : qty;
                batch.set(db.collection("PLs").doc(plNo), { description: plDesc, relatedPOs: status==='open'?firebase.firestore.FieldValue.arrayUnion(poNo):firebase.firestore.FieldValue.arrayRemove(poNo), closedPOs: status !== 'open' ? firebase.firestore.FieldValue.arrayUnion(poNo) : firebase.firestore.FieldValue.arrayRemove(poNo), status: 'Normal', created: Date.now(), lastActivity: Date.now() }, { merge: true }); 
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
document.getElementById("chat-input").addEventListener("keypress", function(e) { if (e.key === "Enter") { e.preventDefault(); sendMessage(); } });