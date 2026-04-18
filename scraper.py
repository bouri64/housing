import time
import json
import re
import requests
import codecs
import os
from playwright.sync_api import sync_playwright

MAX_LISTINGS = 40
CACHE_FILE = "seloger_cache.json"

# ===============================
# CACHE SYSTEM
# ===============================
def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)

cache = load_cache()
print(f"🟡 Cache loaded: {len(cache)} entries")


# ===============================
# DEBUG
# ===============================
def debug_log(label, value):
    print(f"\n🟡 {label}")
    print(value)
    print("-" * 80)


# ===============================
# RATE LIMITED GEOCODER + CACHE
# ===============================
_last_geo_call = 0
geo_cache = cache.get("geo", {})

def e_geocode(lat, lon):
    global _last_geo_call, geo_cache

    key = f"{lat},{lon}"

    if key in geo_cache:
        print(f"🟢 GEO CACHE HIT: {key}")
        return geo_cache[key]

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
                "User-Agent": "SeLogerScraper/1.0",
            },
            timeout=10
        )

        if r.status_code != 200:
            return "N/A"

        address = r.json().get("display_name", "N/A")

        geo_cache[key] = address
        cache["geo"] = geo_cache
        save_cache(cache)

        return address

    except Exception as e:
        debug_log("GEOCODE EXCEPTION", str(e))
        return "N/A"


# ===============================
# PROPERTY EXTRACTION
# ===============================
def extract_details(page):
    try:
        script = page.query_selector("#__UFRN_LIFECYCLE_SERVERREQUEST__")

        if not script:
            return "N/A", "N/A"

        text = script.inner_text()

        match = re.search(r'JSON\.parse\("(.+)"\)', text, re.S)
        if not match:
            return "N/A", "N/A"

        json_string = match.group(1)
        json_string = codecs.decode(json_string, "unicode_escape")

        data = json.loads(json_string)
        classified = data.get("app_cldp", {}).get("data", {}).get("classified", {})

        property_type = classified.get("rawData", {}).get("propertyTypeLabel", "N/A")

        location = classified.get("sections", {}).get("location", {})
        coords = location.get("geometry", {}).get("coordinates")

        address = "N/A"

        if coords and isinstance(coords, (list, tuple)) and len(coords) == 2:
            lon, lat = coords
            address = e_geocode(lat, lon)

        return property_type, address

    except Exception as e:
        debug_log("PROPERTY ERROR", str(e))
        return "N/A", "N/A"


# ===============================
# MAIN SCRAPER
# ===============================
def scrape_seloger(url: str):
    global cache

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

        # extract URLs
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

        # ===============================
        # SCRAPING LOOP WITH CACHE
        # ===============================
        for i, href in enumerate(urls[:MAX_LISTINGS]):

            print(f"\n➡ Listing {i+1}/{len(urls)}")

            # ===========================
            # CACHE CHECK (MAIN LOGIC)
            # ===========================
            clean_href = normalize_url(href)
            print(clean_href)

            if clean_href in cache:
                print("🟢 CACHE HIT (LISTING)")
                print(cache[clean_href])
                results.append(cache[clean_href])
                continue

            print("🔴 CACHE MISS (SCRAPING)")

            context = browser.new_context()

            def block_assets(route):
                if route.request.resource_type in ["image", "media", "font"]:
                    return route.abort()
                route.continue_()

            context.route("**/*", block_assets)

            page = context.new_page()

            try:
                page.goto(href, timeout=60000)
                page.wait_for_timeout(2000)

                description = page.title()
                debug_log("DESCRIPTION", description)

                property_type, address = extract_details(page)

                result = {
                    "url": href,
                    "description": description,
                    "property_type": property_type,
                    "address": address
                }

                result["url"] = clean_href
                results.append(result)
                # SAVE TO CACHE
                cache[clean_href] = result
                save_cache(cache)

            except Exception as e:
                debug_log("LISTING ERROR", str(e))

            finally:
                context.close()

        browser.close()

    return results

def normalize_url(url: str) -> str:
    return url.split("?")[0].split("#")[0]