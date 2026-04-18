from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from scraper import scrape_seloger

app = FastAPI()

# Static files (frontend)
app.mount("/static", StaticFiles(directory="static"), name="static")

# CORS (allow everything for local dev)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def home():
    return FileResponse("static/index.html")


# ===============================
# REQUEST MODEL (UPDATED)
# ===============================
class ScrapeRequest(BaseModel):
    url: str
    cache: dict = {}   # ✅ receive browser cache


# ===============================
# ENDPOINT
# ===============================
@app.post("/scrape")
def scrape(req: ScrapeRequest):
    listings, updated_cache = scrape_seloger(req.url, req.cache)

    return {
        "count": len(listings),
        "listings": listings,
        "cache": updated_cache   # ✅ send back updated cache
    }