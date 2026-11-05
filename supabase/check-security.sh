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
  check "signed out can't add an item"        "$(call submit_item '{"p_product":3,"p_variant":4,"p_country":1,"p_brand_name":"X"}')" 'permission denied|PGRST202'
  check "nobody signed out can read catalogue_suggestions" "$(get 'catalogue_suggestions?select=*&limit=1')" 'permission denied|PGRST205'
  check "signed out can't suggest"            "$(call suggest_catalogue '{"p_kind":"product","p_text":"X"}')" 'permission denied|PGRST202'
  check "signed out can't set a home place"   "$(call set_home_place '{"p_place":1}')" 'permission denied'
  check "signed out can't read a profile"     "$(call my_profile '{}')" 'permission denied'
  check "nobody can run internal steps"       "$(call promote_item '{"p_item":1}')" 'permission denied'
  check "the old UK home list works, or is gone (010)" "$(call home_rankings '{"p_country":1}')" '^\[\{|PGRST202'
  check "a ranking never shows who rated or submitted" "$(call ranking '{"p_product":3,"p_variant":4,"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
else
  echo "SKIP  brands and items checks (migration 004 not run yet)"
fi

# Snacks waiting for a new ranking (migration 006). Skipped until it has been run.
if [ "$(get 'item_requests?select=id&limit=1' | grep -c 'does not exist\|PGRST205')" = "0" ]; then
  check "nobody signed out can read item_requests" "$(get 'item_requests?select=*&limit=1')" 'permission denied'
  check "only the owner can see the review list" "$(call review_list '{}')" 'permission denied'
  check "only the owner can accept"            "$(call accept_request '{"p_request":1}')" 'permission denied'
  check "only the owner can decline"           "$(call decline_request '{"p_request":1}')" 'permission denied'
  NEW='{"p_country":1,"p_category":1,"p_new_ranking":"X","p_brand_name":"X"}'
  check "signed out can't send a new ranking, or it's gone (010)" "$(call submit_item_request "$NEW")" 'permission denied|PGRST202'
  check "nobody can run the photo checks"      "$(call check_snack_extras '{"u":"00000000-0000-0000-0000-000000000000","p_image_path":null,"p_image_url":null,"p_barcode":null,"p_score":null}')" 'permission denied'
else
  echo "SKIP  new-ranking checks (migration 006 not run yet)"
fi

# Browse by category and brand, adding without a flavour, Withdraw (migration 008). Skipped until it has been run.
if call home_categories '{"p_country":1}' | grep -q '"type_id"'; then
  check "the UK categories list works"          "$(call home_categories '{"p_country":1}')" '^\[\{'
  check "the UK brands list works"              "$(call home_brands '{"p_country":1}')" '^\['
  check "a category page never shows who rated or submitted" "$(call category_page '{"p_product":3,"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
  check "a brand page never shows who rated"    "$(call brand_page '{"p_brand":1,"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
  check "signed out can't add a snack"          "$(call submit_snack '{"p_country":1,"p_product":3,"p_brand_name":"X","p_pack_name":"X"}')" 'permission denied'
  check "signed out can't suggest a category"   "$(call submit_new_category '{"p_country":1,"p_new_category":"X","p_brand_name":"X","p_pack_name":"X"}')" 'permission denied'
  check "signed out can't withdraw"             "$(call withdraw_submission '{"p_id":"1"}')" 'permission denied'
  check "only the owner can see what to sort"   "$(call to_sort '{}')" 'permission denied'
  check "nobody can run the duplicate check"    "$(call find_same_snack '{"p_country":1,"p_pack":"x","p_barcode":null}')" 'permission denied'
else
  echo "SKIP  category and brand checks (migration 008 not run yet)"
fi

# The owner page (migration 011). Skipped until it has been run.
if [ "$(call owner_status '{}' | grep -c 'PGRST202')" = "0" ]; then
  check "nobody signed out can read owners"     "$(get 'owners?select=*&limit=1')" 'permission denied'
  check "signed out isn't the owner"            "$(call owner_status '{}')" 'permission denied'
  check "signed out can't see what to check"    "$(call owner_queue '{}')" 'permission denied'
  check "signed out can't list the snacks"      "$(call owner_snacks '{}')" 'permission denied'
  check "signed out can't read the catalogue"   "$(call owner_catalogue '{}')" 'permission denied'
  check "signed out can't accept"               "$(call owner_accept '{"p_request":1,"p_category":1,"p_subcategory":"X","p_flavour":null,"p_emoji":null,"p_brand_name":"X","p_pack_name":"X"}')" 'permission denied'
  check "signed out can't decline"              "$(call owner_decline '{"p_request":1}')" 'permission denied'
  check "signed out can't change a snack"       "$(call owner_save_snack '{"p_item":1,"p_pack_name":"X","p_brand_name":"X","p_country":1,"p_category":1,"p_subcategory":"X","p_flavour":null}')" 'permission denied'
  check "signed out can't hide a snack"         "$(call owner_set_status '{"p_item":1,"p_action":"hide"}')" 'permission denied'
  check "signed out can't rename a subcategory" "$(call owner_save_subcategory '{"p_product":1,"p_name":"X","p_category":1,"p_emoji":null}')" 'permission denied'
  check "signed out can't move snacks"          "$(call owner_move_snacks '{"p_from":1,"p_into":2}')" 'permission denied'
  check "nobody can run the owner check"        "$(call require_owner '{}')" 'permission denied'
  check "nobody can run the emoji check"        "$(call owner_emoji '{"p_emoji":"x"}')" 'permission denied|PGRST202'
else
  echo "SKIP  owner page checks (migration 011 not run yet)"
fi

# At most 5 additions a day (migration 012). Skipped until it has been run.
if call app_settings '{}' | grep -q 'max_daily_submissions'; then
  check "the daily limit is 5"                  "$(call app_settings '{}')" '"max_daily_submissions": ?5'
  check "nobody can run the limit check"        "$(call check_submission_limit '{"u":"00000000-0000-0000-0000-000000000000"}')" 'permission denied'
else
  echo "SKIP  daily limit checks (migration 012 not run yet)"
fi

# New lists on home (migration 013). Skipped until it has been run.
if call home_categories '{"p_country":1}' | grep -q '"waiting"'; then
  check "home cards say how many snacks are waiting" "$(call home_categories '{"p_country":1}')" '"waiting": ?[0-9]'
  check "…and never who added them"             "$(call home_categories '{"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
else
  echo "SKIP  new list checks (migration 013 not run yet)"
fi

# New categories (migration 014). Skipped until it has been run.
if call category_list '{"p_country":1}' | grep -q '"visible"'; then
  check "every category can be listed (for the add form)" "$(call category_list '{"p_country":1}')" '^\[\{'
  check "signed out can't suggest a new category" "$(call submit_new_category '{"p_country":1,"p_new_category":"X","p_brand_name":"X","p_pack_name":"X","p_new_type":"X"}')" 'permission denied'
  check "signed out can't accept a new category" "$(call owner_accept '{"p_request":1,"p_new_type":"X"}')" 'permission denied'
  check "nobody can make a category directly"   "$(call owner_category '{"p_name":"X"}')" 'permission denied|PGRST202'
  check "nobody can call the category lookup"   "$(call find_category '{"p_name":"X"}')" 'permission denied|PGRST202'
else
  echo "SKIP  new category checks (migration 014 not run yet)"
fi

# New snacks to check on home, and reports (migration 015). Skipped until it has been run.
if call home_waiting '{"p_country":1}' | grep -q '^\['; then
  check "anyone can list the snacks waiting for approval" "$(call home_waiting '{"p_country":1}')" '^\['
  check "…and it never says who added or approved them" "$(call home_waiting '{"p_country":1}' | grep -c 'submitted_by\|user_id')" '^0$'
  check "nobody signed out can read the reports"  "$(get 'item_reports?select=*&limit=1')" 'permission denied'
  check "signed out can't report a snack"         "$(call report_item '{"p_item":1,"p_reason":"other"}')" 'permission denied'
  check "signed out can't see the owner's reports" "$(call owner_reports '{}')" 'permission denied'
  check "signed out can't clear or act on reports" "$(call owner_resolve_report '{"p_item":1,"p_action":"clear"}')" 'permission denied'
else
  echo "SKIP  new snacks checks (migration 015 not run yet)"
fi

echo
[ "$fails" -eq 0 ] && echo "All checks passed." || { echo "$fails check(s) failed."; exit 1; }
