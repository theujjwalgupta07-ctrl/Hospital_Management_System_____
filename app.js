const DB_NAME = "NovaCareDB";
const STORE_NAME = "visitors";
let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("This browser does not support IndexedDB."));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("visit_date", "visit_date", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}
async function dbAction(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    let request;
    try { request = action(store); } catch (e) { reject(e); return; }
    tx.oncomplete = () => resolve(request ? request.result : undefined);
    tx.onerror = () => reject(tx.error || request?.error);
    tx.onabort = () => reject(tx.error || new Error("Database action was cancelled."));
  });
}
const getVisitors = () => dbAction("readonly", store => store.getAll()).then(rows => rows.sort((a,b) => b.id - a.id));
const addVisitor = visitor => dbAction("readwrite", store => store.add(visitor));
const updateVisitor = visitor => dbAction("readwrite", store => store.put(visitor));
const removeVisitor = id => dbAction("readwrite", store => store.delete(id));

function currentStaff() { return sessionStorage.getItem("novacareStaff"); }
function requireStaff() {
  if (document.body.dataset.page && !currentStaff()) { location.replace("index.html"); return false; }
  return true;
}
function setupCommon() {
  const logout = document.getElementById("logoutBtn");
  if (logout) logout.addEventListener("click", () => { sessionStorage.removeItem("novacareStaff"); location.href = "index.html"; });
  const name = document.getElementById("welcomeName");
  if (name) name.textContent = currentStaff() || "Staff";
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function initials(name) { return String(name || "?").trim().split(/\s+/).slice(0,2).map(x => x[0]).join("").toUpperCase(); }
function badge(status) { return `<span class="status ${status === "Inside" ? "status-inside" : "status-out"}">${esc(status)}</span>`; }
function visitorRow(v, compact=false) {
  const identity = `<div class="visitor-cell"><span class="visitor-initial">${esc(initials(v.visitor_name))}</span><span><strong>${esc(v.visitor_name)}</strong><small>${esc(v.phone)}</small></span></div>`;
  if (compact) return `<tr><td>${identity}</td><td>${esc(v.patient_name)}</td><td>${esc(v.department)}</td><td>${esc(v.check_in)}</td><td>${badge(v.status)}</td></tr>`;
  return `<tr><td>${identity}</td><td>${esc(v.patient_name)}</td><td>${esc(v.department)}</td><td>${esc(v.visit_date)}<br><small>${esc(v.check_in)}${v.check_out ? " – "+esc(v.check_out) : ""}</small></td><td>${badge(v.status)}</td><td><button class="action-btn checkout-btn" data-id="${v.id}" ${v.status !== "Inside" ? "disabled" : ""}>Check out</button><button class="action-btn delete-btn" data-id="${v.id}">Delete</button></td></tr>`;
}
function nowParts() {
  const now = new Date();
  return { visit_date: now.toLocaleDateString("en-CA"), time: now.toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"}) };
}
async function loadDashboard() {
  const visitors = await getVisitors();
  const inside = visitors.filter(v => v.status === "Inside").length;
  document.getElementById("totalCount").textContent = visitors.length;
  document.getElementById("insideCount").textContent = inside;
  document.getElementById("outCount").textContent = visitors.length - inside;
  document.getElementById("recentRows").innerHTML = visitors.length ? visitors.slice(0,6).map(v => visitorRow(v,true)).join("") : '<tr><td colspan="5" class="empty">No visitors yet. Register your first visitor to get started.</td></tr>';
}
async function loadRecords() {
  const visitors = await getVisitors();
  const query = document.getElementById("searchInput").value.trim().toLowerCase();
  const status = document.getElementById("statusFilter").value;
  const rows = visitors.filter(v => [v.visitor_name,v.patient_name,v.phone,v.department].some(x => String(x).toLowerCase().includes(query)) && (status === "all" || v.status === status));
  document.getElementById("recordCount").textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  document.getElementById("recordsRows").innerHTML = rows.length ? rows.map(v => visitorRow(v)).join("") : '<tr><td colspan="6" class="empty">No matching visitor records found.</td></tr>';
}
document.addEventListener("DOMContentLoaded", async () => {
  const login = document.getElementById("loginForm");
  if (login) {
    if (currentStaff()) { location.replace("dashboard.html"); return; }
    login.addEventListener("submit", event => {
      event.preventDefault();
      const name = document.getElementById("staffName").value.trim();
      if (!name) return;
      sessionStorage.setItem("novacareStaff", name);
      location.href = "dashboard.html";
    });
  }
  if (!requireStaff()) return;
  setupCommon();
  try {
    if (document.body.dataset.page === "dashboard") await loadDashboard();
    if (document.body.dataset.page === "register") {
      document.getElementById("visitorForm").addEventListener("submit", async event => {
        event.preventDefault();
        const form = event.currentTarget, message = document.getElementById("formMessage"), button = form.querySelector("button[type=submit]");
        const data = Object.fromEntries(new FormData(form).entries());
        const phone = data.phone.trim();
        if (!/^[0-9+()\\s-]{7,18}$/.test(phone)) { message.textContent = "Please enter a valid phone number."; message.className = "form-message error"; return; }
        const {visit_date,time} = nowParts();
        const visitor = {...data, phone, visit_date, check_in:time, check_out:"", status:"Inside", created_at:new Date().toISOString()};
        button.disabled = true; button.textContent = "Saving…";
        try {
          const id = await addVisitor(visitor);
          message.textContent = `Visitor registered successfully. Record #${id}.`;
          message.className = "form-message success";
          form.reset();
          setTimeout(() => location.href = "records.html", 800);
        } catch (error) {
          message.textContent = error.message || "Could not save visitor."; message.className = "form-message error";
        } finally { button.disabled = false; button.innerHTML = 'Save visitor <span>→</span>'; }
      });
    }
    if (document.body.dataset.page === "records") {
      const refresh = () => loadRecords().catch(err => { document.getElementById("recordsRows").innerHTML = `<tr><td colspan="6" class="empty">${esc(err.message)}</td></tr>`; });
      document.getElementById("searchInput").addEventListener("input", refresh);
      document.getElementById("statusFilter").addEventListener("change", refresh);
      document.getElementById("recordsRows").addEventListener("click", async event => {
        const checkout = event.target.closest(".checkout-btn"), del = event.target.closest(".delete-btn");
        try {
          if (checkout) {
            const id = Number(checkout.dataset.id), visitors = await getVisitors(), visitor = visitors.find(v => v.id === id);
            if (visitor && visitor.status === "Inside") {
              visitor.status = "Checked out"; visitor.check_out = nowParts().time;
              await updateVisitor(visitor);
            }
          }
          if (del) {
            if (!confirm("Delete this visitor record permanently?")) return;
            await removeVisitor(Number(del.dataset.id));
          }
          if (checkout || del) await refresh();
        } catch (error) { alert(error.message || "Something went wrong."); }
      });
      await refresh();
    }
  } catch (error) {
    const target = document.getElementById("recentRows") || document.getElementById("recordsRows");
    if (target) target.innerHTML = `<tr><td colspan="6" class="empty">${esc(error.message)}</td></tr>`;
  }
});
