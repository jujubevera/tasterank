# TasteRank — project brief

## What it is
TasteRank is a community web app where people rate food products by the country they come from. It answers a simple question: *"What food is worth bringing home (or bringing as a gift)?"* The idea came from not knowing which UK foods to take to friends abroad, and from seeing the same question come up again and again on Reddit.

## Where things stand
- **Stage:** idea / validation. The goal is to test the concept with real people before building anything heavier.
- **Owner:** Vera. She is non-technical, so please explain steps in plain language and say what each command does.
- **Code:** a single file, `index.html` (HTML + CSS + JavaScript, no build step, no backend). Open it in a browser to run it.
- **Data:** sample products and made-up ratings are built into the file. User actions are saved only in the browser's localStorage. Sign-in is fake (no real accounts).
- **Hosting:** GitHub Pages, served straight from this repo's `main` branch. Every push updates the live site within a minute or two. A custom domain can be added later.

## What the prototype covers
- Home leaderboard, filtered by country and category, plus a "suggest a category" option
- Item page with average score, rating breakdown bars, rate / change rating, and share
- Emoji rating scale: 😍 5 · 😊 4 · 😐 3 · 😕 2 · 🤢 1
- Google/Apple sign-in (mock), then home-country onboarding with search and a "my country isn't listed" option
- Add-item form. New items stay in "awaiting approval" until **5 community votes**
- Profile page: items rated, categories covered, shortcut to your country's leaderboard, share, ratings history, sign out, reset demo data
- Each item has its own link (e.g. `#/item/uk1`), so links can be shared and the browser Back button works
- Footer note saying it's a prototype, plus an optional "Send feedback" link (set `FEEDBACK_URL` at the top of the script)
- Responsive layout for mobile, tablet and desktop

## Decisions already made (please keep these)
- Emoji ratings, not numbers, to avoid ambiguity
- Fixed category list, with a suggestion form instead of free-form categories
- 5-vote approval for new items
- Images: Open Food Facts image URLs, falling back to an emoji if the image fails
- Font: Figtree
- Hosting on GitHub Pages (not Netlify)
- Deliberately simple. Notifications, privacy settings and streaks were cut on purpose. Don't overbuild.

## Next steps
1. ~~**Put it on GitHub.**~~ Done: `jujubevera/tasterank`.
2. ~~**Go live on GitHub Pages.**~~ Done.
3. **Optional: custom domain.** Buy a domain, then add it under the repo's Settings → Pages → Custom domain and set the DNS records GitHub shows.
4. **Validate with real users.** Options include sharing the link directly, a "Wizard of Oz" test, or a waitlist landing page. A Google Form linked via `FEEDBACK_URL` is the easiest way to collect responses.
5. **Later, only if validated:** a real backend with **Supabase** (database, Google sign-in, storage). Supabase works fine with a GitHub Pages site.
