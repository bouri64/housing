import time
import json
import re
import requests
from playwright.sync_api import sync_playwright


# ---------------- DEBUG ----------------
def debug_log(label, value):
    print(f"\n🟡 {label}")
    print(value)
    print("-" * 80)


# ---------------- RATE LIMITED GEOCODER ----------------
_last_geo_call = 0

def e_geocode(lat, lon):
    global _last_geo_call

    try:
        elapsed = time.time() - _last_geo_call
        if elapsed < 1:
            time.sleep(1 - elapsed)

        _last_geo_call = time.time()

        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={
                "lat": lat,
                "lon": lon,
                "format": "json",
                "accept-language": "fr"
            },
            headers={
                "User-Agent": "SeLogerScraper/1.0 (contact: medali@gmail.com)",
                "Referer": "http://localhost:8000"
            },
            timeout=10
        )

        if r.status_code != 200:
            debug_log("GEOCODE ERROR", r.text)
            return "N/A"

        return r.json().get("display_name", "N/A")

    except Exception as e:
        debug_log("GEOCODE EXCEPTION", str(e))
        return "N/A"


# ---------------- PROPERTY EXTRACTION ----------------
def extract_details(page):
    try:
        script = page.query_selector("#__UFRN_LIFECYCLE_SERVERREQUEST__")

        if not script:
            debug_log("PROPERTY TYPE DEBUG", "NO SCRIPT FOUND")
            return "N/A", "N/A"

        text = script.inner_text()

        match = re.search(r'JSON\.parse\("(.+)"\)', text, re.S)
        if not match:
            debug_log("PROPERTY TYPE DEBUG", "NO JSON MATCH")
            return "N/A", "N/A"

        json_string = match.group(1)

        json_string = json_string.replace('\\"', '"').replace('\\n', '').replace('\\r', '')

        data = json.loads(json_string)

        classified = data.get("app_cldp", {}).get("data", {}).get("classified", {})

        property_type = classified.get("rawData", {}).get("propertyTypeLabel", "N/A")

        location = classified.get("sections", {}).get("location", {})
        coords = location.get("geometry", {}).get("coordinates")

        address = "N/A"

        if coords and isinstance(coords, (list, tuple)) and len(coords) == 2:
            lon, lat = coords
            address = e_geocode(lat, lon)
        else:
            debug_log("COORDS INVALID", coords)

        return property_type, address

    except Exception as e:
        debug_log("PROPERTY ERROR", str(e))
        return "N/A", "N/A"


# ---------------- MAIN SCRAPER ----------------
def scrape_seloger(url: str):
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)

        search_page = browser.new_page()

        print("🌐 Opening search page...")
        search_page.goto(url, timeout=60000)

        search_page.wait_for_selector(
            '[data-testid="serp-core-classified-card-testid"]',
            timeout=20000
        )

        # scroll to load more
        for _ in range(6):
            search_page.mouse.wheel(0, 3000)
            search_page.wait_for_timeout(1000)

        cards = search_page.query_selector_all(
            '[data-testid="serp-core-classified-card-testid"]'
        )

        print(f"📦 Found {len(cards)} listings")

        # extract urls BEFORE navigation
        urls = []
        for card in cards:
            link = card.query_selector('a[href*="/annonces/"]')
            if not link:
                continue

            href = link.get_attribute("href")
            if href and not href.startswith("http"):
                href = "https://www.seloger.com" + href

            if href:
                urls.append(href)

        print(f"🔗 Extracted {len(urls)} URLs")

        # ---------------- FAST DETAIL SCRAPING ----------------
        for i, href in enumerate(urls[:10]):

            print(f"\n➡ Scraping {i+1}/{len(urls)}")
            print(href)

            # 🔥 CREATE CONTEXT WITH BLOCKING ONLY FOR DETAIL PAGE
            context = browser.new_context()

            def block_assets(route):
                if route.request.resource_type in ["image", "media", "font"]:
                    return route.abort()
                route.continue_()

            context.route("**/*", block_assets)

            detail_page = context.new_page()

            try:
                detail_page.goto(href, timeout=60000)
                detail_page.wait_for_timeout(2000)

                description = detail_page.title()

                debug_log("DESCRIPTION", description)

                property_type, address = extract_details(detail_page)

                results.append({
                    "url": href,
                    "description": description,
                    "property_type": property_type,
                    "address": address
                })

            except Exception as e:
                debug_log("LISTING ERROR", str(e))

            finally:
                context.close()

        browser.close()

    return results