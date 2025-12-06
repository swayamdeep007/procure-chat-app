import { firebaseConfig } from "./firebase-config.js";
import { processTags } from "./utils.js";

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
let CURRENT_USER_ID = null;
let CURRENT_USER_EMAIL = null;
let CURRENT_USER_NAME = "User";
let CURRENT_USER_DESIGNATION = "";
let selectedPLs = new Set();
let isBulkMode = false;

const ADMIN_EMAILS = ["jay@sbi.com", "ss@sbi.com"]; 
// A fast, local gray box placeholder to avoid external request delays
const DEFAULT_AVATAR = "data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22100%22%20height%3D%22100%22%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22%23e0e0e0%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20font-family%3D%22sans-serif%22%20font-size%3D%2235%22%20fill%3D%22%23888%22%20dy%3D%22.3em%22%20text-anchor%3D%22middle%22%3EPL%3C%2Ftext%3E%3C%2Fsvg%3E";

/* --- AUTH STATE LISTENER --- */
auth.onAuthStateChanged(user => {
  if (user) {
    CURRENT_USER_ID = user.uid;
    CURRENT_USER_EMAIL = user.email;
    document.getElementById("login-overlay").style.display = "none";
    document.getElementById("app-container").style.display = "flex";
    
    // Check Admin Logic
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

/* --- PROFILE MANAGEMENT --- */
async function loadUserProfile() {
    const doc = await db.collection("Users").doc(CURRENT_USER_ID).get();
    if(doc.exists) {
        const data = doc.data();
        CURRENT_USER_NAME = data.displayName || getUsername(CURRENT_USER_EMAIL);
        CURRENT_USER_DESIGNATION = data.designation || "";
    } else {
        CURRENT_USER_NAME = getUsername(CURRENT_USER_EMAIL);
        await db.collection("Users").doc(CURRENT_USER_ID).set({ 
            displayName: CURRENT_USER_NAME, 
            email: CURRENT_USER_EMAIL, 
            designation: "" 
        });
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
    
    await db.collection("Users").doc(CURRENT_USER_ID).update({ 
        displayName: newName, 
        designation: newDesig 
    });
    CURRENT_USER_NAME = newName; 
    CURRENT_USER_DESIGNATION = newDesig;
    updateProfileUI(); 
    closeEditProfile(); 
    alert("Profile Updated!");
};

/* --- BULK ACTIONS LOGIC --- */
window.toggleBulkMode = () => {
    isBulkMode = !isBulkMode;
    selectedPLs.clear();
    const btn = document.getElementById("btn-multiselect");
    
    if(isBulkMode) { 
        btn.classList.add("active"); 
        document.body.classList.add("bulk-active"); 
    } else { 
        btn.classList.remove("active"); 
        document.body.classList.remove("bulk-active"); 
        document.getElementById("bulk-action-bar").style.display = "none"; 
    }
    renderPLList();
};

window.togglePLSelection = (plId, event) => {
    event.stopPropagation();
    if(selectedPLs.has(plId)) {
        selectedPLs.delete(plId); 
    } else {
        selectedPLs.add(plId);
    }
    
    document.getElementById("bulk-count").textContent = selectedPLs.size;
    document.getElementById("bulk-header-count").textContent = selectedPLs.size;
    document.getElementById("bulk-action-bar").style.display = selectedPLs.size > 0 ? "block" : "none";
    
    // Visually update current view
    const items = document.querySelectorAll(".pl-item");
    items.forEach(item => {
        if(item.getAttribute("data-id") === plId) {
            item.querySelector(".bulk-check").checked = selectedPLs.has(plId);
        }
    });
};

window.openBulkChat = () => {
    document.getElementById("app-container").classList.add("chat-active");
    document.getElementById("standard-chat-header").style.display = "none";
    document.getElementById("chat-controls").style.display = "none";
    document.getElementById("bulk-chat-header").style.display = "flex";
    document.getElementById("bulk-controls").style.display = "block";
    document.getElementById("quick-tags").style.display = "flex";
    
    document.getElementById("chat-box").innerHTML = `
        <div style="text-align:center; padding:50px; color:#777;">
            <h3>📢 Bulk Broadcast Mode</h3>
            <p>Sending to <b>${selectedPLs.size}</b> channels.</p>
        </div>`;
};

window.cancelBulkMode = () => {
    document.getElementById("app-container").classList.remove("chat-active");
    document.getElementById("standard-chat-header").style.display = "flex";
    document.getElementById("chat-controls").style.display = "flex";
    document.getElementById("bulk-chat-header").style.display = "none";
    document.getElementById("bulk-controls").style.display = "none";
    toggleBulkMode(); 
};

window.sendBulkMessage = async () => {
    const text = document.getElementById("bulk-input").value.trim();
    if(!text) return alert("Enter message");
    
    const progressEl = document.getElementById("bulk-progress");
    progressEl.textContent = `Sending...`;
    
    let newStatus = null; 
    const lowerText = text.toLowerCase();
    if (lowerText.includes("#received")) newStatus = "Received"; 
    else if (lowerText.includes("#tpi")) newStatus = "TPI"; 
    else if (lowerText.includes("#escalated")) newStatus = "Escalated"; 
    else if (lowerText.includes("#urgent")) newStatus = "Urgent";
    
    const batchLimit = 400; 
    let batch = db.batch(); 
    let opCount = 0;
    
    for(let plId of selectedPLs) {
        // Add Message
        const msgRef = db.collection("PLs").doc(plId).collection("Messages").doc();
        batch.set(msgRef, { 
            text, 
            uid: CURRENT_USER_ID, 
            userEmail: CURRENT_USER_EMAIL, 
            userName: CURRENT_USER_NAME, 
            userDesignation: CURRENT_USER_DESIGNATION,
            timestamp: Date.now(), 
            isDeleted: false 
        });
        opCount++;
        
        // Update PL Status
        const plRef = db.collection("PLs").doc(plId);
        const updateData = { lastActivity: Date.now() };
        if(newStatus) updateData.status = newStatus;
        batch.update(plRef, updateData);
        opCount++;
        
        if(opCount >= batchLimit) { 
            await batch.commit(); 
            batch = db.batch(); 
            opCount = 0; 
        }
    }
    
    if(opCount > 0) await batch.commit();
    
    progressEl.textContent = "✅ Done!"; 
    document.getElementById("bulk-input").value = ""; 
    setTimeout(() => { 
        alert("Broadcast Sent!"); 
        cancelBulkMode(); 
    }, 1000);
};

window.triggerBulkUpload = () => { document.getElementById("bulk-file-input").click(); };

window.handleBulkImageSelect = async () => {
    const file = document.getElementById("bulk-file-input").files[0];
    if(!file) return;
    
    try {
        const base64 = await compressAndConvertToBase64(file);
        const batchLimit = 400; 
        let batch = db.batch(); 
        let opCount = 0;
        
        for(let plId of selectedPLs) {
            const msgRef = db.collection("PLs").doc(plId).collection("Messages").doc();
            batch.set(msgRef, { 
                text: "", 
                imageUrl: base64, 
                uid: CURRENT_USER_ID, 
                userEmail: CURRENT_USER_EMAIL, 
                userName: CURRENT_USER_NAME, 
                userDesignation: CURRENT_USER_DESIGNATION,
                timestamp: Date.now(), 
                isDeleted: false 
            });
            opCount++;
            batch.update(db.collection("PLs").doc(plId), { lastActivity: Date.now() });
            opCount++;
            
            if(opCount >= batchLimit) { await batch.commit(); batch = db.batch(); opCount = 0; }
        }
        if(opCount > 0) await batch.commit();
        
        alert("Image Broadcasted!"); 
        cancelBulkMode();
    } catch(e) { 
        alert("Error: " + e.message); 
    }
};

/* --- DASHBOARD LOGIC (BIG) --- */
window.openDashboard = async () => {
    let counts = { Total: 0, Urgent: 0, TPI: 0, Received: 0, Escalated: 0 };
    let tableData = [];
    
    const poSnap = await db.collection("POs").get(); 
    const poMap = {};
    poSnap.forEach(doc => { poMap[doc.id] = doc.data(); });
    
    allPLs.forEach(pl => {
        if(pl.status === 'Deleted') return;
        counts.Total++;
        if(counts[pl.status] !== undefined) counts[pl.status]++;
        
        if(pl.status === 'Urgent' || pl.status === 'Escalated' || pl.status === 'Delayed') {
            const poNum = (pl.relatedPOs && pl.relatedPOs.length > 0) ? pl.relatedPOs[0] : "";
            const poInfo = poNum ? poMap[poNum] : {};
            tableData.push({ 
                pl: pl.id, 
                desc: pl.description, 
                status: pl.status, 
                supplier: poInfo.supplier || "-", 
                qty: poInfo.qty || "-", 
                dpdt: poInfo.dpdt || "-" 
            });
        }
    });
    
    document.getElementById("dash-total").textContent = counts.Total; 
    document.getElementById("dash-urgent").textContent = counts.Urgent; 
    document.getElementById("dash-tpi").textContent = counts.TPI; 
    document.getElementById("dash-received").textContent = counts.Received; 
    document.getElementById("dash-esc").textContent = counts.Escalated;
    
    const tbody = document.getElementById("dashboard-table-body"); 
    tbody.innerHTML = "";
    tableData.forEach(row => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td><strong>${row.pl}</strong></td>
            <td>${row.desc.substring(0,40)}...</td>
            <td><span class="pl-status-badge" style="background:${row.status==='Urgent'?'#d32f2f':row.status==='Escalated'?'#b71c1c':'#f57c00'}; color:white;">${row.status}</span></td>
            <td>${row.supplier}</td>
            <td>${row.qty}</td>
            <td>${row.dpdt}</td>
        `;
        tbody.appendChild(tr);
    });
    
    document.getElementById("dashboard-modal").style.display = "block";
};
window.closeDashboard = () => { document.getElementById("dashboard-modal").style.display = "none"; };

/* --- STANDARD CHAT & UTILS --- */
function formatTime(timestamp) { 
    if (!timestamp) return ""; 
    const date = new Date(timestamp); 
    return `${date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; 
}
function formatDateString(isoDate) { 
    if(!isoDate) return ""; 
    const date = new Date(isoDate); 
    return isNaN(date) ? isoDate : date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); 
}
function getUsername(email) { return email ? email.split('@')[0] : "User"; }

function compressAndConvertToBase64(file) { 
    return new Promise((resolve, reject) => { 
        const reader = new FileReader(); 
        reader.readAsDataURL(file); 
        reader.onload = (e) => { 
            const img = new Image(); 
            img.src = e.target.result; 
            img.onload = () => { 
                const canvas = document.createElement('canvas'); 
                const scale = 800/img.width; 
                canvas.width = 800; 
                canvas.height = img.height * scale; 
                const ctx = canvas.getContext('2d'); 
                ctx.drawImage(img,0,0,canvas.width,canvas.height); 
                resolve(canvas.toDataURL('image/jpeg',0.7)); 
            }; 
        }; 
        reader.onerror = reject; 
    }); 
}

let allPLs = []; 
let currentFilter = 'All'; 
let selectedPL = null;

function setupPLListener() { 
    db.collection("PLs").onSnapshot(snap => { 
        allPLs = []; 
        snap.forEach(doc => { allPLs.push({ id: doc.id, ...doc.data() }); }); 
        renderPLList(); 
    }); 
}

window.renderPLList = () => {
    const listEl = document.getElementById("pl-list"); 
    listEl.innerHTML = "";
    const searchText = document.getElementById("pl-search").value.toLowerCase();
    const isAdmin = ADMIN_EMAILS.includes(CURRENT_USER_EMAIL);
    
    allPLs.sort((a,b) => (b.lastActivity||0) - (a.lastActivity||0));
    
    allPLs.forEach(pl => {
        if((currentFilter==='Trash' && pl.status!=='Deleted') || (currentFilter!=='Trash' && pl.status==='Deleted') || (currentFilter!=='All' && currentFilter!=='Trash' && pl.status!==currentFilter)) return;
        if(!pl.id.toLowerCase().includes(searchText) && !pl.description.toLowerCase().includes(searchText)) return;
        
        const div = document.createElement("div"); 
        div.className = `pl-item status-${pl.status||'Normal'}`; 
        div.setAttribute("data-id", pl.id);
        
        if(pl.id === selectedPL && !isBulkMode) div.classList.add("active");
        
        const av = pl.photoUrl || DEFAULT_AVATAR;
        const isChecked = selectedPLs.has(pl.id) ? 'checked' : '';
        
        div.innerHTML = `
            <input type="checkbox" class="bulk-check" ${isChecked} onclick="togglePLSelection('${pl.id}', event)">
            <img src="${av}" class="pl-avatar" onerror="this.src='${DEFAULT_AVATAR}'">
            <div class="pl-info">
                <span class="pl-status-badge" style="background:${pl.status==='Urgent'?'#d32f2f':pl.status==='TPI'?'#673ab7':'transparent'}; color:white">
                    ${pl.status!=='Normal'?pl.status:''}
                </span>
                <span class="pl-number">${pl.id}</span>
                <span class="pl-desc">${pl.description}</span>
            </div>`;
            
        div.onclick = (e) => { 
            if(e.target.type!=='checkbox') {
                if(isBulkMode) div.querySelector('.bulk-check').click();
                else selectPL(pl.id, pl.description, pl.status); 
            }
        };
        listEl.appendChild(div);
    });
};

window.filterPLs = () => renderPLList();
window.setFilter = (f) => { 
    currentFilter = f; 
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('active')); 
    if(f==='All') document.getElementById('btn-all').classList.add('active'); 
    else if(f==='Urgent') document.getElementById('btn-urgent').classList.add('active'); 
    else if(f==='TPI') document.getElementById('btn-tpi').classList.add('active'); 
    else if(f==='Received') document.getElementById('btn-received').classList.add('active'); 
    renderPLList(); 
};

window.selectPL = (plId, desc, status) => {
    selectedPL = plId; 
    document.getElementById("app-container").classList.add("chat-active");
    document.getElementById("standard-chat-header").style.display="flex"; 
    document.getElementById("bulk-chat-header").style.display="none"; 
    document.getElementById("bulk-controls").style.display="none"; 
    document.getElementById("chat-controls").style.display="flex";
    
    document.getElementById("selected-pl-title").textContent = plId; 
    document.getElementById("selected-pl-desc").textContent = desc; 
    document.getElementById("selected-pl-status").textContent = status!=='Normal'?`[${status}]`:'';
    document.getElementById("header-pl-img").src = allPLs.find(p=>p.id===plId)?.photoUrl || DEFAULT_AVATAR;
    
    ["input-po","input-sup","input-qty","input-eta","chat-input"].forEach(id=>document.getElementById(id).value="");
    
    renderPLList();
    
    db.collection("PLs").doc(plId).get().then(d => { 
        const l = document.getElementById("pos-list"); 
        l.innerHTML=""; 
        (d.data()?.relatedPOs||[]).forEach(p=>l.appendChild(new Option(p,p))); 
    });
    
    db.collection("PLs").doc(plId).collection("Messages").orderBy("timestamp","asc").onSnapshot(s => {
        const b = document.getElementById("chat-box"); 
        b.innerHTML="";
        s.forEach(d => { 
            const m=d.data(); 
            if(m.isDeleted) return; 
            
            const div = document.createElement("div"); 
            div.className="message"+(m.uid===CURRENT_USER_ID?" you":"");
            
            let metaHtml = "";
            if (m.po || m.supplier || m.eta || m.qty || m.dpdt || m.poDate) {
                metaHtml += `<div class="msg-meta-box">`;
                if(m.po) metaHtml += `<div class="meta-row"><span class="meta-label">PO:</span> <span>${m.po}</span></div>`;
                if(m.supplier) metaHtml += `<div class="meta-row"><span class="meta-label">Sup:</span> <span>${m.supplier}</span></div>`;
                if(m.qty) metaHtml += `<div class="meta-row"><span class="meta-label">Qty:</span> <span>${m.qty}</span></div>`;
                if(m.dpdt) metaHtml += `<div class="meta-row"><span class="meta-label">DPDT:</span> <span>${m.dpdt}</span></div>`;
                metaHtml += `</div>`;
            }

            div.innerHTML = `
                <span class="msg-sender">${m.userName}</span>
                ${m.imageUrl ? `<img src="${m.imageUrl}" class="msg-image" onclick="window.open('${m.imageUrl}')">` : ''}
                ${metaHtml}
                ${m.text ? processTags(m.text) : ''}
                <span class="msg-time">${formatTime(m.timestamp)}</span>`;
            
            b.appendChild(div); 
        });
        b.scrollTop = b.scrollHeight;
    });
};

window.sendMessage = async () => {
    const text = document.getElementById("chat-input").value.trim(); 
    const po = document.getElementById("input-po").value.trim();
    const sup = document.getElementById("input-sup").value.trim();
    const qty = document.getElementById("input-qty").value.trim();
    let etaRaw = document.getElementById("input-eta").value;
    let eta = etaRaw ? formatDateString(etaRaw) : "";

    if(!text && !po) return;
    
    // Get PO Meta if exists
    let poDate = ""; let dpdt = "";
    if(po) {
      const poDoc = await db.collection("POs").doc(po).get();
      if(poDoc.exists) {
          const data = poDoc.data();
          poDate = data.poDate || "";
          dpdt = data.dpdt || "";
      }
    }

    let newStatus=null; 
    const lower=text.toLowerCase(); 
    if(lower.includes("#received")) newStatus="Received"; 
    else if(lower.includes("#urgent")) newStatus="Urgent"; 
    else if(lower.includes("#tpi")) newStatus="TPI";
    
    await db.collection("PLs").doc(selectedPL).collection("Messages").add({ 
        text, po, supplier: sup, qty, eta, poDate, dpdt,
        uid: CURRENT_USER_ID, 
        userEmail: CURRENT_USER_EMAIL, 
        userName: CURRENT_USER_NAME, 
        timestamp: Date.now(), 
        isDeleted: false 
    });
    
    const up={lastActivity: Date.now()}; 
    if(newStatus) up.status=newStatus; 
    await db.collection("PLs").doc(selectedPL).update(up);
    
    document.getElementById("chat-input").value="";
};

window.triggerChatUpload = () => document.getElementById("chat-file-input").click();
window.handleChatImageSelect = async () => { try { const b64 = await compressAndConvertToBase64(document.getElementById("chat-file-input").files[0]); await sendImageMessage(b64); } catch(e){alert(e);} };
window.triggerDPUpload = () => document.getElementById("dp-file-input").click();
window.handleDPSelect = async () => { try { const b64 = await compressAndConvertToBase64(document.getElementById("dp-file-input").files[0]); await db.collection("PLs").doc(selectedPL).update({photoUrl:b64}); } catch(e){alert(e);} };
window.addTag = (t) => { const id = isBulkMode ? "bulk-input" : "chat-input"; document.getElementById(id).value += " " + t + " "; };
window.toggleUserMenu = () => document.getElementById("user-display").classList.toggle("active");
window.openSettings = () => document.getElementById("settings-modal").style.display="block"; window.closeSettings = () => document.getElementById("settings-modal").style.display="none";
window.openReportsModal = () => document.getElementById("reports-modal").style.display="block"; window.closeReportsModal = () => document.getElementById("reports-modal").style.display="none";
window.openEditProfile = () => document.getElementById("profile-modal").style.display="block"; window.closeEditProfile = () => document.getElementById("profile-modal").style.display="none";
window.loginUser = () => { auth.signInWithEmailAndPassword(document.getElementById("login-email").value, document.getElementById("login-password").value).catch(e=>alert(e.message)); };
window.logoutUser = () => { if(confirm("Logout?")) auth.signOut().then(()=>location.reload()); };
window.createPL = async () => { const id=document.getElementById("new-pl").value; if(id) await db.collection("PLs").doc(id).set({description:document.getElementById("new-pl-desc").value, status:'Normal', created:Date.now()}); };

window.uploadMasterCSV = () => { 
    const f=document.getElementById("master-csv").files[0]; 
    if(!f) return; 
    Papa.parse(f, {
        header:false, 
        complete: async r => { 
            const batchLimit = 400; let batch = db.batch(); let opCount = 0; 
            for (let i = 0; i < r.data.length; i++) {
                const row = r.data[i];
                if(row.length<2) continue;
                // Columns: 0:PL, 1:Desc, 2:PO, 3:Date, 4:Qty, 5:Unit, 6:DPDT, 7:Sup
                const pl = row[0]; const po = row[2];
                batch.set(db.collection("PLs").doc(pl), {description:row[1], relatedPOs: firebase.firestore.FieldValue.arrayUnion(po), status:'Normal', lastActivity:Date.now()}, {merge:true});
                opCount++;
                if(po) {
                    batch.set(db.collection("POs").doc(po), {
                        poDate: row[3], qty: row[4]+" "+row[5], dpdt: row[6], supplier: row[7]
                    }, {merge:true});
                    opCount++;
                }
                if(opCount>=batchLimit) { await batch.commit(); batch=db.batch(); opCount=0; }
            }
            if(opCount>0) await batch.commit();
            alert("Done"); closeSettings(); 
        }
    }); 
};

window.exportChannelChat = async () => { 
    if(!selectedPL) return; 
    const s = await db.collection("PLs").doc(selectedPL).collection("Messages").orderBy("timestamp").get(); 
    const d=[]; 
    s.forEach(doc=>{ 
        const m=doc.data(); 
        d.push({
            Date: new Date(m.timestamp).toLocaleDateString(),
            Time: new Date(m.timestamp).toLocaleTimeString(), 
            User: m.userName, 
            Message: m.text,
            PO: m.po || ""
        }); 
    }); 
    downloadCSV(Papa.unparse(d), "chat.csv"); 
};

function downloadCSV(csv, name) { const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download=name; a.click(); }
window.viewChannelDetails = () => { document.getElementById("channel-details-modal").style.display="block"; document.getElementById("detail-pl-img").src=document.getElementById("header-pl-img").src; document.getElementById("detail-pl-title").textContent=selectedPL; };
window.closeChannelDetails = () => document.getElementById("channel-details-modal").style.display="none";
window.autoFillData = async () => { const v=document.getElementById("input-po").value; if(v) { const d = await db.collection("POs").doc(v).get(); if(d.exists) { document.getElementById("input-sup").value=d.data().supplier||""; document.getElementById("input-qty").value=d.data().qty||""; } } };
window.onclick = e => { if(!e.target.closest('#user-display')) document.getElementById("user-display").classList.remove("active"); if(e.target.classList.contains("modal")) e.target.style.display="none"; };
document.getElementById("chat-input").addEventListener("keypress", e => { if(e.key==="Enter") sendMessage(); });