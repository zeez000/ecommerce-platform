#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"

echo "Checking gateway health..."
curl --fail --silent "${BASE_URL}/health" >/dev/null

echo "Creating product..."
product_json="$(curl --fail --silent   -X POST "${BASE_URL}/products/products"   -H "Content-Type: application/json"   -d '{"name":"CI Test Product","price":99}')"

product_id="$(node -e 'const input = process.argv[1]; const obj = JSON.parse(input); process.stdout.write(obj._id);' "$product_json")"

if [[ -z "$product_id" ]]; then
  echo "Product ID was empty"
  exit 1
fi

echo "Waiting for inventory record..."
inventory_ready="false"

for i in {1..20}; do
  inventory_json="$(curl --fail --silent "${BASE_URL}/inventory/inventory")"

  if node -e 'const [json,id] = process.argv.slice(1); const rows = JSON.parse(json); process.exit(rows.some(x => x.productId === id) ? 0 : 1);' "$inventory_json" "$product_id"; then
    inventory_ready="true"
    break
  fi

  sleep 2
done

if [[ "$inventory_ready" != "true" ]]; then
  echo "Inventory was not created from product.created event"
  exit 1
fi

echo "Adding stock..."
curl --fail --silent   -X PUT "${BASE_URL}/inventory/inventory/${product_id}"   -H "Content-Type: application/json"   -d '{"quantity":5}' >/dev/null

echo "Creating order..."
order_json="$(curl --fail --silent -X POST "${BASE_URL}/orders/orders" -H "Content-Type: application/json" -d "{\"productId\":\"${product_id}\",\"quantity\":2}")"

order_id="$(node -e 'const input = process.argv[1]; const obj = JSON.parse(input); process.stdout.write(obj._id);' "$order_json")"

if [[ -z "$order_id" ]]; then
  echo "Order ID was empty"
  exit 1
fi

echo "Waiting for order confirmation..."
order_confirmed="false"

for i in {1..20}; do
  current_order="$(curl --fail --silent "${BASE_URL}/orders/orders/${order_id}")"

  if node -e 'const obj = JSON.parse(process.argv[1]); process.exit(obj.status === "confirmed" ? 0 : 1);' "$current_order"; then
    order_confirmed="true"
    break
  fi

  sleep 2
done

if [[ "$order_confirmed" != "true" ]]; then
  echo "Order did not reach confirmed state"
  exit 1
fi

echo "Checking remaining stock..."
final_inventory="$(curl --fail --silent "${BASE_URL}/inventory/inventory")"

node -e '
const [json,id] = process.argv.slice(1);
const row = JSON.parse(json).find(x => x.productId === id);
if (!row || row.quantity !== 3) {
  console.error("Expected remaining stock 3, got", row);
  process.exit(1);
}
' "$final_inventory" "$product_id"

echo "Creating an insufficient-stock order..."
rejected_order_json="$(curl --fail --silent -X POST "${BASE_URL}/orders/orders" -H "Content-Type: application/json" -d "{\"productId\":\"${product_id}\",\"quantity\":4}")"
rejected_order_id="$(node -e 'process.stdout.write(JSON.parse(process.argv[1])._id)' "$rejected_order_json")"

rejected="false"
for i in {1..20}; do
  current_order="$(curl --fail --silent "${BASE_URL}/orders/orders/${rejected_order_id}")"
  if node -e 'process.exit(JSON.parse(process.argv[1]).status === "rejected" ? 0 : 1)' "$current_order"; then
    rejected="true"
    break
  fi
  sleep 2
done

if [[ "$rejected" != "true" ]]; then
  echo "Insufficient-stock order did not reach rejected state"
  exit 1
fi

final_inventory="$(curl --fail --silent "${BASE_URL}/inventory/inventory")"
node -e 'const [json,id] = process.argv.slice(1); const row = JSON.parse(json).find(x => x.productId === id); if (!row || row.quantity !== 3) process.exit(1)' "$final_inventory" "$product_id"

echo "Checking frontend and its API proxy on port 3005..."
curl --fail --silent "http://localhost:3005/" | grep -q '<html'
curl --fail --silent "http://localhost:3005/api/health" >/dev/null

echo "Smoke test passed: product -> inventory -> stock -> confirmed order -> rejected order -> frontend"
