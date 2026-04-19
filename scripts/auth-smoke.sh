#!/bin/bash
# Live end-to-end smoke test of the refactored auth flow.
# Requires: docker compose stack running, jq, curl.

set -u

BASE="http://localhost:3001/api"
TS=$(date +%s)
EMAIL="smoke-${TS}-$$@test.local"
PHONE="+1555$(printf '%07d' $(( (RANDOM * RANDOM) % 10000000 )))"
PASSWORD="SmokeTest123!"
NAME="Smoke Tester"

echo "=========================================="
echo "Auth flow live smoke test"
echo "=========================================="
echo "Email : $EMAIL"
echo "Phone : $PHONE"
echo "Base  : $BASE"
echo ""

PASS=0
FAIL=0
ok()   { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ✗ $1"; echo "      $2"; FAIL=$((FAIL+1)); }
hdr()  { echo ""; echo "--- $1 ---"; }

# -----------------------------------------------------------
hdr "T01 POST /auth/signup"
STATUS=$(curl -s -o /tmp/t01.json -w "%{http_code}" -X POST "$BASE/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"$NAME\",\"email\":\"$EMAIL\",\"phone\":\"$PHONE\",\"password\":\"$PASSWORD\",\"confirmPassword\":\"$PASSWORD\"}")
[ "$STATUS" = "201" ] && ok "status 201" || bad "status" "got $STATUS: $(cat /tmp/t01.json)"
OK=$(jq -r .ok /tmp/t01.json 2>/dev/null)
[ "$OK" = "true" ] && ok "body.ok is true" || bad "body.ok" "got $OK"

# -----------------------------------------------------------
hdr "T02 POST /auth/login (email identifier)"
STATUS=$(curl -s -D /tmp/t02h.txt -o /tmp/t02.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t02.json)"
grep -qi '^set-cookie:' /tmp/t02h.txt && bad "Set-Cookie" "cookies were set: $(grep -i ^set-cookie: /tmp/t02h.txt)" || ok "no Set-Cookie header"
ACCESS=$(jq -r .access_token /tmp/t02.json)
REFRESH=$(jq -r .refresh_token /tmp/t02.json)
[[ "$ACCESS" == ey* ]] && ok "access_token looks like a JWT" || bad "access_token" "got: $ACCESS"
[[ "$REFRESH" == ey* ]] && ok "refresh_token looks like a JWT" || bad "refresh_token" "got: $REFRESH"
UD_EMAIL=$(jq -r .user_details.email /tmp/t02.json)
UD_VAULT=$(jq -r .user_details.vaultCredentialVerifier /tmp/t02.json)
UD_EVER=$(jq -r .user_details.isEmailVerified /tmp/t02.json)
[ "$UD_EMAIL" = "$EMAIL" ] && ok "user_details.email matches" || bad "user_details.email" "got $UD_EMAIL"
[ "$UD_VAULT" = "false" ] && ok "user_details.vaultCredentialVerifier=false" || bad "vaultCredentialVerifier" "got $UD_VAULT"
[ "$UD_EVER" = "false" ] && ok "user_details.isEmailVerified=false" || bad "isEmailVerified" "got $UD_EVER"

# -----------------------------------------------------------
hdr "T03 POST /auth/login (phone identifier)"
STATUS=$(curl -s -o /tmp/t03.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"identifier\":\"$PHONE\",\"password\":\"$PASSWORD\"}")
[ "$STATUS" = "200" ] && ok "status 200 with phone identifier" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T04 POST /auth/login (wrong password → 401)"
STATUS=$(curl -s -o /tmp/t04.json -w "%{http_code}" -X POST "$BASE/auth/login" \
  -H 'content-type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"WrongPassword\"}")
[ "$STATUS" = "401" ] && ok "status 401" || bad "status" "got $STATUS"
OK=$(jq -r .ok /tmp/t04.json)
[ "$OK" = "false" ] && ok "body.ok=false" || bad "body.ok" "got $OK"

# -----------------------------------------------------------
hdr "T05 GET /auth/me (no auth → 401)"
STATUS=$(curl -s -o /tmp/t05.json -w "%{http_code}" "$BASE/auth/me")
[ "$STATUS" = "401" ] && ok "status 401 without Authorization header" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T06 GET /auth/me (with Bearer → 200)"
STATUS=$(curl -s -o /tmp/t06.json -w "%{http_code}" "$BASE/auth/me" -H "Authorization: Bearer $ACCESS")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t06.json)"
UD_EMAIL=$(jq -r .user_details.email /tmp/t06.json)
[ "$UD_EMAIL" = "$EMAIL" ] && ok "user_details.email matches" || bad "user_details.email" "got $UD_EMAIL"
HAS_USER=$(jq -e 'has("user")' /tmp/t06.json 2>/dev/null)
[ "$HAS_USER" != "true" ] && ok "legacy 'user' key is absent" || bad "legacy key" "'user' key still present"

# -----------------------------------------------------------
hdr "T07 GET /auth/me (tampered bearer → 401)"
BAD="${ACCESS}tampered"
STATUS=$(curl -s -o /tmp/t07.json -w "%{http_code}" "$BASE/auth/me" -H "Authorization: Bearer $BAD")
[ "$STATUS" = "401" ] && ok "status 401" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T08 GET /auth/verify-email (status)"
STATUS=$(curl -s -o /tmp/t08.json -w "%{http_code}" "$BASE/auth/verify-email" -H "Authorization: Bearer $ACCESS")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS"
IS_VER=$(jq -r .isVerified /tmp/t08.json)
[ "$IS_VER" = "false" ] && ok "isVerified=false" || bad "isVerified" "got $IS_VER"

# -----------------------------------------------------------
hdr "T09 POST /auth/verify-email (wrong code → 400)"
STATUS=$(curl -s -o /tmp/t09.json -w "%{http_code}" -X POST "$BASE/auth/verify-email" \
  -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS" \
  -d '{"code":"000000"}')
[ "$STATUS" = "400" ] && ok "status 400" || bad "status" "got $STATUS: $(cat /tmp/t09.json)"
OK=$(jq -r .ok /tmp/t09.json)
[ "$OK" = "false" ] && ok "body.ok=false" || bad "body.ok" "got $OK"

# -----------------------------------------------------------
hdr "T10 POST /auth/verify-email (real OTP from Mongo)"
EMAIL_OTP=$(docker exec nuebics-mongo mongosh --quiet nuebics --eval "db.users.findOne({email:'$EMAIL'}).emailVerificationCode" 2>/dev/null | tr -d '\r\n' | tail -c 6)
echo "    fetched email OTP: $EMAIL_OTP"
STATUS=$(curl -s -o /tmp/t10.json -w "%{http_code}" -X POST "$BASE/auth/verify-email" \
  -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS" \
  -d "{\"code\":\"$EMAIL_OTP\"}")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t10.json)"
UD_EVER=$(jq -r .user_details.isEmailVerified /tmp/t10.json)
[ "$UD_EVER" = "true" ] && ok "user_details.isEmailVerified=true" || bad "isEmailVerified" "got $UD_EVER"

# -----------------------------------------------------------
hdr "T11 POST /auth/verify-phone (real OTP from Mongo)"
PHONE_OTP=$(docker exec nuebics-mongo mongosh --quiet nuebics --eval "db.users.findOne({phone:'$PHONE'}).phoneVerificationCode" 2>/dev/null | tr -d '\r\n' | tail -c 6)
echo "    fetched phone OTP: $PHONE_OTP"
STATUS=$(curl -s -o /tmp/t11.json -w "%{http_code}" -X POST "$BASE/auth/verify-phone" \
  -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS" \
  -d "{\"code\":\"$PHONE_OTP\"}")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t11.json)"
UD_PVER=$(jq -r .user_details.isPhoneVerified /tmp/t11.json)
[ "$UD_PVER" = "true" ] && ok "user_details.isPhoneVerified=true" || bad "isPhoneVerified" "got $UD_PVER"

# -----------------------------------------------------------
hdr "T12 GET /auth/vault-password (not set → 404)"
STATUS=$(curl -s -o /tmp/t12.json -w "%{http_code}" "$BASE/auth/vault-password" -H "Authorization: Bearer $ACCESS")
[ "$STATUS" = "404" ] && ok "status 404 when unset" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T13 POST /auth/vault-password (set)"
STATUS=$(curl -s -o /tmp/t13.json -w "%{http_code}" -X POST "$BASE/auth/vault-password" \
  -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS" \
  -d '{"encryptedToken":"opaque-vault-cipher-1"}')
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t13.json)"
UD_VAULT=$(jq -r .user_details.vaultCredentialVerifier /tmp/t13.json)
[ "$UD_VAULT" = "true" ] && ok "user_details.vaultCredentialVerifier=true" || bad "vaultCredentialVerifier" "got $UD_VAULT"

# -----------------------------------------------------------
hdr "T14 GET /auth/vault-password (returns verifier)"
STATUS=$(curl -s -o /tmp/t14.json -w "%{http_code}" "$BASE/auth/vault-password" -H "Authorization: Bearer $ACCESS")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS"
VER=$(jq -r .verifier /tmp/t14.json)
[ "$VER" = "opaque-vault-cipher-1" ] && ok "verifier round-trips" || bad "verifier" "got $VER"

# -----------------------------------------------------------
hdr "T15 POST /auth/vault-password (already set → returns credentialChecker)"
STATUS=$(curl -s -o /tmp/t15.json -w "%{http_code}" -X POST "$BASE/auth/vault-password" \
  -H 'content-type: application/json' -H "Authorization: Bearer $ACCESS" \
  -d '{"encryptedToken":"opaque-vault-cipher-2"}')
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS"
CC=$(jq -r .credentialChecker /tmp/t15.json)
[ "$CC" = "opaque-vault-cipher-1" ] && ok "credentialChecker returns prior cipher" || bad "credentialChecker" "got $CC"

# -----------------------------------------------------------
hdr "T16 POST /auth/refresh (body token)"
sleep 1.1  # ensure iat advances
STATUS=$(curl -s -D /tmp/t16h.txt -o /tmp/t16.json -w "%{http_code}" -X POST "$BASE/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$REFRESH\"}")
[ "$STATUS" = "200" ] && ok "status 200" || bad "status" "got $STATUS: $(cat /tmp/t16.json)"
grep -qi '^set-cookie:' /tmp/t16h.txt && bad "Set-Cookie" "cookies were set" || ok "no Set-Cookie header"
NEW_ACCESS=$(jq -r .access_token /tmp/t16.json)
NEW_REFRESH=$(jq -r .refresh_token /tmp/t16.json)
[[ "$NEW_ACCESS" == ey* ]] && ok "new access_token is a JWT" || bad "new access_token" "got: $NEW_ACCESS"
[[ "$NEW_REFRESH" == ey* ]] && ok "new refresh_token is a JWT" || bad "new refresh_token" "got: $NEW_REFRESH"
[ "$NEW_ACCESS" != "$ACCESS" ] && ok "access_token rotated" || bad "access_token rotation" "same as before"
[ "$NEW_REFRESH" != "$REFRESH" ] && ok "refresh_token rotated" || bad "refresh_token rotation" "same as before"

# -----------------------------------------------------------
hdr "T17 POST /auth/refresh (empty body → 400)"
STATUS=$(curl -s -o /tmp/t17.json -w "%{http_code}" -X POST "$BASE/auth/refresh" \
  -H 'content-type: application/json' -d '{}')
[ "$STATUS" = "400" ] && ok "status 400" || bad "status" "got $STATUS: $(cat /tmp/t17.json)"

# -----------------------------------------------------------
hdr "T18 POST /auth/refresh (access token in refresh slot → 401)"
STATUS=$(curl -s -o /tmp/t18.json -w "%{http_code}" -X POST "$BASE/auth/refresh" \
  -H 'content-type: application/json' \
  -d "{\"refresh_token\":\"$ACCESS\"}")
[ "$STATUS" = "401" ] && ok "status 401" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T19 New access token works (me with NEW_ACCESS)"
STATUS=$(curl -s -o /tmp/t19.json -w "%{http_code}" "$BASE/auth/me" -H "Authorization: Bearer $NEW_ACCESS")
[ "$STATUS" = "200" ] && ok "status 200 with rotated token" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T20 POST /auth/logout (endpoint removed → 404)"
STATUS=$(curl -s -o /tmp/t20.json -w "%{http_code}" -X POST "$BASE/auth/logout" -H "Authorization: Bearer $NEW_ACCESS")
[ "$STATUS" = "404" ] && ok "status 404 (endpoint gone)" || bad "status" "got $STATUS"

# -----------------------------------------------------------
hdr "T21 POST /auth/signup (duplicate email → 409)"
STATUS=$(curl -s -o /tmp/t21.json -w "%{http_code}" -X POST "$BASE/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Dup\",\"email\":\"$EMAIL\",\"phone\":\"+15559999999\",\"password\":\"Password123!\",\"confirmPassword\":\"Password123!\"}")
[ "$STATUS" = "409" ] && ok "status 409" || bad "status" "got $STATUS: $(cat /tmp/t21.json)"

# -----------------------------------------------------------
hdr "T22 CORS: no credentials advertised"
CORS_HDR=$(curl -s -D - -o /dev/null -X OPTIONS "$BASE/auth/login" \
  -H 'Origin: http://example.com' \
  -H 'Access-Control-Request-Method: POST' | grep -i '^access-control-allow-credentials:' || true)
[ -z "$CORS_HDR" ] && ok "no Access-Control-Allow-Credentials (credentials:false)" || bad "CORS credentials" "header present: $CORS_HDR"

# -----------------------------------------------------------
echo ""
echo "=========================================="
echo "RESULT: $PASS passed, $FAIL failed"
echo "=========================================="
[ $FAIL -eq 0 ] && exit 0 || exit 1
