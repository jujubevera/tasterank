# TasteRank — project brief

## What it is
TasteRank is a community web app where people rate food products by the country they come from. It answers a simple question: *"What food is worth bringing home (or bringing as a gift)?"* The idea came from not knowing which UK foods to take to friends abroad, and from seeing the same question come up again and again on Reddit.

## Where things stand
- **Stage:** validation, now with a real backend so testers share one set of ratings.
- **Owner:** Vera. She is non-technical, so please explain steps in plain language and say what each command does.
- **Code:** `index.html` (HTML + CSS + JavaScript, no build step) plus `supabase/setup.sql` (database). Setup steps for every service are in `SETUP.md`.
- **Data:** Supabase holds foods, ratings, approval votes, profiles and category suggestions, shared by everyone. Starter foods have no fake ratings. With no Supabase keys in `CONFIG`, the site runs in **demo mode** (sample ratings, saved on that device only).
- **Hosting:** GitHub Pages from the `main` branch, with a custom domain planned.

## What the product covers
- Home leaderboard, filtered by country and category, plus "suggest a category" (saved to Supabase)
- Starting country: the visitor's last choice, else guessed from their internet address (country.is), else browser language, else UK
- Item page with average score, rating breakdown bars, rate / change rating, and share
- Emoji rating scale: 😍 5 · 😊 4 · 😐 3 · 😕 2 · 🤢 1
- Real Google sign-in (Supabase Auth), then home-country onboarding with search and a "my country isn't listed" option
- Add-item form. New items stay in "awaiting approval" until **5 votes from different people**, counted in the database, so everyone sees the same count
- Real product photos from Open Food Facts, falling back to an emoji
- Profile page: Google name and photo, items rated, categories covered, shortcut to your country's leaderboard, share, ratings history, sign out, delete account
- Feedback pop-up emailed to the owner via Web3Forms (owner's email never appears in the code)
- Visitor statistics and key events via GoatCounter (no cookies)
- Short privacy note in the footer
- Each item has its own link (`#/item/5`). Back button and keyboard work in pop-ups
- Responsive layout for mobile, tablet and desktop

## Decisions already made (please keep these)
- Emoji ratings, not numbers, to avoid ambiguity
- Fixed category list, with a suggestion form instead of free-form categories
- 5-vote approval for new items
- Images: Open Food Facts image URLs, falling back to an emoji if the image fails
- Font: Figtree
- Hosting on GitHub Pages (not Netlify), custom domain later
- Backend: Supabase. Sign-in: Google only for now (Apple needs a paid developer account)
- Feedback: Web3Forms. Analytics: GoatCounter
- No fake ratings in live mode
- Deliberately simple. Notifications, privacy settings and streaks were cut on purpose. Don't overbuild.

## Next steps
1. **Set up the services** in `SETUP.md` (GitHub Pages, Supabase, Google, Web3Forms, GoatCounter) and paste the keys into `CONFIG`.
2. **Test the full journey** with two different Google accounts: sign in, rate, submit, vote.
3. **Buy and connect the domain** (SETUP.md step 7).
4. **Validate with real users.** Decide the one question the test should answer, share the link, and read the feedback and GoatCounter stats.
