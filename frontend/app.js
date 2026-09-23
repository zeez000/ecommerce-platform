const state = {
  products: [],
  inventory: [],
  orders: [],
  health: {},
  healthLoaded: false,
  dataLoaded: false,
  selectedProduct: null,
  selectedStockProduct: null,
  orderStatuses: new Map(),
  productSignature: "",
  orderSignature: "",
  eventCount: 0,
  polling: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const els = {
  productGrid: $("#productGrid"),
  productLoading: $("#productLoading"),
  ordersList: $("#ordersList"),
  eventFeed: $("#eventFeed"),
  eventCount: $("#eventCount"),
  productCount: $("#productCount"),
  orderCount: $("#orderCount"),
  healthyCount: $("#healthyCount"),
  runtimeText: $("#runtimeText"),
  runtimePill: $(".runtime-pill"),
  lastSync: $("#lastSync"),
  orderModal: $("#orderModal"),
  modalTitle: $("#modalTitle"),
  modalPrice: $("#modalPrice"),
  modalStock: $("#modalStock"),
  orderQuantity: $("#orderQuantity"),
  stockModal: $("#stockModal"),
  stockModalTitle: $("#stockModalTitle"),
  stockQuantity: $("#stockQuantity"),
  toastStack: $("#toastStack"),
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function shortId(id = "") {
  return id.length > 12 ? `${id.slice(0, 5)}…${id.slice(-4)}` : id;
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

function escapeHtml(value = "") {
  const node = document.createElement("div");
  node.textContent = String(value);
  return node.innerHTML;
}

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    signal: options.signal || AbortSignal.timeout(25000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok)
    throw new Error(data?.message || `Request failed (${response.status})`);
  return data;
}

function toast(title, message, type = "") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<div><strong>${escapeHtml(title)}</strong><p>${escapeHtml(message)}</p></div>`;
  els.toastStack.appendChild(node);
  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(10px)";
  }, 4800);
  setTimeout(() => node.remove(), 5200);
}

function eventLog(type, message, level = "") {
  els.eventFeed.querySelector(".muted")?.remove();
  const node = document.createElement("div");
  node.className = `event-entry ${level}`;
  node.innerHTML = `<time>${nowTime()}</time><span class="event-type">${escapeHtml(type)}</span><p>${escapeHtml(message)}</p>`;
  els.eventFeed.prepend(node);
  while (els.eventFeed.children.length > 30)
    els.eventFeed.lastElementChild.remove();
  state.eventCount += 1;
  els.eventCount.textContent = `${String(state.eventCount).padStart(2, "0")} ENTRIES`;
}

function inventoryFor(productId) {
  return state.inventory.find((item) => item.productId === productId);
}

function renderProducts() {
  els.productLoading.style.display = "none";
  if (!state.products.length) {
    els.productGrid.innerHTML = `<div class="empty-card"><span class="empty-symbol">∅</span><strong>The collection begins here.</strong><p>Introduce the first product. Its inventory will appear as the event moves through Kafka.</p><a href="#createProductForm">Create the first object ↗</a></div>`;
    return;
  }

  els.productGrid.innerHTML = state.products
    .map((product, index) => {
      const inventory = inventoryFor(product._id);
      const stock = inventory?.quantity;
      const stockText =
        stock == null
          ? "SYNCING INVENTORY"
          : stock === 0
            ? "OUT OF STOCK"
            : `${stock} IN STOCK`;
      const stockClass =
        stock == null || stock === 0 ? "zero" : stock <= 3 ? "low" : "";
      const initials = String(product.name || "P")
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
      return `<article class="product-card">
      <div class="product-card-top"><span>OBJECT / ${String(index + 1).padStart(2, "0")}</span><i class="micro-dot"></i></div>
      <div class="product-art" aria-hidden="true"><span class="art-initials">${escapeHtml(initials)}</span></div>
      <h3>${escapeHtml(product.name)}</h3>
      <div class="product-meta"><span class="product-price">${formatMoney(product.price)}</span><span class="stock-indicator ${stockClass}"><i></i>${stockText}</span></div>
      <div class="product-actions"><button class="order-btn" data-id="${escapeHtml(product._id)}" type="button">Place order <span aria-hidden="true">↗</span></button><button class="stock-edit" data-stock-id="${escapeHtml(product._id)}" type="button" aria-label="Update stock for ${escapeHtml(product.name)}" ${inventory ? "" : "disabled"}>±</button></div>
    </article>`;
    })
    .join("");
}

function renderOrders(changedIds = new Set()) {
  if (!state.orders.length) {
    els.ordersList.innerHTML = `<div class="empty-order"><span class="empty-index">00 / NOTHING IN MOTION</span><strong>When an order is placed,<br />its journey appears here.</strong><a href="#store">Browse products ↗</a></div>`;
    return;
  }
  const names = new Map(
    state.products.map((product) => [product._id, product.name]),
  );
  els.ordersList.innerHTML = [...state.orders]
    .reverse()
    .map((order, index) => {
      const status = ["pending", "confirmed", "rejected"].includes(order.status)
        ? order.status
        : "pending";
      const result =
        status === "confirmed"
          ? "Inventory reserved"
          : status === "rejected"
            ? order.rejectionReason || "Insufficient stock"
            : "Awaiting inventory event";
      return `<article class="order-card ${changedIds.has(order._id) ? "new-state" : ""}">
      <span class="order-number">${String(state.orders.length - index).padStart(2, "0")}</span>
      <div class="order-name"><strong>${escapeHtml(names.get(order.productId) || `Product ${shortId(order.productId)}`)}</strong><small>Order ${escapeHtml(shortId(order._id))}</small></div>
      <div class="order-details">${Number(order.quantity)} ${Number(order.quantity) === 1 ? "unit" : "units"}<small>${escapeHtml(result)}</small></div>
      <span class="order-status ${status}"><i></i>${status}</span>
    </article>`;
    })
    .join("");
}

function renderHealth() {
  const services = [
    "api-gateway",
    "product-service",
    "inventory-service",
    "order-service",
  ];
  const healthy = services.filter(
    (service) => state.health[service]?.status === "healthy",
  ).length;
  els.healthyCount.textContent = `${healthy}/4`;
  const ids = {
    "api-gateway": "#gatewayHealth",
    "product-service": "#productHealth",
    "inventory-service": "#inventoryHealth",
    "order-service": "#orderHealth",
  };
  for (const service of services) {
    const ok = state.health[service]?.status === "healthy";
    $$(`[data-service="${service}"]`).forEach((node) => {
      node.classList.toggle("healthy", ok);
      node.classList.toggle("unhealthy", state.healthLoaded && !ok);
    });
    const bar = $(`[data-bar="${service}"]`);
    bar?.classList.toggle("healthy", ok);
    $(ids[service]).textContent = state.healthLoaded
      ? ok
        ? "Operational"
        : "Unavailable"
      : "Checking";
  }
  els.runtimePill.classList.toggle("online", healthy === 4);
  els.runtimePill.classList.toggle(
    "offline",
    state.healthLoaded && healthy === 0,
  );
  els.runtimeText.textContent = !state.healthLoaded
    ? "Connecting to system"
    : healthy === 4
      ? "All systems live"
      : `${healthy}/4 services live`;
}

async function loadHealth() {
  try {
    const result = await api("/system/health");
    state.health = result.services || {};
  } catch {
    state.health = {};
  }
  state.healthLoaded = true;
  renderHealth();
}

async function loadData({ silent = false } = {}) {
  if (!silent && !state.dataLoaded) els.productLoading.style.display = "flex";
  try {
    const [products, inventory, orders] = await Promise.all([
      api("/products/products"),
      api("/inventory/inventory"),
      api("/orders/orders"),
    ]);
    state.products = Array.isArray(products) ? products : [];
    state.inventory = Array.isArray(inventory) ? inventory : [];
    state.orders = Array.isArray(orders) ? orders : [];
    const productSignature = JSON.stringify([state.products, state.inventory]);
    const orderSignature = JSON.stringify(state.orders);
    const changed = new Set();
    for (const order of state.orders) {
      const previous = state.orderStatuses.get(order._id);
      if (previous && previous !== order.status) {
        changed.add(order._id);
        if (order.status === "confirmed")
          eventLog(
            "ORDER",
            `${shortId(order._id)} confirmed; stock reserved`,
            "success",
          );
        if (order.status === "rejected")
          eventLog(
            "ORDER",
            `${shortId(order._id)} rejected; ${order.rejectionReason || "insufficient stock"}`,
            "error",
          );
      }
      state.orderStatuses.set(order._id, order.status);
    }
    state.dataLoaded = true;
    els.productCount.textContent = String(state.products.length).padStart(
      2,
      "0",
    );
    els.orderCount.textContent = String(state.orders.length).padStart(2, "0");
    els.lastSync.textContent = `Updated ${nowTime()}`;
    if (productSignature !== state.productSignature) renderProducts();
    if (orderSignature !== state.orderSignature) renderOrders(changed);
    state.productSignature = productSignature;
    state.orderSignature = orderSignature;
  } catch (error) {
    if (!state.dataLoaded) {
      els.productLoading.style.display = "none";
      els.productGrid.innerHTML = `<div class="empty-card"><span class="empty-symbol">!</span><strong>The connection is quiet.</strong><p>We could not reach the live services. Check the stack and try again.</p><button id="retryData" type="button">Try again ↗</button></div>`;
    }
    if (!silent) toast("Could not sync data", error.message, "error");
  }
  await loadHealth();
}

async function waitForInventory(productId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const rows = await api("/inventory/inventory");
    const found = rows.find((row) => row.productId === productId);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return null;
}

async function createProduct(event) {
  event.preventDefault();
  const name = $("#productName").value.trim();
  const price = Number($("#productPrice").value);
  const stock = Number($("#productStock").value);
  if (
    !name ||
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isInteger(stock) ||
    stock < 0
  ) {
    toast(
      "Check the details",
      "Enter a name, valid price and whole-number stock.",
      "error",
    );
    return;
  }
  const button = $("#createProductButton");
  button.disabled = true;
  button.innerHTML = "Creating product…";
  try {
    const product = await api("/products/products", {
      method: "POST",
      body: JSON.stringify({ name, price }),
    });
    eventLog("PRODUCT", `${name} saved; product.created published`, "success");
    const inventory = await waitForInventory(product._id);
    if (!inventory)
      throw new Error(
        "Product saved, but inventory did not arrive yet. Refresh shortly.",
      );
    eventLog(
      "KAFKA",
      `Inventory opened for ${shortId(product._id)}`,
      "success",
    );
    await api(`/inventory/inventory/${product._id}`, {
      method: "PUT",
      body: JSON.stringify({ quantity: stock }),
    });
    eventLog("STOCK", `${name} set to ${stock} units`, "success");
    $("#createProductForm").reset();
    toast("Product is live", `${name} is now in the collection.`, "success");
    await loadData({ silent: true });
  } catch (error) {
    eventLog("ERROR", error.message, "error");
    toast("Creation needs attention", error.message, "error");
    await loadData({ silent: true });
  } finally {
    button.disabled = false;
    button.innerHTML = 'Create product <span aria-hidden="true">↗</span>';
  }
}

function openModal(modal) {
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => modal.querySelector("input")?.focus());
}

function closeModal(modal) {
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function openOrderModal(productId) {
  const product = state.products.find((item) => item._id === productId);
  if (!product) return;
  state.selectedProduct = product;
  els.modalTitle.textContent = product.name;
  els.modalPrice.textContent = formatMoney(product.price);
  els.modalStock.textContent = inventoryFor(productId)?.quantity ?? "Syncing";
  els.orderQuantity.value = "1";
  openModal(els.orderModal);
}

function openStockModal(productId) {
  const product = state.products.find((item) => item._id === productId);
  const inventory = inventoryFor(productId);
  if (!product || !inventory) return;
  state.selectedStockProduct = product;
  els.stockModalTitle.textContent = product.name;
  els.stockQuantity.value = inventory.quantity;
  openModal(els.stockModal);
}

async function submitOrder() {
  const product = state.selectedProduct;
  const quantity = Number(els.orderQuantity.value);
  if (!product || !Number.isInteger(quantity) || quantity < 1) {
    toast("Check the quantity", "Use a whole number of at least one.", "error");
    return;
  }
  const button = $("#submitOrder");
  button.disabled = true;
  button.innerHTML = "Placing order…";
  try {
    const order = await api("/orders/orders", {
      method: "POST",
      body: JSON.stringify({ productId: product._id, quantity }),
    });
    eventLog(
      "ORDER",
      `${shortId(order._id)} created for ${quantity} ${quantity === 1 ? "unit" : "units"}`,
      "warning",
    );
    closeModal(els.orderModal);
    toast("Order placed", "Inventory is resolving the request through Kafka.");
    await loadData({ silent: true });
    watchOrder(order._id);
  } catch (error) {
    eventLog("ERROR", error.message, "error");
    toast("Order could not be placed", error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "Place order <span>↗</span>";
  }
}

async function watchOrder(orderId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    try {
      const order = await api(`/orders/orders/${orderId}`);
      if (order.status === "confirmed" || order.status === "rejected") {
        await loadData({ silent: true });
        toast(
          order.status === "confirmed" ? "Order confirmed" : "Order rejected",
          order.status === "confirmed"
            ? "Inventory reserved the requested stock."
            : order.rejectionReason || "Insufficient stock.",
          order.status === "confirmed" ? "success" : "error",
        );
        return;
      }
    } catch {
      /* A transient read should not stop the status transition. */
    }
  }
  eventLog("ORDER", `${shortId(orderId)} is still pending`, "warning");
}

async function saveStock() {
  const product = state.selectedStockProduct;
  const quantity = Number(els.stockQuantity.value);
  if (
    !product ||
    els.stockQuantity.value.trim() === "" ||
    !Number.isInteger(quantity) ||
    quantity < 0
  ) {
    toast(
      "Check the quantity",
      "Stock must be a whole number of zero or more.",
      "error",
    );
    return;
  }
  const button = $("#saveStock");
  button.disabled = true;
  button.innerHTML = "Updating inventory…";
  try {
    await api(`/inventory/inventory/${product._id}`, {
      method: "PUT",
      body: JSON.stringify({ quantity }),
    });
    eventLog(
      "STOCK",
      `${product.name} updated to ${quantity} units`,
      "success",
    );
    closeModal(els.stockModal);
    toast(
      "Stock updated",
      `${product.name} now has ${quantity} units.`,
      "success",
    );
    await loadData({ silent: true });
  } catch (error) {
    eventLog("ERROR", error.message, "error");
    toast("Stock update failed", error.message, "error");
  } finally {
    button.disabled = false;
    button.innerHTML = "Update inventory <span>↗</span>";
  }
}

function setupMotion() {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          revealObserver.unobserve(entry.target);
        }
    },
    { threshold: 0.08 },
  );
  $$(".reveal").forEach((node) => revealObserver.observe(node));
  const navObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          $$(".site-nav a").forEach((link) =>
            link.classList.toggle(
              "active",
              link.hash === `#${entry.target.id}`,
            ),
          );
        }
    },
    { rootMargin: "-30% 0px -60% 0px" },
  );
  $$("main section[id]").forEach((node) => navObserver.observe(node));
  const progress = $("#scrollProgress");
  let scrollQueued = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollQueued) return;
      scrollQueued = true;
      requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
        scrollQueued = false;
      });
    },
    { passive: true },
  );
  if (reduce || !window.matchMedia("(pointer: fine)").matches) return;
  const halo = $("#cursorGlow");
  let point = null;
  let pointerQueued = false;
  window.addEventListener(
    "pointermove",
    (event) => {
      point = { x: event.clientX, y: event.clientY };
      if (pointerQueued) return;
      pointerQueued = true;
      requestAnimationFrame(() => {
        halo.style.left = `${point.x}px`;
        halo.style.top = `${point.y}px`;
        halo.classList.add("visible");
        pointerQueued = false;
      });
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () =>
    halo.classList.remove("visible"),
  );
  $$(".magnetic").forEach((button) => {
    button.addEventListener("pointermove", (event) => {
      const rect = button.getBoundingClientRect();
      button.style.transform = `translate(${(event.clientX - rect.left - rect.width / 2) * 0.06}px, ${(event.clientY - rect.top - rect.height / 2) * 0.06}px)`;
    });
    button.addEventListener("pointerleave", () => {
      button.style.transform = "";
    });
  });
}

$("#createProductForm").addEventListener("submit", createProduct);
$("#refreshButton").addEventListener("click", () => loadData());
$("#clearEvents").addEventListener("click", () => {
  els.eventFeed.innerHTML =
    '<div class="event-entry muted"><time>--:--:--</time><span class="event-type">SYSTEM</span><p>Log cleared. Waiting for the next action.</p></div>';
  state.eventCount = 0;
  els.eventCount.textContent = "00 ENTRIES";
});
const menuButton = $("#menuButton");
const mobileNav = $("#mobileNav");
function closeMenu() {
  mobileNav.classList.remove("open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
}
menuButton.addEventListener("click", () => {
  const open = mobileNav.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute(
    "aria-label",
    open ? "Close navigation" : "Open navigation",
  );
});
mobileNav
  .querySelectorAll("a")
  .forEach((link) => link.addEventListener("click", closeMenu));
$("#productGrid").addEventListener("click", (event) => {
  const order = event.target.closest(".order-btn");
  const stock = event.target.closest(".stock-edit");
  if (order) openOrderModal(order.dataset.id);
  if (stock) openStockModal(stock.dataset.stockId);
  if (event.target.id === "retryData") loadData();
});
$("#modalClose").addEventListener("click", () => closeModal(els.orderModal));
$("#stockModalClose").addEventListener("click", () =>
  closeModal(els.stockModal),
);
$("#submitOrder").addEventListener("click", submitOrder);
$("#saveStock").addEventListener("click", saveStock);
[els.orderModal, els.stockModal].forEach((modal) =>
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal(modal);
  }),
);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    [els.orderModal, els.stockModal].forEach(closeModal);
    closeMenu();
  }
});
setupMotion();
loadData();
setInterval(async () => {
  if (state.polling || document.hidden) return;
  state.polling = true;
  try {
    await loadData({ silent: true });
  } finally {
    state.polling = false;
  }
}, 6000);
