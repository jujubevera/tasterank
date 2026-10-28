#!/bin/sh
# Signed-out security checks against the live TasteRank database. Read-only: it never writes anything.
# Run from the project folder:  sh supabase/check-security.sh
# Each line should say PASS. Rerun after every database change.

URL=$(grep -o "SUPABASE_URL:'[^']*'" app.js | cut -d"'" -f2)
KEY=$(grep -o "sb_publishable_[A-Za-z0-9_-]*" app.js)
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "Couldn't find the Supabase settings in app.js"; exit 1; }
fails=0

get(){ curl -s "$URL/rest/v1/$1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY"; }
rpc(){ curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{}'; }
check(){ # description, output, pattern the output must match
  if printf '%s' "$2" | grep -Eq "$3"; then echo "PASS  $1"; else echo "FAIL  $1"; echo "      got: $(printf '%s' "$2" | head -c 200)"; fails=$((fails+1)); fi; }

for t in ratings votes profiles suggestions; do
  check "nobody signed out can read $t" "$(get "$t?select=*&limit=1")" '^\[\]$|permission denied|does not exist'
done
check "who submitted an item stays hidden" "$(get 'items?select=submitted_by&limit=1')" 'permission denied|does not exist'
check "delete_me is locked to signed-in people" "$(rpc delete_me)" 'permission denied'
check "the public list of foods still works" "$(rpc item_list)" '^\[{'

# Products and flavours (migration 002). Skipped until the migration has been run.
if rpc app_settings | grep -q approval_votes; then
  for t in products flavours flavour_ratings product_votes flavour_votes planned_ratings; do
    check "nobody signed out can read $t" "$(get "$t?select=*&limit=1")" 'permission denied'
  done
  call(){ curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$2"; }
  check "signed out can't rate"             "$(call rate_flavour '{"p_flavour":1,"p_score":5}')" 'permission denied'
  check "signed out can't approve a product" "$(call approve_product '{"p_product":1}')" 'permission denied'
  check "signed out can't approve a flavour" "$(call approve_flavour '{"p_flavour":1}')" 'permission denied'
  check "signed out can't add a product"     "$(call submit_product '{"p_name":"X","p_brand":"","p_country":"United Kingdom","p_category":"Biscuits","p_flavours":["Original"]}')" 'permission denied'
  check "signed out can't add a flavour"     "$(call submit_flavour '{"p_product":1,"p_name":"X"}')" 'permission denied'
  check "nobody can run internal steps"      "$(call promote_product '{"pid":1}')" 'permission denied'
  check "the product list works" "$(curl -s -X POST "$URL/rest/v1/rpc/product_list" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"p_country":"United Kingdom"}')" '^\[\{'
  check "the product list never shows who submitted" "$(curl -s -X POST "$URL/rest/v1/rpc/product_list" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{"p_country":"United Kingdom"}' | grep -c submitted_by)" '^0$'
else
  echo "SKIP  products and flavours checks (migration 002 not run yet)"
fi

echo
[ "$fails" -eq 0 ] && echo "All checks passed." || { echo "$fails check(s) failed."; exit 1; }
