#!/usr/bin/env python3
"""Regenerate blog/index.html and sitemap.xml based on scheduled publish dates.

Reads blog/posts.json, filters to posts where date <= today (AEST),
and writes the blog index and sitemap with only published posts.
"""

import json
import os
from datetime import datetime, timezone, timedelta

# AEST = UTC+11 (during daylight saving) / UTC+10 (standard)
# Use UTC+11 to be safe — posts go live slightly earlier rather than later
AEST = timezone(timedelta(hours=11))

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
POSTS_JSON = os.path.join(ROOT_DIR, "blog", "posts.json")
INDEX_HTML = os.path.join(ROOT_DIR, "blog", "index.html")
SITEMAP_XML = os.path.join(ROOT_DIR, "sitemap.xml")


def format_date(iso_date: str) -> str:
    """Convert 2026-03-02 to '2 March 2026'."""
    d = datetime.strptime(iso_date, "%Y-%m-%d")
    return f"{d.day} {d.strftime('%B')} {d.year}"


def build_card(post: dict) -> str:
    return f"""
          <a href="/blog/{post['slug']}" class="blog-card">
            <img src="../assets/images/blog/{post['slug']}.png" alt="{post['alt']}" class="blog-card__image" loading="lazy" width="600" height="315">
            <div class="blog-card__body">
              <p class="blog-card__date">{format_date(post['date'])}</p>
              <h2 class="blog-card__title">{post['title']}</h2>
              <p class="blog-card__excerpt">{post['excerpt']}</p>
              <span class="blog-card__link">Read More &rarr;</span>
            </div>
          </a>"""


def build_index(published_posts: list) -> str:
    cards = "\n".join(build_card(p) for p in published_posts)
    return f"""<!DOCTYPE html>
<html lang="en-AU">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Laundry tips, guides, and wisdom from Laundry Day — Melbourne's friendliest laundromat. Learn how to wash doonas, save time, and get the most from your laundromat visit.">
  <meta name="theme-color" content="#1565C0">

  <meta property="og:title" content="Laundry Day Blog — Tips, Guides & Laundry Wisdom">
  <meta property="og:description" content="Laundry tips and guides from Melbourne's friendliest laundromat.">
  <meta property="og:image" content="https://laundryday.au/assets/images/brand_lockup_transparent.png">
  <meta property="og:url" content="https://laundryday.au/blog">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Laundry Day">
  <meta property="og:locale" content="en_AU">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Laundry Day Blog — Tips, Guides & Laundry Wisdom">
  <meta name="twitter:description" content="Laundry tips and guides from Melbourne's friendliest laundromat.">
  <meta name="twitter:image" content="https://laundryday.au/assets/images/brand_lockup_transparent.png">

  <link rel="canonical" href="https://laundryday.au/blog">

  <title>Blog — Laundry Day | Melbourne's Friendliest Laundromat</title>

  <link rel="icon" type="image/png" sizes="32x32" href="../assets/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="../assets/favicon-16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="../assets/apple-touch-icon.png">

  <link rel="dns-prefetch" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Poppins:wght@600;700;800&family=Pacifico&display=swap" rel="stylesheet">

  <link rel="stylesheet" href="../css/styles.css?v=6">
</head>

<body>
  <header class="site-header" role="banner">
    <nav class="nav container">
      <a href="/" class="nav__logo" aria-label="Laundry Day — home">
        <img src="../assets/images/logo_text_only.png" alt="Laundry Day" class="nav__logo-img" height="44">
      </a>
      <button class="nav__toggle" aria-expanded="false" aria-controls="nav-menu" aria-label="Toggle navigation menu">
        <span class="nav__hamburger"></span>
      </button>
      <ul id="nav-menu" class="nav__menu" role="list">
        <li><a href="/#benefits" class="nav__link">Why Us</a></li>
        <li><a href="/#how-it-works" class="nav__link">How It Works</a></li>
        <li><a href="/#locations" class="nav__link">Locations</a></li>
        <li><a href="/blog" class="nav__link">Blog</a></li>
        <li><a href="/#contact" class="nav__link">Contact</a></li>
        <li><a href="/#locations" class="btn btn--primary btn--sm">Find a Location</a></li>
      </ul>
    </nav>
  </header>

  <main>
    <section class="blog-hero">
      <div class="container">
        <h1 class="blog-hero__heading">Laundry Day Blog</h1>
        <p class="blog-hero__sub">Tips, guides, and laundry wisdom from Melbourne's friendliest laundromat.</p>
      </div>
    </section>

    <section class="blog-list" aria-label="Blog posts">
      <div class="container">
        <div class="blog-list__grid">
{cards}

        </div>
      </div>
    </section>
  </main>

  <footer class="site-footer" role="contentinfo">
    <div class="container footer__layout">
      <div class="footer__brand">
        <a href="/" class="footer__logo-link" aria-label="Laundry Day">
          <img src="../assets/images/footer_logo_transparent.png" alt="Laundry Day logo with Lila and bubbles" class="footer__logo-img" width="260">
        </a>
        <p class="footer__tagline">Melbourne's friendliest laundromat.</p>
      </div>
      <div class="footer__links">
        <h4 class="footer__heading">Quick Links</h4>
        <ul role="list">
          <li><a href="/#benefits">Why Us</a></li>
          <li><a href="/#how-it-works">How It Works</a></li>
          <li><a href="/#locations">Locations</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/#contact">Contact</a></li>
          <li><a href="/privacy.html">Privacy Policy</a></li>
        </ul>
      </div>
      <div class="footer__connect">
        <h4 class="footer__heading">Connect</h4>
        <a href="mailto:hello@laundryday.au" class="footer__email">hello@laundryday.au</a>
        <div class="footer__social">
          <a href="https://instagram.com/laundrydaymelb" target="_blank" rel="noopener" aria-label="Follow us on Instagram" class="footer__social-link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
          </a>
          <a href="https://facebook.com/laundrydaymelb" target="_blank" rel="noopener" aria-label="Follow us on Facebook" class="footer__social-link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
          </a>
          <a href="https://tiktok.com/@laundrydaymelb" target="_blank" rel="noopener" aria-label="Follow us on TikTok" class="footer__social-link">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5"/></svg>
          </a>
        </div>
      </div>
    </div>
    <div class="footer__bottom">
      <div class="container"><p>&copy; 2026 Laundry Day. All rights reserved.</p></div>
    </div>
  </footer>

  <script src="../js/main.js?v=3"></script>
</body>
</html>"""


def build_sitemap(published_posts: list) -> str:
    static_pages = [
        ("https://laundryday.au/", "2026-03-02", "weekly", "1.0"),
        ("https://laundryday.au/brunswick-east", "2026-03-02", "weekly", "0.9"),
        ("https://laundryday.au/st-albans", "2026-03-02", "weekly", "0.9"),
        ("https://laundryday.au/maribyrnong", "2026-03-02", "weekly", "0.9"),
        ("https://laundryday.au/blog", "2026-03-02", "weekly", "0.8"),
    ]

    urls = []
    for loc, lastmod, freq, priority in static_pages:
        urls.append(f"""  <url>
    <loc>{loc}</loc>
    <lastmod>{lastmod}</lastmod>
    <changefreq>{freq}</changefreq>
    <priority>{priority}</priority>
  </url>""")

    for post in published_posts:
        urls.append(f"""  <url>
    <loc>https://laundryday.au/blog/{post['slug']}</loc>
    <lastmod>{post['date']}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>""")

    urls.append("""  <url>
    <loc>https://laundryday.au/privacy.html</loc>
    <lastmod>2026-03-02</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.3</priority>
  </url>""")

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
{"".join(chr(10) + u for u in urls)}
</urlset>
"""


def main():
    today = datetime.now(AEST).date()
    print(f"Today (AEST): {today}")

    with open(POSTS_JSON) as f:
        all_posts = json.load(f)

    published = [
        p for p in all_posts
        if datetime.strptime(p["date"], "%Y-%m-%d").date() <= today
    ]
    print(f"Published: {len(published)} / {len(all_posts)} posts")

    index_html = build_index(published)
    with open(INDEX_HTML, "w") as f:
        f.write(index_html)
    print(f"Wrote {INDEX_HTML}")

    sitemap_xml = build_sitemap(published)
    with open(SITEMAP_XML, "w") as f:
        f.write(sitemap_xml)
    print(f"Wrote {SITEMAP_XML}")


if __name__ == "__main__":
    main()
