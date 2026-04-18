import time
import json
import re
import requests
import codecs
from playwright.sync_api import sync_playwright

MAX_LISTINGS = 40


# ===============================
# DEBUG
# ===============================
def debug_log(label, value):
    print(f"\n🟡 {label}")
    print(value)
    print("-" * 80)


# ===============================
# GEOCODER (WITH CACHE FROM FRONTEND)
# ===============================
_last_geo_call = 0

def e_geocode(lat, lon, cache):
    global _last_geo_call

    geo_cache = cache.setdefault("geo", {})

    # 🔥 normalize key (important!)
    key = f"{round(lat, 5)},{round(lon, 5)}"

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

        # ✅ store in cache
        geo_cache[key] = address

        return address

    except Exception as e:
        debug_log("GEOCODE EXCEPTION", str(e))
        return "N/A"

# ===============================
# PROPERTY EXTRACTION
# ===============================
def extract_details(page, cache):
    try:
        script = page.query_selector("#__UFRN_LIFECYCLE_SERVERREQUEST__")

        if not script:
            return "N/A", "N/A"

        text = script.inner_text()

        match = re.search(r'JSON\.parse\("(.+)"\)', text, re.S)
        if not match:
            return "N/A", "N/A"

        json_string = match.group(1)
        json_string = bytes(json_string, "utf-8").decode("unicode_escape").encode("latin1").decode("utf-8")
        data = json.loads(json_string)
        classified = data.get("app_cldp", {}).get("data", {}).get("classified", {})
        sections = classified.get("sections", {})
        description = sections.get("description", {}).get("description", "N/A")
        hardFacts = sections.get("hardFacts", {})
        energy = sections.get("energy", {})
        featuresPreview = sections.get("features", {}).get("preview", [])
        energyFeatures = energy.get("features", {})
        facts = hardFacts.get("facts", [])
        location = sections.get("location", {})
        property_type = classified.get("rawData", {}).get("propertyTypeLabel", "N/A")
        for f in energyFeatures:
            yearOfConstruction, heatingSystem, energySource = "N/A", "N/A", "N/A"
            t = f.get("type")
            if t == "yearOfConstruction":
                yearOfConstruction = f.get("value")
            elif t == "heatingSystem":
                heatingSystem = f.get("value")
            elif t == "energySource":
                energySource = f.get("value")
        rating = energy.get("certificates", [])[0].get("scales", [])[0].get("efficiencyClass", {}).get("rating", "N/A")
        
        price = re.sub(r"[^\d]", "", hardFacts.get("price", {}).get("value", "N/A"))
        pricePerM = re.sub(r"[^\d]", "",hardFacts.get("price", {}).get("additionalInformation", "N/A"))

        for fact in facts:
            numberOfRooms, numberOfBedrooms, livingSpace, numberOfFloors = "N/A", "N/A", "N/A", "N/A"
            t = fact.get("type")

            if t == "numberOfRooms":
                numberOfRooms = fact.get("splitValue")

            elif t == "numberOfBedrooms":
                numberOfBedrooms = fact.get("splitValue")

            elif t == "livingSpace":
                livingSpace = fact.get("splitValue")

            elif t == "numberOfFloors":
                numberOfFloors = fact.get("value")

        
        city = classified.get("location", {}).get("address", {}).get("city", "N/A")
        coords = location.get("geometry", {}).get("coordinates")
        address = "N/A"
        if coords and isinstance(coords, (list, tuple)) and len(coords) == 2:
            lon, lat = coords
            address = e_geocode(lat, lon, cache)

        result = {
            "property_type": property_type,
            "address": address,
            "city": city,
            "price": price,
            "price_per_m2": pricePerM,
            "living_space": livingSpace,
            "rooms": numberOfRooms,
            "bedrooms": numberOfBedrooms,
            "floors": numberOfFloors,
            "year_of_construction": yearOfConstruction,
            "heating_system": heatingSystem,
            "energy_source": energySource,
            "energy_rating": rating,
        }
        print(result)
        return result

    except Exception as e:
        debug_log("PROPERTY ERROR", str(e))
        return "N/A", "N/A"


# ===============================
# UTILS
# ===============================
def normalize_url(url: str) -> str:
    return url.split("?")[0].split("#")[0]


# ===============================
# MAIN SCRAPER
# ===============================
def scrape_seloger(url: str, cache: dict):

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

            clean_href = normalize_url(href)
            print(clean_href)

            # ✅ CACHE HIT
            if clean_href in cache:
                print("🟢 CACHE HIT (LISTING)")
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

                result = extract_details(page, cache)
                result["url"] = clean_href
                result["description"] = description

                results.append(result)

                # ✅ UPDATE CACHE (IN MEMORY ONLY)
                cache[clean_href] = result

            except Exception as e:
                debug_log("LISTING ERROR", str(e))

            finally:
                context.close()

        browser.close()

    # ✅ RETURN UPDATED CACHE
    return results, cache