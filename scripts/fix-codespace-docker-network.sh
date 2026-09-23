#!/usr/bin/env bash
set -euo pipefail

# Some Codespaces retain iptables-legacy Docker rules after Docker has switched
# to iptables-nft. The legacy FORWARD policy then drops traffic on new br-* networks.
if ! command -v iptables-legacy >/dev/null 2>&1; then
  echo "iptables-legacy is unavailable; no legacy firewall repair needed"
  exit 0
fi

if ! sudo iptables-legacy -S FORWARD | grep -q -- '-P FORWARD DROP'; then
  echo "Legacy FORWARD policy is not DROP; no repair needed"
  exit 0
fi

if ! sudo iptables-legacy -S DOCKER-USER >/dev/null 2>&1; then
  echo "Legacy DOCKER-USER chain is absent; no repair needed"
  exit 0
fi

if sudo iptables-legacy -C DOCKER-USER -i br+ -o br+ -j ACCEPT 2>/dev/null; then
  echo "Docker user-bridge forwarding rule already present"
else
  sudo iptables-legacy -I DOCKER-USER 1 -i br+ -o br+ -j ACCEPT
  echo "Allowed Docker user-bridge traffic through the stale legacy firewall"
fi
