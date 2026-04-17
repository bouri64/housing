from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from models import ScrapeRequest
from scraper import scrape_seloger
import requests
from playwright.sync_api import sync_playwright

app = FastAPI()

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def home():
    return FileResponse("static/index.html")


@app.post("/scrape")
def scrape(data: ScrapeRequest):

    listings = []

    with sync_playwright() as p:
        # browser = p.chromium.launch(headless=True)
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()

        page.goto(data.url, timeout=60000)

        # wait for content to load
        page.wait_for_timeout(5000)

        html = page.content()

        # SAVE FULL HTML (IMPORTANT DEBUG)
        with open("debug_playwright.html", "w", encoding="utf-8") as f:
            f.write(html)

        print("HTML SAVED")

        cards = page.query_selector_all('[data-testid="serp-core-classified-card-testid"]')

        print("FOUND CARDS:", len(cards))

        for c in cards:
            try:
                a = c.query_selector("a")
                if not a:
                    continue

                url = a.get_attribute("href")
                text = c.inner_text()

                listings.append({
                    "url": url,
                    "description": text
                })
            except:
                continue

        browser.close()

    return {"listings": listings}