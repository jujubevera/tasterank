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
  check "nobody signed out can read $t" "$(get "$t?select=*&limit=1")" '^\[\]$|permission denied|does not exist|PGRST205'
done
check "who submitted an item stays hidden" "$(get 'items?select=submitted_by&limit=1')" 'permission denied|does not exist|PGRST205'
check "delete_me is locked to signed-in people" "$(rpc delete_me)" 'permission denied'

# Brand-against-brand structure (migration 004). Skipped until the migration has been run.
call(){ curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d "$2"; }
if call place_list '{}' | grep -q '"regions"'; then
  for t in places categories products variants local_names brands item_ratings rating_events approvals planned_ratings; do
    check "nobody signed out can read $t" "$(get "$t?select=*&limit=1")" 'permission denied'
  done
  check "nobody signed out can read items directly" "$(get 'items?select=id&limit=1')" 'permission denied'
  check "signed out can't rate"               "$(call rate_item '{"p_item":1,"p_score":5}')" 'permission denied'
  check "signed out can't approve"            "$(call approve_item '{"p_item":1}')" 'permission denied'
  check "signed out can't remove a rating"    "$(call unrate_item '{"p_item":1}')" 'permission denied|Could not find'
  check "signed out can't add an item"        "$(call submit_item '{"p_product":3,"p_variant":4,"p_country":1,"p_brand_name":"X"}')" 'permission denied'
  check "nobody signed out can read catalogue_suggestions" "$(get 'catalogue_suggestions?select=*&limit=1')" 'permission denied|PGRST205'
  check "signed out can't suggest"            "$(call suggest_catalogue '{"p_kind":"product","p_text":"X"}')" 'permission denied|PGRST202'
  check "signed out can't set a home place"   "$(call set_home_place '{"p_place":1}')" 'permission denied'
  check "signed out can't read a profile"     "$(call my_profile '{}')" 'permission denied'
  check "nobody can run internal steps"       "$(call promote_item '{"p_item":1}')" 'permission denied'
  check "the UK home list works"              "$(call home_rankings '{"p_country":1}')" '^\[\{'
  check "a ranking never shows who rated or submitted" "$(call ranking '{"p_product":3,"p_variant":4,"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
else
  echo "SKIP  brands and items checks (migration 004 not run yet)"
fi

# Snacks waiting for a new ranking (migration 006). Skipped until it has been run.
# (A first version of 006 is already live; the last two checks need the new one.)
if [ "$(get 'item_requests?select=id&limit=1' | grep -c 'does not exist\|PGRST205')" = "0" ]; then
  check "nobody signed out can read item_requests" "$(get 'item_requests?select=*&limit=1')" 'permission denied'
  check "only the owner can see the review list" "$(call review_list '{}')" 'permission denied'
  check "only the owner can accept"            "$(call accept_request '{"p_request":1}')" 'permission denied'
  check "only the owner can decline"           "$(call decline_request '{"p_request":1}')" 'permission denied'
  NEW='{"p_country":1,"p_category":1,"p_new_ranking":"X","p_brand_name":"X"}'
  if [ "$(call submit_item_request "$NEW" | grep -c PGRST202)" = "0" ]; then
    check "signed out can't send a new ranking"  "$(call submit_item_request "$NEW")" 'permission denied'
    check "nobody can run the photo checks"      "$(call check_snack_extras '{"u":"00000000-0000-0000-0000-000000000000","p_image_path":null,"p_image_url":null,"p_barcode":null,"p_score":null}')" 'permission denied'
  else
    echo "SKIP  new-ranking checks (the new migration 006 not run yet)"
  fi
else
  echo "SKIP  new-ranking checks (migration 006 not run yet)"
fi

echo
[ "$fails" -eq 0 ] && echo "All checks passed." || { echo "$fails check(s) failed."; exit 1; }
