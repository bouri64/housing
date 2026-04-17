from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from scraper import scrape_seloger

app = FastAPI()

# 👇 THIS IS WHAT YOU WERE MISSING
app.mount("/static", StaticFiles(directory="static"), name="static")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return FileResponse("static/index.html")


class ScrapeRequest(BaseModel):
    url: str


@app.post("/scrape")
def scrape(req: ScrapeRequest):
    listings = scrape_seloger(req.url)

    return {
        "count": len(listings),
        "listings": listings
    }