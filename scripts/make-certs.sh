#!/usr/bin/env bash
# Make a local certificate authority (once) and a server cert signed by it.
# Install certs/ca.crt as trusted on each device and browsers accept the site
# with no warnings. Re-running keeps the existing CA, so devices that already
# trust it don't need to be touched again.
#
# Usage: scripts/make-certs.sh [ip-or-hostname ...]
#   default: 192.168.5.125 localhost 127.0.0.1
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=certs
mkdir -p "$OUT"
chmod 700 "$OUT"

names=("$@")
[ ${#names[@]} -eq 0 ] && names=(192.168.5.125 localhost 127.0.0.1)

san=""
for n in "${names[@]}"; do
  if [[ $n =~ ^[0-9]+(\.[0-9]+){3}$ || $n == *:* ]]; then
    san+="IP:$n,"
  else
    san+="DNS:$n,"
  fi
done
san=${san%,}

if [ ! -f "$OUT/ca.key" ]; then
  echo "Creating CA..."
  openssl req -x509 -new -nodes -newkey rsa:4096 -sha256 -days 3650 \
    -keyout "$OUT/ca.key" -out "$OUT/ca.crt" \
    -subj "/CN=STL Manager Local CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$OUT/ca.key"
else
  echo "Reusing existing CA in $OUT/"
fi

echo "Creating server cert for: $san"
openssl req -new -nodes -newkey rsa:2048 \
  -keyout "$OUT/server.key" -out "$OUT/server.csr" \
  -subj "/CN=${names[0]}"
# Apple rejects certs valid for more than 825 days, even from a private CA
openssl x509 -req -in "$OUT/server.csr" -CA "$OUT/ca.crt" -CAkey "$OUT/ca.key" \
  -CAcreateserial -out "$OUT/server.crt" -days 825 -sha256 \
  -extfile <(printf '%s\n' \
    "basicConstraints=critical,CA:FALSE" \
    "keyUsage=critical,digitalSignature,keyEncipherment" \
    "extendedKeyUsage=serverAuth" \
    "subjectAltName=$san")
rm -f "$OUT/server.csr" "$OUT/ca.srl"
chmod 644 "$OUT/server.key"  # nginx in the container reads it as a different user

echo
openssl x509 -in "$OUT/server.crt" -noout -subject -enddate -ext subjectAltName
echo
echo "Install $OUT/ca.crt as a trusted root on each device (see README)."
echo "Keep $OUT/ca.key private; it can sign certs for any site."
