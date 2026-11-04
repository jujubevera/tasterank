# TasteRank

**Which snack wins? You decide.** TasteRank is a free community website where people rate snacks from the country they're sold in, so you can see which ones are really worth trying, bringing home or giving as a gift.

Live at [tasterank.app](https://tasterank.app).

## How it works
- **Browse by category or brand.** Snacks are grouped into lists such as Crisps, Chocolate bars or Toffee, one list per country. Flavour filters let you compare like with like, for example salt & vinegar against salt & vinegar.
- **Rate with a face.** Pick one of five: 🤢 Yuck, 😕 Not for me, 😐 It's okay, 😊 Like it, 😍 Love it. Each person gets one rating per snack, and a snack needs 10 ratings before it's ranked.
- **Add what's missing.** Signed-in tasters can add a snack by typing what's on the pack. New snacks join the list once 5 other people approve them.
- **Browse freely.** Anyone can look around; signing in with Google is only needed to rate, add or approve.
- **Country by country.** The same snack can taste different in different countries, so each country has its own lists. The United Kingdom comes first.

## Privacy
TasteRank shows totals, never who rated what. There's no advertising, and visitor statistics are counted without cookies. The details are on the [privacy page](https://tasterank.app/privacy.html).

## How it's built
- A static website (HTML, CSS and JavaScript, no build step), hosted on GitHub Pages.
- [Supabase](https://supabase.com) for the database and Google sign-in.
- Snack photos from [Open Food Facts](https://world.openfoodfacts.org).

Opened without its Supabase keys, the site runs in demo mode, with sample ratings saved only in that browser.
