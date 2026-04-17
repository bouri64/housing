import time
import json
import requests
from playwright.sync_api import sync_playwright


# ---------------- DEBUG ----------------
def debug_log(label, value):
    print(f"\n🟡 {label}")
    print(value)
    print("-" * 80)


# ---------------- ADDRESS ----------------
def e_geocode(lat, lon):
    try:
        r = requests.get(
            f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json&accept-language=fr",
            headers={       
                     # REQUIRED: identify your app
                    "User-Agent": "SeLogerScraper/1.0 (contact: medali@gmail.com)",

                    # REQUIRED: helps avoid blocking
                    "Referer": "http://localhost:8000"
            }               
        )
        return r.json().get("display_name", "N/A")
    except:
        return "N/A"


# ---------------- PROPERTY TYPE + ADDRESS ----------------
def extract_details(page):
    try:
        script = page.query_selector("#__UFRN_LIFECYCLE_SERVERREQUEST__")

        if not script:
            debug_log("PROPERTY TYPE DEBUG", "NO SCRIPT FOUND")
            return "N/A", "N/A"

        text = script.inner_text()
        debug_log("RAW SCRIPT (first 500 chars)", text[:500])

        # extract JSON.parse("...")
        import re
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

        if coords:
            lon, lat = coords
            address = e_geocode(lat, lon)

        return property_type, address

    except Exception as e:
        debug_log("PROPERTY TYPE ERROR", str(e))
        return "N/A", "N/A"


# ---------------- MAIN SCRAPER ----------------
def scrape_seloger(url: str):
    results = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        print("🌐 Opening search page...")
        page.goto(url, timeout=60000)
        page.wait_for_timeout(5000)

        # listing cards
        cards = page.query_selector_all('[data-testid="serp-core-classified-card-testid"]')

        print(f"📦 Found {len(cards)} listings")

        for i, card in enumerate(cards[:10]):  # limit for safety
            try:
                link = card.query_selector('a[href*="/annonces/"]')
                if not link:
                    continue

                href = link.get_attribute("href")
                if not href.startswith("http"):
                    href = "https://www.seloger.com" + href

                print(f"\n➡ Opening listing {i+1}: {href}")

                page.goto(href, timeout=60000)
                page.wait_for_timeout(4000)

                # description/title fallback
                description = page.title()

                debug_log("DESCRIPTION", description)

                property_type, address = extract_details(page)

                results.append({
                    "url": href,
                    "description": description,
                    "property_type": property_type,
                    "address": address
                })

            except Exception as e:
                print("❌ ERROR listing:", e)

        browser.close()

    return results