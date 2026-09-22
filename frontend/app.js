const state = {
  products: [],
  inventory: [],
  orders: [],
  health: {},
  selectedProduct: null,
  pollTimer: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const els = {
  productGrid: $("#productGrid"),
  productLoading: $("#productLoading"),
  ordersList: $("#ordersList"),
  eventFeed: $("#eventFeed"),
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
  toastStack: $("#toastStack"),
  miniTerminal: $("#miniTerminal")
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function shortId(id = "") {
  if (!id) return "—";
  return id.length > 11 ? id.slice(0, 5) + "…" + id.slice(-4) : id;
}

function nowTime() {
  return new Date().toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function escapeHtml(value = "") {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(data?.message || "Request failed with status " + response.status);
  }

  return data;
}

function toast(title, message, type = "") {
  const node = document.createElement("div");
  node.className = "toast " + type;
  node.innerHTML = `
    <div></div>
    <div>
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  els.toastStack.appendChild(node);

  setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
  }, 3600);

  setTimeout(() => node.remove(), 4000);
}

function eventLog(type, message, level = "") {
  const firstMuted = els.eventFeed.querySelector(".muted");
  if (firstMuted) firstMuted.remove();

  const node = document.createElement("div");
  node.className = "event-entry " + level;
  node.innerHTML = `
    <time>${nowTime()}</time>
    <span class="event-type">${escapeHtml(type)}</span>
    <p>${escapeHtml(message)}</p>
  `;
  els.eventFeed.prepend(node);

  while (els.eventFeed.children.length > 40) {
    els.eventFeed.lastElementChild.remove();
  }

  const terminalLine = document.createElement("p");
  terminalLine.innerHTML = `<i>›</i> ${escapeHtml(message)}`;
  els.miniTerminal.appendChild(terminalLine);

  while (els.miniTerminal.children.length > 4) {
    els.miniTerminal.firstElementChild.remove();
  }
}

function inventoryFor(productId) {
  return state.inventory.find((item) => item.productId === productId);
}

function renderProducts() {
  els.productLoading.style.display = "none";
  els.productGrid.innerHTML = "";

  if (!state.products.length) {
    els.productGrid.innerHTML = `
      <div class="empty-card">
        <div>
          <strong>No products yet.</strong>
          <p>Create your first one from the Control Deck.</p>
        </div>
      </div>
    `;
    return;
  }

  state.products.forEach((product, index) => {
    const inventory = inventoryFor(product._id);
    const stock = inventory?.quantity ?? 0;
    const initials = String(product.name || "P")
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();

    const card = document.createElement("article");
    card.className = "product-card";
    card.innerHTML = `
      <span class="product-index">SKU // ${String(index + 1).padStart(2, "0")}</span>
      <div class="product-art">
        <div class="product-glyph"><span>${escapeHtml(initials)}</span></div>
      </div>
      <h3 class="product-name">${escapeHtml(product.name)}</h3>
      <div class="product-meta">
        <span class="product-price">${formatMoney(product.price)}</span>
        <span class="stock-chip ${stock <= 0 ? "zero" : ""}">
          STOCK ${stock}
        </span>
      </div>
      <div class="product-actions">
        <button class="btn btn-primary order-btn" data-id="${product._id}">Order now</button>
        <button class="stock-edit" data-stock-id="${product._id}" title="Set stock">±</button>
      </div>
    `;

    els.productGrid.appendChild(card);
  });

  $$(".order-btn").forEach((button) => {
    button.addEventListener("click", () => openOrderModal(button.dataset.id));
  });

  $$(".stock-edit").forEach((button) => {
    button.addEventListener("click", () => editStock(button.dataset.stockId));
  });
}

function renderOrders() {
  els.ordersList.innerHTML = "";

  if (!state.orders.length) {
    els.ordersList.innerHTML = '<div class="empty-row">No orders yet. Place one from a product card.</div>';
    return;
  }

  const productMap = new Map(state.products.map((product) => [product._id, product.name]));

  state.orders.forEach((order) => {
    const row = document.createElement("div");
    row.className = "order-row";

    const reason = order.status === "confirmed"
      ? "inventory.reserved"
      : order.status === "rejected"
        ? (order.rejectionReason || "inventory.rejected")
        : "awaiting inventory event";

    row.innerHTML = `
      <span class="order-id">${shortId(order._id)}</span>
      <span>${escapeHtml(productMap.get(order.productId) || shortId(order.productId))}</span>
      <span>×${Number(order.quantity || 0)}</span>
      <span class="order-status ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
      <span class="order-reason">${escapeHtml(reason)}</span>
    `;

    els.ordersList.appendChild(row);
  });
}

function setServiceCard(service, healthy) {
  const card = document.querySelector(`[data-service="${service}"]`);
  if (!card) return;
  card.classList.toggle("healthy", Boolean(healthy));
  card.classList.toggle("unhealthy", !healthy);
}

function renderHealth() {
  const services = ["api-gateway", "product-service", "inventory-service", "order-service"];
  const healthy = services.filter((service) => state.health[service]?.status === "healthy").length;

  els.healthyCount.textContent = healthy + "/4";

  const config = [
    ["api-gateway", "#gatewayHealth"],
    ["product-service", "#productHealth"],
    ["inventory-service", "#inventoryHealth"],
    ["order-service", "#orderHealth"]
  ];

  config.forEach(([service, selector]) => {
    const item = state.health[service];
    const ok = item?.status === "healthy";
    setServiceCard(service, ok);
    $(selector).textContent = ok ? "healthy" : "offline";
  });

  els.runtimePill.classList.remove("online", "offline");

  if (healthy === 4) {
    els.runtimePill.classList.add("online");
    els.runtimeText.textContent = "all services operational";
  } else if (healthy === 0) {
    els.runtimePill.classList.add("offline");
    els.runtimeText.textContent = "backend unavailable";
  } else {
    els.runtimeText.textContent = healthy + "/4 services online";
  }
}

async function loadHealth() {
  try {
    const data = await api("/system/health");
    state.health = data.services || {};
  } catch (error) {
    state.health = {};
  }

  renderHealth();
}

async function loadData({ silent = false } = {}) {
  if (!silent) {
    els.productLoading.style.display = "grid";
  }

  try {
    const [products, inventory, orders] = await Promise.all([
      api("/products/products"),
      api("/inventory/inventory"),
      api("/orders/orders")
    ]);

    state.products = Array.isArray(products) ? products : [];
    state.inventory = Array.isArray(inventory) ? inventory : [];
    state.orders = Array.isArray(orders) ? orders : [];

    els.productCount.textContent = state.products.length;
    els.orderCount.textContent = state.orders.length;
    els.lastSync.textContent = "synced " + nowTime();

    renderProducts();
    renderOrders();
  } catch (error) {
    if (!silent) {
      els.productLoading.style.display = "none";
      els.productGrid.innerHTML = `
        <div class="empty-card">
          <div>
            <strong>Backend not reachable.</strong>
            <p>Start Docker Compose, then refresh this page.</p>
          </div>
        </div>
      `;
      toast("Stack unavailable", error.message, "error");
    }
  }

  await loadHealth();
}

async function waitForInventory(productId, attempts = 12) {
  for (let i = 0; i < attempts; i += 1) {
    const inventory = await api("/inventory/inventory");
    const found = inventory.find((item) => item.productId === productId);

    if (found) {
      state.inventory = inventory;
      return found;
    }

    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  return null;
}

async function createProduct(event) {
  event.preventDefault();

  const name = $("#productName").value.trim();
  const price = Number($("#productPrice").value);
  const stock = Number($("#productStock").value);

  if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(stock) || stock < 0) {
    toast("Invalid product", "Check the name, price and stock values.", "error");
    return;
  }

  const button = event.submitter;
  button.disabled = true;
  button.textContent = "Creating through Product Service...";

  try {
    eventLog("HTTP", `POST product: ${name}`);
    const product = await api("/products/products", {
      method: "POST",
      body: JSON.stringify({ name, price })
    });

    eventLog("KAFKA", `product.created published for ${product._id}`, "success");

    const inventory = await waitForInventory(product._id);

    if (!inventory) {
      throw new Error("Inventory Service did not create the record in time");
    }

    eventLog("CONSUMER", "Inventory Service consumed product.created", "success");

    await api("/inventory/inventory/" + product._id, {
      method: "PUT",
      body: JSON.stringify({ quantity: stock })
    });

    eventLog("INVENTORY", `stock initialized to ${stock}`, "success");

    $("#productName").value = "";
    $("#productPrice").value = "";
    $("#productStock").value = "10";

    toast("Product online", name + " is now flowing through the stack.", "success");
    await loadData({ silent: true });
  } catch (error) {
    eventLog("ERROR", error.message, "error");
    toast("Create failed", error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Create Product + Stock";
  }
}

function openOrderModal(productId) {
  const product = state.products.find((item) => item._id === productId);
  if (!product) return;

  const stock = inventoryFor(productId)?.quantity ?? 0;
  state.selectedProduct = product;

  els.modalTitle.textContent = product.name;
  els.modalPrice.textContent = formatMoney(product.price);
  els.modalStock.textContent = stock;
  els.orderQuantity.value = "1";

  els.orderModal.classList.add("open");
  els.orderModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeOrderModal() {
  els.orderModal.classList.remove("open");
  els.orderModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  state.selectedProduct = null;
}

async function submitOrder() {
  const product = state.selectedProduct;
  const quantity = Number(els.orderQuantity.value);

  if (!product || !Number.isInteger(quantity) || quantity < 1) {
    toast("Invalid quantity", "Use a whole number of at least 1.", "error");
    return;
  }

  const button = $("#submitOrder");
  button.disabled = true;
  button.textContent = "Publishing order.created...";

  try {
    eventLog("HTTP", `POST order ×${quantity} for ${product.name}`);

    const order = await api("/orders/orders", {
      method: "POST",
      body: JSON.stringify({
        productId: product._id,
        quantity
      })
    });

    eventLog("KAFKA", `order.created → ${shortId(order._id)}`, "warning");
    closeOrderModal();

    toast("Order created", "Status is pending while Inventory Service processes the Kafka event.");

    await loadData({ silent: true });
    await watchOrder(order._id, product.name);
  } catch (error) {
    eventLog("ERROR", error.message, "error");
    toast("Order failed", error.message, "error");
  } finally {
    button.disabled = false;
    button.textContent = "Send through Kafka pipeline";
  }
}

async function watchOrder(orderId, productName) {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 700));

    try {
      const order = await api("/orders/orders/" + orderId);

      if (order.status === "confirmed") {
        eventLog("INVENTORY", `inventory.reserved for ${shortId(orderId)}`, "success");
        eventLog("ORDER", `${productName} order confirmed`, "success");
        toast("Order confirmed", "Inventory reserved successfully.", "success");
        await loadData({ silent: true });
        return;
      }

      if (order.status === "rejected") {
        eventLog("INVENTORY", `inventory.rejected: ${order.rejectionReason || "rejected"}`, "error");
        eventLog("ORDER", `${productName} order rejected`, "error");
        toast("Order rejected", order.rejectionReason || "Inventory rejected the request.", "error");
        await loadData({ silent: true });
        return;
      }
    } catch {
      // keep polling; a transient fetch should not kill the visual demo
    }
  }

  eventLog("ORDER", `${shortId(orderId)} still pending after polling window`, "warning");
}

async function editStock(productId) {
  const product = state.products.find((item) => item._id === productId);
  const current = inventoryFor(productId)?.quantity ?? 0;
  const value = window.prompt(
    `Set stock for ${product?.name || "product"}:`,
    String(current)
  );

  if (value === null) return;

  const quantity = Number(value);

  if (!Number.isFinite(quantity) || quantity < 0) {
    toast("Invalid stock", "Stock must be zero or greater.", "error");
    return;
  }

  try {
    await api("/inventory/inventory/" + productId, {
      method: "PUT",
      body: JSON.stringify({ quantity })
    });

    eventLog("INVENTORY", `${product?.name || shortId(productId)} stock → ${quantity}`, "success");
    toast("Stock updated", "Inventory Service published inventory.updated.", "success");
    await loadData({ silent: true });
  } catch (error) {
    toast("Stock update failed", error.message, "error");
  }
}

async function runLiveDemo() {
  const stamp = String(Date.now()).slice(-5);
  const demoName = "Neon Keyboard " + stamp;

  $("#productName").value = demoName;
  $("#productPrice").value = "3499";
  $("#productStock").value = "8";
  document.querySelector("#store").scrollIntoView({ behavior: "smooth" });

  toast("Demo loaded", "Create the pre-filled product, then order it to watch the event stream.");
  eventLog("DEMO", "Demo values loaded into Control Deck");
}

function clearEvents() {
  els.eventFeed.innerHTML = `
    <div class="event-entry muted">
      <time>--:--:--</time>
      <span class="event-type">SYSTEM</span>
      <p>Event feed cleared.</p>
    </div>
  `;
}

function setupCursor() {
  const glow = $("#cursorGlow");

  window.addEventListener("pointermove", (event) => {
    glow.style.left = event.clientX + "px";
    glow.style.top = event.clientY + "px";
  });

  $$(".magnetic").forEach((element) => {
    element.addEventListener("pointermove", (event) => {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      element.style.transform = `translate(${x * 0.04}px, ${y * 0.06}px)`;
    });

    element.addEventListener("pointerleave", () => {
      element.style.transform = "";
    });
  });
}

function setupParticles() {
  const canvas = $("#particles");
  const ctx = canvas.getContext("2d");
  const dots = [];

  function resize() {
    canvas.width = window.innerWidth * devicePixelRatio;
    canvas.height = window.innerHeight * devicePixelRatio;
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    dots.length = 0;
    const count = Math.min(70, Math.floor(window.innerWidth / 20));

    for (let i = 0; i < count; i += 1) {
      dots.push({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() * 1.2 + .25,
        v: Math.random() * .16 + .04,
        a: Math.random() * .5 + .1
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    for (const dot of dots) {
      dot.y -= dot.v;

      if (dot.y < -5) {
        dot.y = window.innerHeight + 5;
        dot.x = Math.random() * window.innerWidth;
      }

      ctx.beginPath();
      ctx.fillStyle = `rgba(202,196,255,${dot.a})`;
      ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
      ctx.fill();
    }

    requestAnimationFrame(draw);
  }

  resize();
  draw();
  window.addEventListener("resize", resize);
}

function startPolling() {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(() => loadData({ silent: true }), 6000);
}

$("#createProductForm").addEventListener("submit", createProduct);
$("#refreshButton").addEventListener("click", () => loadData());
$("#demoButton").addEventListener("click", runLiveDemo);
$("#modalClose").addEventListener("click", closeOrderModal);
$("#submitOrder").addEventListener("click", submitOrder);
$("#clearEvents").addEventListener("click", clearEvents);

els.orderModal.addEventListener("click", (event) => {
  if (event.target === els.orderModal) closeOrderModal();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOrderModal();
});

setupCursor();
setupParticles();
loadData();
startPolling();
eventLog("SYSTEM", "Frontend booted; connecting through NGINX → API Gateway");
