from pydantic import BaseModel
from typing import List


class ScrapeRequest(BaseModel):
    url: str


class Listing(BaseModel):
    url: str
    description: str


class ListingBatch(BaseModel):
    listings: List[Listing]