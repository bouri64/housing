from playwright.sync_api import sync_playwright


def scrape_seloger(url: str):
    listings = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until="networkidle")

        # wait a bit for JS rendering
        page.wait_for_timeout(3000)

        cards = page.query_selector_all("a[href*='/annonces/']")

        for c in cards:
            href = c.get_attribute("href")
            text = c.inner_text().strip()

            if href:
                listings.append({
                    "url": href,
                    "description": text[:200]
                })

        browser.close()

    return listings